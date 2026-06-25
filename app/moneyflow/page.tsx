import MoneyFlowClient, { WealthRow, Flow, MFMeta, Partner } from "./MoneyFlowClient";

// How many of the largest economies form the trade web (reporters AND partners).
// Chosen dynamically from live GDP below — never hardcoded.
const TOP_N = 135;
// Cap on arcs drawn at rest, largest-first, so the globe reads as flow not mud.
const MAX_ARCS = 400;

async function safeJSON(url: string, revalidate: number): Promise<any> {
  try {
    const res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MGZS-MoneyFlow/1.0)" },
    } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

type Geo = { iso2: string; iso3: string; name: string; lat: number; lng: number };

function parseGeo(json: any): Geo[] {
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return [];
  const out: Geo[] = [];
  for (const r of rows) {
    const iso3 = r?.id;
    const iso2 = r?.iso2Code;
    const name = r?.name;
    const lat = parseFloat(r?.latitude);
    const lng = parseFloat(r?.longitude);
    if (!iso3 || !iso2 || !name) continue;
    if (r?.region?.value === "Aggregates") continue;
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    out.push({ iso2: iso2.toUpperCase(), iso3, name, lat, lng });
  }
  return out;
}

function parseWB(json: any): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const code = r?.countryiso3code;
    if (code && typeof r.value === "number") out[code] = r.value;
  }
  return out;
}

function dimOf(doc: any, key: string): string | null {
  const flat = doc?.[key];
  if (typeof flat === "string") return flat.toUpperCase();
  const nested = doc?.dimensions?.[key];
  if (typeof nested === "string") return nested.toUpperCase();
  return null;
}
function latestValue(doc: any): number | null {
  const vals = doc?.value;
  if (!Array.isArray(vals)) return null;
  for (let k = vals.length - 1; k >= 0; k--) {
    const v = vals[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

const topList = (m: Record<string, Partner[]>, iso3: string, n: number): Partner[] =>
  (m[iso3] || []).slice().sort((a, b) => b.valueUSD - a.valueUSD).slice(0, n);

export default async function MoneyFlow() {
  // Stage 1: the country universe and live GDP (the wealth measure). Both World Bank.
  const [geoJson, gdpJson] = await Promise.all([
    safeJSON("https://api.worldbank.org/v2/country?format=json&per_page=400", 86400),
    safeJSON("https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1&per_page=20000", 86400),
  ]);

  const geo = parseGeo(geoJson);
  const gdp = parseWB(gdpJson);
  const byIso2 = new Map<string, Geo>();
  for (const g of geo) byIso2.set(g.iso2, g);

  const baseWealth = geo
    .filter((g) => typeof gdp[g.iso3] === "number" && gdp[g.iso3] > 0)
    .map((g) => ({ ...g, gdpUSD: gdp[g.iso3] }))
    .sort((a, b) => b.gdpUSD - a.gdpUSD);

  const top = baseWealth.slice(0, TOP_N);
  const topIso2 = top.map((w) => w.iso2);
  const topSet = new Set(top.map((w) => w.iso3));

  // Stage 2: the DBnomics IMF/DOT export matrix among those economies.
  type RawFlow = Flow & { fromIso3: string; toIso3: string };
  const raw: RawFlow[] = [];
  const expSum: Record<string, number> = {};   // iso3 -> total exports (within web)
  const impSum: Record<string, number> = {};   // iso3 -> total imports (within web)
  const pairVal: Record<string, number> = {};  // "A>B" -> exports A->B
  const outP: Record<string, Partner[]> = {};  // exporter iso3 -> [{partner, value}]
  const inP: Record<string, Partner[]> = {};   // importer iso3 -> [{partner, value}]

  let dotNumFound = 0;
  let dotPagesOk = 0;
  if (topIso2.length > 0) {
    const dims = { FREQ: ["A"], REF_AREA: topIso2, INDICATOR: ["TXG_FOB_USD"], COUNTERPART_AREA: topIso2 };
    const baseUrl =
      "https://api.db.nomics.world/v22/series/IMF/DOT?observations=1&format=json&limit=1000" +
      "&dimensions=" + encodeURIComponent(JSON.stringify(dims));

    for (let page = 0; page < 20; page++) {
      const json = await safeJSON(baseUrl + "&offset=" + page * 1000, 86400);
      const series = json?.series;
      const docs = Array.isArray(series?.docs) ? series.docs : null;
      if (!docs) break;
      dotPagesOk++;
      dotNumFound = typeof series?.num_found === "number" ? series.num_found : dotNumFound;
      for (const doc of docs) {
        const from = dimOf(doc, "REF_AREA");
        const to = dimOf(doc, "COUNTERPART_AREA");
        if (!from || !to || from === to) continue;
        const a = byIso2.get(from);
        const b = byIso2.get(to);
        if (!a || !b) continue;
        const millions = latestValue(doc);
        if (millions == null || millions <= 0) continue;
        const usd = millions * 1e6; // DOTS values are in millions of USD
        raw.push({
          from: a.name, to: b.name, fromLat: a.lat, fromLng: a.lng, toLat: b.lat, toLng: b.lng,
          valueUSD: usd, dominant: true, fromIso3: a.iso3, toIso3: b.iso3,
        });
        expSum[a.iso3] = (expSum[a.iso3] || 0) + usd;
        impSum[b.iso3] = (impSum[b.iso3] || 0) + usd;
        pairVal[a.iso3 + ">" + b.iso3] = usd;
        (outP[a.iso3] = outP[a.iso3] || []).push({ name: b.name, valueUSD: usd });
        (inP[b.iso3] = inP[b.iso3] || []).push({ name: a.name, valueUSD: usd });
      }
      if (docs.length < 1000) break;
    }
  }

  // Corridor dominance: an arc is "dominant" (the earning direction) if it is the
  // heavier of the two directions in its pair. Used for warm/cool arc colour.
  for (const r of raw) {
    const fwd = pairVal[r.fromIso3 + ">" + r.toIso3] || 0;
    const rev = pairVal[r.toIso3 + ">" + r.fromIso3] || 0;
    r.dominant = fwd >= rev;
  }

  // Heaviest flows first; keep the top for the resting globe (strip internal iso3s).
  raw.sort((a, b) => b.valueUSD - a.valueUSD);
  const topFlows: Flow[] = raw.slice(0, MAX_ARCS).map((r) => ({
    from: r.from, to: r.to, fromLat: r.fromLat, fromLng: r.fromLng,
    toLat: r.toLat, toLng: r.toLng, valueUSD: r.valueUSD, dominant: r.dominant,
  }));

  // Wealth list, enriched with trade vitals for countries inside the web (else null).
  const wealth: WealthRow[] = baseWealth.map((g) => {
    if (!topSet.has(g.iso3)) {
      return {
        name: g.name, iso2: g.iso2, iso3: g.iso3, lat: g.lat, lng: g.lng, gdpUSD: g.gdpUSD,
        expUSD: null, impUSD: null, netUSD: null, tradeToGDP: null, topOut: [], topIn: [],
      };
    }
    const exp = expSum[g.iso3] || 0;
    const imp = impSum[g.iso3] || 0;
    return {
      name: g.name, iso2: g.iso2, iso3: g.iso3, lat: g.lat, lng: g.lng, gdpUSD: g.gdpUSD,
      expUSD: exp, impUSD: imp, netUSD: exp - imp,
      tradeToGDP: g.gdpUSD > 0 ? (exp + imp) / g.gdpUSD : null,
      topOut: topList(outP, g.iso3, 3), topIn: topList(inP, g.iso3, 3),
    };
  });

  const live: string[] = [];
  if (wealth.length) live.push("GDP, the wealth measure (World Bank)");
  if (topFlows.length) live.push("bilateral goods-trade flows (IMF DOTS via DBnomics)");

  const meta: MFMeta = {
    asOf: new Date().toISOString().slice(0, 10),
    live,
    diag:
      `wealth countries ${wealth.length}; trade web top ${top.length}; ` +
      `DBnomics DOT pages ${dotPagesOk}, num_found ${dotNumFound}, flows parsed ${raw.length}, arcs shown ${topFlows.length}`,
  };

  return <MoneyFlowClient wealth={wealth} flows={topFlows} meta={meta} />;
}
