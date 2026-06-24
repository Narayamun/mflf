import MGZSClient, { Country, Meta } from "./MGZSClient";

// ─── Curated defaults + fallback (used when a live value is missing) ──────────
// taxToGDP and realRate stay curated (no clean free single-source yet).
// Everything else below is a fallback in case a live fetch fails.
const BASE: Record<string, Country> = {
  USA: { name: "USA",      iso3: "USA", debtToGDP: 1.22, taxToGDP: 0.27, primaryBalance: -0.030, realRate: 0.015, inflation: 0.030, population: 335_000_000, popGrowth:  0.005, gdp: 27400e9, pppFactor: 1.00 },
  NOR: { name: "Norway",   iso3: "NOR", debtToGDP: 0.44, taxToGDP: 0.39, primaryBalance:  0.060, realRate: 0.010, inflation: 0.030, population: 5_500_000,   popGrowth:  0.007, gdp: 485e9,   pppFactor: 0.85 },
  BGR: { name: "Bulgaria", iso3: "BGR", debtToGDP: 0.24, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.010, inflation: 0.030, population: 6_400_000,   popGrowth: -0.007, gdp: 100e9,   pppFactor: 2.10 },
  JPN: { name: "Japan",    iso3: "JPN", debtToGDP: 2.30, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.000, inflation: 0.020, population: 124_000_000, popGrowth: -0.005, gdp: 4200e9,  pppFactor: 1.05 },
};
const ISO = ["USA", "NOR", "BGR", "JPN"];

// ─── Fetch helpers (every fetch is isolated; failure -> null -> placeholder) ──
async function safeJSON(url: string, revalidate: number): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate } } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// World Bank: [meta, [ {countryiso3code, value}, ... ] ] -> { ISO3: value }
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
async function wb(code: string): Promise<Record<string, number>> {
  const url = `https://api.worldbank.org/v2/country/${ISO.join(";")}/indicator/${code}?format=json&mrnev=1&per_page=1000`;
  return parseWB(await safeJSON(url, 86400));
}

// IMF DataMapper: { values: { IND: { ISO3: { year: value } } } } -> { ISO3: latestValue }
function parseIMF(json: any, indicator: string): Record<string, number> {
  const out: Record<string, number> = {};
  const block = json?.values?.[indicator];
  if (!block || typeof block !== "object") return out;
  for (const code of Object.keys(block)) {
    const series = block[code];
    if (!series || typeof series !== "object") continue;
    const years = Object.keys(series).filter((y) => typeof series[y] === "number").sort();
    if (years.length) out[code] = series[years[years.length - 1]];
  }
  return out;
}
async function imf(indicator: string): Promise<Record<string, number>> {
  const yr = new Date().getFullYear();
  const periods = [yr - 2, yr - 1, yr].join(",");
  const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}/${ISO.join("/")}?periods=${periods}`;
  return parseIMF(await safeJSON(url, 86400), indicator);
}

export default async function Home() {
  const [pop, growth, gdpN, gdpP, cpi, debt, pb, btcJson] = await Promise.all([
    wb("SP.POP.TOTL"),
    wb("SP.POP.GROW"),
    wb("NY.GDP.MKTP.CD"),
    wb("NY.GDP.MKTP.PP.CD"),
    wb("FP.CPI.TOTL.ZG"),
    imf("GGXWDG_NGDP"),   // general government gross debt, % of GDP
    imf("GGXONLB_NGDP"),  // general government primary balance, % of GDP
    safeJSON("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", 3600),
  ]);

  const btcPrice = typeof btcJson?.bitcoin?.usd === "number" ? btcJson.bitcoin.usd : 95_000;

  const countries: Country[] = ISO.map((code) => {
    const b = BASE[code];
    const gdp = typeof gdpN[code] === "number" ? gdpN[code] : b.gdp;
    const pppFactor = typeof gdpP[code] === "number" && typeof gdpN[code] === "number" && gdpN[code] > 0
      ? gdpP[code] / gdpN[code]
      : b.pppFactor;
    return {
      ...b,
      population: typeof pop[code] === "number" ? pop[code] : b.population,
      popGrowth: typeof growth[code] === "number" ? growth[code] / 100 : b.popGrowth,
      gdp,
      pppFactor,
      inflation: typeof cpi[code] === "number" ? cpi[code] / 100 : b.inflation,
      debtToGDP: typeof debt[code] === "number" ? debt[code] / 100 : b.debtToGDP,
      primaryBalance: typeof pb[code] === "number" ? pb[code] / 100 : b.primaryBalance,
    };
  });

  // Provenance: only claim a field is live if its fetch actually returned data.
  const live: string[] = [];
  if (Object.keys(debt).length) live.push("debt-to-GDP (IMF WEO)");
  if (Object.keys(pb).length) live.push("primary balance (IMF WEO)");
  if (Object.keys(gdpN).length) live.push("GDP & PPP (World Bank)");
  if (Object.keys(pop).length) live.push("population & growth (World Bank)");
  if (Object.keys(cpi).length) live.push("inflation (World Bank)");
  if (typeof btcJson?.bitcoin?.usd === "number") live.push("BTC price (CoinGecko)");
  if (!live.length) live.push("none reachable - showing curated fallback");

  const meta: Meta = {
    asOf: new Date().toISOString().slice(0, 10),
    live,
    curated: ["tax-to-GDP", "interest rate"],
  };

  return <MGZSClient countries={countries} btcPrice={btcPrice} meta={meta} />;
}
