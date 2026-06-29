// Small server-side proxy for IMF Direction of Trade Statistics (DOTS) via DBnomics.
// The MoneyFlow page calls this when a country (or a pair) is selected, to draw a
// yearly trade history — without baking thousands of series into the static build.
// Because the fetch runs here on the server, there is no browser CORS dependency on
// DBnomics; the page only ever calls this same-origin endpoint.
//
//   /api/dot?mode=country&c=US        -> { net:  [{year, value}], ... }   balance vs world
//   /api/dot?mode=pair&a=US&b=CN      -> { aToB: [...], bToA: [...] }      both directions
//
// All values are USD (DOTS reports millions; we multiply up).

const BASE = "https://api.db.nomics.world/v22";
const MILLION = 1e6;

type Point = { year: number; value: number };

// Country / counterpart codes are short alphanumerics (e.g. "US", "CN", "W00").
// Reject anything else so nothing odd is ever interpolated into the upstream URL.
function clean(code: string | null): string | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(c) ? c : null;
}

async function fetchJSON(url: string): Promise<any> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      next: { revalidate: 86400 },
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MGZS-MoneyFlow/1.0)" },
    } as RequestInit);
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// One DBnomics series doc -> ascending yearly points in USD.
function pointsFromDoc(doc: any): Point[] {
  const periods = doc?.period;
  const vals = doc?.value;
  if (!Array.isArray(periods) || !Array.isArray(vals)) return [];
  const out: Point[] = [];
  for (let k = 0; k < periods.length; k++) {
    const year = Number(String(periods[k]).slice(0, 4));
    const v = vals[k];
    if (!Number.isNaN(year) && typeof v === "number" && !Number.isNaN(v)) {
      out.push({ year, value: v * MILLION });
    }
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

const codeOf = (doc: any): string => (typeof doc?.series_code === "string" ? doc.series_code.toUpperCase() : "");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Cache at the CDN so repeated clicks are instant and DBnomics isn't hammered.
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=43200",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  // ── Single country: goods trade balance vs the world, per year ──
  if (mode === "country") {
    const c = clean(searchParams.get("c"));
    if (!c) return json({ error: "bad country code" }, 400);

    // Primary: IMF's published goods trade balance (TBG_USD = exports FOB − imports CIF).
    const tbg = await fetchJSON(`${BASE}/series/IMF/DOT/A.${c}.TBG_USD.W00?observations=1&format=json`);
    let net = pointsFromDoc(tbg?.series?.docs?.[0]);

    // Fallback: some reporters lack the balance series — derive it from exports and imports.
    if (net.length === 0) {
      const ids = `IMF/DOT/A.${c}.TXG_FOB_USD.W00,IMF/DOT/A.${c}.TMG_CIF_USD.W00`;
      const data = await fetchJSON(`${BASE}/series?observations=1&format=json&series_ids=${encodeURIComponent(ids)}`);
      const docs = Array.isArray(data?.series?.docs) ? data.series.docs : [];
      const exp: Record<number, number> = {};
      const imp: Record<number, number> = {};
      for (const doc of docs) {
        const ind = codeOf(doc).split(".")[2];
        const target = ind === "TXG_FOB_USD" ? exp : ind === "TMG_CIF_USD" ? imp : null;
        if (!target) continue;
        for (const p of pointsFromDoc(doc)) target[p.year] = p.value;
      }
      const years = Array.from(new Set([...Object.keys(exp), ...Object.keys(imp)].map(Number))).sort((a, b) => a - b);
      net = years
        .filter((y) => typeof exp[y] === "number" && typeof imp[y] === "number")
        .map((y) => ({ year: y, value: exp[y] - imp[y] }));
    }

    return json({ mode, c, net });
  }

  // ── Two countries: each direction's goods exports, per year ──
  if (mode === "pair") {
    const a = clean(searchParams.get("a"));
    const b = clean(searchParams.get("b"));
    if (!a || !b || a === b) return json({ error: "bad pair" }, 400);

    const ids = `IMF/DOT/A.${a}.TXG_FOB_USD.${b},IMF/DOT/A.${b}.TXG_FOB_USD.${a}`;
    const data = await fetchJSON(`${BASE}/series?observations=1&format=json&series_ids=${encodeURIComponent(ids)}`);
    const docs = Array.isArray(data?.series?.docs) ? data.series.docs : [];

    let aToB: Point[] = [];
    let bToA: Point[] = [];
    for (const doc of docs) {
      const parts = codeOf(doc).split("."); // FREQ.REF.INDICATOR.COUNTERPART
      const ref = parts[1];
      const cp = parts[3];
      const pts = pointsFromDoc(doc);
      if (ref === a && cp === b) aToB = pts;
      else if (ref === b && cp === a) bToA = pts;
    }

    return json({ mode, a, b, aToB, bToA });
  }

  return json({ error: "unknown mode" }, 400);
}
