import MoneyFlowClient, { WealthRow, Flow, MFMeta } from "./MoneyFlowClient";

// How many of the largest economies form the trade web (reporters AND partners).
// Chosen dynamically from live GDP below — never hardcoded.
const TOP_N = 80;
// Cap on arcs drawn at rest, largest-first, so the globe reads as flow not mud.
const MAX_ARCS = 400;

// ─── Fetch helper (server-side: sidesteps CORS, incl. APIs that block browsers) ──
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

// World Bank country universe: names, ISO2/ISO3, capital coordinates; aggregates dropped.
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

// World Bank indicator: [meta, [ {countryiso3code, value} ]] -> { ISO3: value }
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

// DBnomics IMF/DOT: latest non-NA observation of each (reporter -> partner) export series.
// Envelope: { series: { docs: [ { REF_AREA, COUNTERPART_AREA, period:[], value:[] } ], num_found } }
// Dimension values are read flat first, then from a nested `dimensions` object as a fallback.
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

export default async function MoneyFlow() {
  // Stage 1: the country universe and live GDP (the wealth measure). Both World Bank.
  const [geoJson, gdpJson] = await Promise.all([
    safeJSON("https://api.worldbank.org/v2/country?format=json&per_page=400", 86400),
    safeJSON("https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1&per_page=20000", 86400),
  ]);

  const geo = parseGeo(geoJson);
  const gdp = parseWB(gdpJson); // ISO3 -> nominal USD
  const byIso2 = new Map<string, Geo>();
  for (const g of geo) byIso2.set(g.iso2, g);

  // Wealth list: every country that has both coordinates and live GDP.
  const wealth: WealthRow[] = geo
    .filter((g) => typeof gdp[g.iso3] === "number" && gdp[g.iso3] > 0)
    .map((g) => ({ name: g.name, iso2: g.iso2, iso3: g.iso3, lat: g.lat, lng: g.lng, gdpUSD: gdp[g.iso3] }))
    .sort((a, b) => b.gdpUSD - a.gdpUSD);

  // The trade web is the TOP_N economies by live GDP (reporters and partners alike).
  const top = wealth.slice(0, TOP_N);
  const topIso2 = top.map((w) => w.iso2);

  // Stage 2: the DBnomics IMF/DOT export matrix among those economies.
  let dotNumFound = 0;
  let dotPagesOk = 0;
  const flows: Flow[] = [];
  if (topIso2.length > 0) {
    const dims = {
      FREQ: ["A"],
      REF_AREA: topIso2,
      INDICATOR: ["TXG_FOB_USD"], // Goods, value of exports, FOB, US dollars
      COUNTERPART_AREA: topIso2,
    };
    const baseUrl =
      "https://api.db.nomics.world/v22/series/IMF/DOT?observations=1&format=json&limit=1000" +
      "&dimensions=" + encodeURIComponent(JSON.stringify(dims));

    // Page through results (cap pages so a bad response can never loop forever).
    for (let page = 0; page < 6; page++) {
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
        flows.push({
          from: a.name, to: b.name,
          fromLat: a.lat, fromLng: a.lng, toLat: b.lat, toLng: b.lng,
          valueUSD: millions * 1e6, // DOTS values are in millions of USD
        });
      }
      if (docs.length < 1000) break; // last page
    }
  }

  // Largest flows first; keep the heaviest for the resting globe.
  flows.sort((a, b) => b.valueUSD - a.valueUSD);
  const topFlows = flows.slice(0, MAX_ARCS);

  const live: string[] = [];
  if (wealth.length) live.push("GDP, the wealth measure (World Bank)");
  if (topFlows.length) live.push("bilateral goods-trade flows (IMF DOTS via DBnomics)");

  const meta: MFMeta = {
    asOf: new Date().toISOString().slice(0, 10),
    live,
    diag:
      `wealth countries ${wealth.length}; trade web top ${top.length}; ` +
      `DBnomics DOT pages ${dotPagesOk}, num_found ${dotNumFound}, flows parsed ${flows.length}, arcs shown ${topFlows.length}`,
  };

  return <MoneyFlowClient wealth={wealth} flows={topFlows} meta={meta} />;
}
