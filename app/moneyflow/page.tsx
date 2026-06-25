import MoneyFlowClient, { WealthRow, Flow, MFMeta, Partner, Pulse, PulseCorridor } from "./MoneyFlowClient";

const TOP_N = 135;
const MAX_ARCS = 400;
const PULSE_CORRIDORS = 60;

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
function areasFromCode(code: any): [string, string] | null {
  if (typeof code !== "string") return null;
  const p = code.split(".");
  if (p.length >= 4) return [p[1].toUpperCase(), p[3].toUpperCase()];
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
  const [geoJson, gdpJson] = await Promise.all([
    safeJSON("https://api.worldbank.org/v2/country?format=json&per_page=400", 86400),
    safeJSON("https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1&per_page=20000", 86400),
  ]);

  const geo = parseGeo(geoJson);
  const gdp = parseWB(gdpJson);
  const byIso2 = new Map<string, Geo>();
  const byIso3 = new Map<string, Geo>();
  for (const g of geo) { byIso2.set(g.iso2, g); byIso3.set(g.iso3, g); }

  const baseWealth = geo
    .filter((g) => typeof gdp[g.iso3] === "number" && gdp[g.iso3] > 0)
    .map((g) => ({ ...g, gdpUSD: gdp[g.iso3] }))
    .sort((a, b) => b.gdpUSD - a.gdpUSD);

  const top = baseWealth.slice(0, TOP_N);
  const topIso2 = top.map((w) => w.iso2);
  const topSet = new Set(top.map((w) => w.iso3));

  // Stage 2: annual DBnomics IMF/DOT export matrix among those economies.
  type RawFlow = Flow & { fromIso3: string; toIso3: string };
  const raw: RawFlow[] = [];
  const expSum: Record<string, number> = {};
  const impSum: Record<string, number> = {};
  const pairVal: Record<string, number> = {};
  const outP: Record<string, Partner[]> = {};
  const inP: Record<string, Partner[]> = {};

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
        const usd = millions * 1e6;
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

  for (const r of raw) {
    const fwd = pairVal[r.fromIso3 + ">" + r.toIso3] || 0;
    const rev = pairVal[r.toIso3 + ">" + r.fromIso3] || 0;
    r.dominant = fwd >= rev;
  }

  raw.sort((a, b) => b.valueUSD - a.valueUSD);
  const topFlows: Flow[] = raw.slice(0, MAX_ARCS).map((r) => ({
    from: r.from, to: r.to, fromLat: r.fromLat, fromLng: r.fromLng,
    toLat: r.toLat, toLng: r.toLng, valueUSD: r.valueUSD, dominant: r.dominant,
  }));

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

  // Stage 3: monthly pulse + monthly world total, in one series-id batch.
  //   • heaviest corridors  -> animated arcs
  //   • <reporter> -> W00    -> summed into the month's world total
  //   • W00 -> W00           -> IMF's own world total (preferred if present)
  let pulse: Pulse | null = null;
  let pulseDocs = 0;
  const seed = raw.slice(0, PULSE_CORRIDORS);

  const seedByPair = new Map<string, RawFlow>();
  const corridorIds: string[] = [];
  for (const r of seed) {
    const fa = byIso3.get(r.fromIso3)?.iso2;
    const ta = byIso3.get(r.toIso3)?.iso2;
    if (!fa || !ta) continue;
    seedByPair.set(fa + ">" + ta, r);
    corridorIds.push("IMF/DOT/M." + fa + ".TXG_FOB_USD." + ta);
  }
  const worldIds = top.map((w) => "IMF/DOT/M." + w.iso2 + ".TXG_FOB_USD.W00");
  const allIds = ["IMF/DOT/M.W00.TXG_FOB_USD.W00", ...corridorIds, ...worldIds];

  const monthlyByPair: Record<string, Record<string, number>> = {};
  const worldDirect: Record<string, number> = {};   // W00 -> W00 (IMF's own total)
  const reporterSum: Record<string, number> = {};   // Σ reporter -> W00

  if (allIds.length > 0) {
    for (let i = 0; i < allIds.length; i += 50) {
      const chunk = allIds.slice(i, i + 50);
      const url = "https://api.db.nomics.world/v22/series?observations=1&format=json&series_ids=" +
        encodeURIComponent(chunk.join(","));
      const json = await safeJSON(url, 86400);
      const docs = Array.isArray(json?.series?.docs) ? json.series.docs : null;
      if (!docs) continue;
      for (const doc of docs) {
        let from = dimOf(doc, "REF_AREA");
        let to = dimOf(doc, "COUNTERPART_AREA");
        if (!from || !to) {
          const ac = areasFromCode(doc?.series_code);
          if (ac) { from = ac[0]; to = ac[1]; }
        }
        if (!from || !to) continue;
        const periods = doc?.period;
        const vals = doc?.value;
        if (!Array.isArray(periods) || !Array.isArray(vals)) continue;
        pulseDocs++;

        if (to === "W00") {
          // World totals: keep IMF's own (W00->W00) and a reporter-sum fallback.
          for (let k = 0; k < periods.length; k++) {
            const v = vals[k];
            if (typeof v !== "number" || Number.isNaN(v) || typeof periods[k] !== "string") continue;
            const usd = v * 1e6;
            if (from === "W00") worldDirect[periods[k]] = usd;
            else reporterSum[periods[k]] = (reporterSum[periods[k]] || 0) + usd;
          }
          continue;
        }

        const key = from + ">" + to;
        if (!seedByPair.has(key)) continue; // only the corridors we seeded
        const m = monthlyByPair[key] || (monthlyByPair[key] = {});
        for (let k = 0; k < periods.length; k++) {
          const v = vals[k];
          if (typeof v === "number" && !Number.isNaN(v) && typeof periods[k] === "string") m[periods[k]] = v * 1e6;
        }
      }
    }
  }

  // Window: 12 consecutive calendar months ending at the latest reported month
  // (across corridors and the world series, so the headline number lines up).
  const allMonths = new Set<string>();
  for (const key of Object.keys(monthlyByPair)) for (const mo of Object.keys(monthlyByPair[key])) allMonths.add(mo);
  for (const mo of Object.keys(worldDirect)) allMonths.add(mo);
  for (const mo of Object.keys(reporterSum)) allMonths.add(mo);
  const valid = Array.from(allMonths).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  const months: string[] = [];
  if (valid.length > 0) {
    const [my, mm] = valid[valid.length - 1].split("-").map(Number);
    let yy = my, mo = mm;
    for (let k = 0; k < 12; k++) {
      months.unshift(yy + "-" + String(mo).padStart(2, "0"));
      mo--; if (mo === 0) { mo = 12; yy--; }
    }
  }

  if (months.length > 0) {
    const corridors: PulseCorridor[] = [];
    for (const key of Object.keys(monthlyByPair)) {
      const s = seedByPair.get(key);
      if (!s) continue;
      const a = byIso3.get(s.fromIso3);
      const b = byIso3.get(s.toIso3);
      if (!a || !b) continue;
      const monthly: Record<string, number> = {};
      for (const mo of months) if (typeof monthlyByPair[key][mo] === "number") monthly[mo] = monthlyByPair[key][mo];
      if (Object.keys(monthly).length === 0) continue;
      corridors.push({
        from: a.name, to: b.name, fromLat: a.lat, fromLng: a.lng, toLat: b.lat, toLng: b.lng,
        dominant: s.dominant, monthly,
      });
    }
    // Prefer IMF's own world figure; fall back to the reporter sum where it's missing.
    const totals: Record<string, number> = {};
    for (const mo of months) {
      const v = typeof worldDirect[mo] === "number" ? worldDirect[mo] : reporterSum[mo];
      if (typeof v === "number" && v > 0) totals[mo] = v;
    }
    if (corridors.length > 0) pulse = { months, corridors, totals };
  }

  const live: string[] = [];
  if (wealth.length) live.push("GDP, the wealth measure (World Bank)");
  if (topFlows.length) live.push("annual goods-trade flows (IMF DOTS via DBnomics)");
  if (pulse) live.push("monthly pulse + world total on the heaviest corridors");

  const meta: MFMeta = {
    asOf: new Date().toISOString().slice(0, 10),
    live,
    diag:
      `wealth countries ${wealth.length}; trade web top ${top.length}; ` +
      `annual DOT pages ${dotPagesOk}, num_found ${dotNumFound}, flows parsed ${raw.length}, arcs shown ${topFlows.length}; ` +
      `pulse docs ${pulseDocs}, months ${pulse?.months.length || 0}, corridors ${pulse?.corridors.length || 0}, ` +
      `world-direct ${Object.keys(worldDirect).length}, reporter-sum ${Object.keys(reporterSum).length}`,
  };

  return <MoneyFlowClient wealth={wealth} flows={topFlows} pulse={pulse} meta={meta} />;
}
