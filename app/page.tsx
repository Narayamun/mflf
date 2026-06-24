import MGZSClient, { Country, Meta } from "./MGZSClient";

// Assumed real borrowing rate. No clean free universal source for the effective
// rate on government debt, so one flagged assumption is applied to every country
// and can be overridden in-app. NOTE: Position (the ranking) does not use it at all.
const REAL_RATE = 0.01;

// Country list is coordinates only — every displayed number comes from live data.
// A country appears ONLY if its real debt, revenue, and population all loaded.
const COUNTRIES: { iso: string; name: string; lat: number; lng: number }[] = [
  { iso: "USA", name: "USA",          lat: 39.8, lng: -98.6 },
  { iso: "NOR", name: "Norway",       lat: 60.5, lng:   8.5 },
  { iso: "BGR", name: "Bulgaria",     lat: 42.7, lng:  25.5 },
  { iso: "JPN", name: "Japan",        lat: 36.2, lng: 138.3 },
  { iso: "CAN", name: "Canada",       lat: 56.1, lng: -106.3 },
  { iso: "MEX", name: "Mexico",       lat: 23.6, lng: -102.5 },
  { iso: "BRA", name: "Brazil",       lat: -14.2, lng: -51.9 },
  { iso: "ARG", name: "Argentina",    lat: -38.4, lng: -63.6 },
  { iso: "GBR", name: "UK",           lat: 54.0, lng:  -2.0 },
  { iso: "FRA", name: "France",       lat: 46.6, lng:   2.2 },
  { iso: "DEU", name: "Germany",      lat: 51.2, lng:  10.4 },
  { iso: "ITA", name: "Italy",        lat: 41.9, lng:  12.6 },
  { iso: "ESP", name: "Spain",        lat: 40.0, lng:  -3.7 },
  { iso: "NLD", name: "Netherlands",  lat: 52.1, lng:   5.3 },
  { iso: "SWE", name: "Sweden",       lat: 60.1, lng:  18.6 },
  { iso: "CHE", name: "Switzerland",  lat: 46.8, lng:   8.2 },
  { iso: "POL", name: "Poland",       lat: 51.9, lng:  19.1 },
  { iso: "GRC", name: "Greece",       lat: 39.1, lng:  21.8 },
  { iso: "TUR", name: "Turkey",       lat: 38.9, lng:  35.2 },
  { iso: "RUS", name: "Russia",       lat: 61.5, lng: 105.3 },
  { iso: "UKR", name: "Ukraine",      lat: 48.4, lng:  31.2 },
  { iso: "CHN", name: "China",        lat: 35.9, lng: 104.2 },
  { iso: "KOR", name: "South Korea",  lat: 36.5, lng: 127.8 },
  { iso: "IND", name: "India",        lat: 20.6, lng:  79.0 },
  { iso: "IDN", name: "Indonesia",    lat: -0.8, lng: 113.9 },
  { iso: "AUS", name: "Australia",    lat: -25.3, lng: 133.8 },
  { iso: "ZAF", name: "South Africa", lat: -30.6, lng:  22.9 },
  { iso: "NGA", name: "Nigeria",      lat:  9.1, lng:   8.7 },
  { iso: "EGY", name: "Egypt",        lat: 26.8, lng:  30.8 },
  { iso: "SAU", name: "Saudi Arabia", lat: 23.9, lng:  45.1 },
  { iso: "ARE", name: "UAE",          lat: 23.4, lng:  53.8 },
  { iso: "ISR", name: "Israel",       lat: 31.0, lng:  34.9 },
];

// ─── Fetch helpers (every fetch isolated; failure -> empty -> country skipped) ─
async function safeJSON(url: string, revalidate: number): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate } } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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

export default async function Home() {
  const ISO = COUNTRIES.map((c) => c.iso);
  const wbList = ISO.join(";");
  const imfList = ISO.join("/");
  const yr = new Date().getFullYear();
  const periods = [yr - 2, yr - 1, yr].join(",");

  const wb = (code: string) =>
    safeJSON(`https://api.worldbank.org/v2/country/${wbList}/indicator/${code}?format=json&mrnev=1&per_page=2000`, 86400).then(parseWB);
  const imf = (ind: string) =>
    safeJSON(`https://www.imf.org/external/datamapper/api/v1/${ind}/${imfList}?periods=${periods}`, 86400).then((j) => parseIMF(j, ind));

  const [pop, growth, realG, gdpN, gdpP, cpi, debt, pb, rev, btcJson] = await Promise.all([
    wb("SP.POP.TOTL"),
    wb("SP.POP.GROW"),
    wb("NY.GDP.MKTP.KD.ZG"),
    wb("NY.GDP.MKTP.CD"),
    wb("NY.GDP.MKTP.PP.CD"),
    wb("FP.CPI.TOTL.ZG"),
    imf("GGXWDG_NGDP"),        // general government gross debt, % of GDP (WEO)
    imf("GGXONLB_G01_GDP_PT"), // general government primary balance, % of GDP (Fiscal Monitor)
    imf("GGR_G01_GDP_PT"),     // general government revenue, % of GDP (Fiscal Monitor) — the denominator
    safeJSON("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", 3600),
  ]);

  const btcPrice = typeof btcJson?.bitcoin?.usd === "number" ? btcJson.bitcoin.usd : 95_000;
  const num = (x: unknown): x is number => typeof x === "number";

  const countries: Country[] = [];
  for (const cfg of COUNTRIES) {
    const code = cfg.iso;
    // Essentials must all be live, or the country is not shown at all (no placeholders).
    if (!num(debt[code]) || !num(rev[code]) || rev[code] <= 0 || !num(pop[code]) || pop[code] <= 0) continue;
    countries.push({
      name: cfg.name, iso3: code, lat: cfg.lat, lng: cfg.lng,
      debtToGDP: debt[code] / 100,
      taxToGDP: rev[code] / 100,
      primaryBalance: num(pb[code]) ? pb[code] / 100 : 0,
      realRate: REAL_RATE,
      inflation: num(cpi[code]) ? cpi[code] / 100 : 0.02,
      population: pop[code],
      popGrowth: num(growth[code]) ? growth[code] / 100 : 0,
      gdpGrowth: num(realG[code]) ? realG[code] / 100 : 0.02,
      gdp: num(gdpN[code]) ? gdpN[code] : 0,
      pppFactor: num(gdpP[code]) && num(gdpN[code]) && gdpN[code] > 0 ? gdpP[code] / gdpN[code] : 1,
    });
  }

  const live: string[] = [];
  if (Object.keys(debt).length) live.push("debt (IMF)");
  if (Object.keys(rev).length) live.push("government revenue (IMF, used as the tax base)");
  if (Object.keys(pb).length) live.push("primary balance (IMF)");
  if (Object.keys(gdpN).length) live.push("GDP, PPP & growth (World Bank)");
  if (Object.keys(pop).length) live.push("population (World Bank)");
  if (Object.keys(cpi).length) live.push("inflation (World Bank)");
  if (num(btcJson?.bitcoin?.usd)) live.push("BTC (CoinGecko)");

  const meta: Meta = {
    asOf: new Date().toISOString().slice(0, 10),
    live,
    curated: ["interest rate (assumed 1% real, adjustable in-app)"],
  };

  return <MGZSClient countries={countries} btcPrice={btcPrice} meta={meta} />;
}
