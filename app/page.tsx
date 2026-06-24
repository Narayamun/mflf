import MGZSClient, { Country, Meta } from "./MGZSClient";

// Assumed real borrowing rate. No clean free universal source for the effective
// rate on government debt, so one flagged assumption is applied to every country
// and can be overridden in-app. NOTE: Position (the ranking) does not use it at all.
const REAL_RATE = 0.01;

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function safeJSON(url: string, revalidate: number): Promise<any> {
  try {
    const res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MGZS/1.0)" },
    } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// World Bank country universe (names + capital coordinates), aggregates removed.
function parseCountries(json: any): { iso: string; name: string; lat: number; lng: number }[] {
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return [];
  const out: { iso: string; name: string; lat: number; lng: number }[] = [];
  for (const r of rows) {
    const iso = r?.id;
    const name = r?.name;
    const lat = parseFloat(r?.latitude);
    const lng = parseFloat(r?.longitude);
    if (!iso || !name) continue;
    if (r?.region?.value === "Aggregates") continue;
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    out.push({ iso, name, lat, lng });
  }
  return out;
}

// World Bank indicator: [meta, [ {countryiso3code, value}, ... ] ] -> { ISO3: value }
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

// IMF DataMapper: { values: { IND: { ISO3: { year: value } } } } -> { ISO3: latest non-future value }
function parseIMF(json: any, indicator: string): Record<string, number> {
  const out: Record<string, number> = {};
  const block = json?.values?.[indicator];
  if (!block || typeof block !== "object") return out;
  const curY = new Date().getFullYear();
  for (const code of Object.keys(block)) {
    const series = block[code];
    if (!series || typeof series !== "object") continue;
    const years = Object.keys(series)
      .filter((y) => typeof series[y] === "number")
      .map(Number)
      .filter((y) => !Number.isNaN(y))
      .sort((a, b) => a - b);
    if (!years.length) continue;
    const notFuture = years.filter((y) => y <= curY);
    const pick = notFuture.length ? notFuture[notFuture.length - 1] : years[years.length - 1];
    out[code] = series[String(pick)];
  }
  return out;
}

export default async function Home() {
  // World Bank indicators for every country at once; IMF indicators whole.
  const wb = (code: string) =>
    safeJSON(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=20000`, 86400).then(parseWB);
  const imf = (ind: string) =>
    safeJSON(`https://www.imf.org/external/datamapper/api/v1/${ind}`, 86400).then((j) => parseIMF(j, ind));

  const [countryJson, pop, growth, realG, gdpN, gdpP, cpi, debt, pb, rev, btcJson] = await Promise.all([
    safeJSON("https://api.worldbank.org/v2/country?format=json&per_page=400", 86400),
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

  const universe = parseCountries(countryJson);
  const btcPrice = typeof btcJson?.bitcoin?.usd === "number" ? btcJson.bitcoin.usd : 95_000;
  const num = (x: unknown): x is number => typeof x === "number";

  const countries: Country[] = [];
  for (const cfg of universe) {
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
    diag: `feeds → debt ${Object.keys(debt).length}, revenue ${Object.keys(rev).length}, primary-balance ${Object.keys(pb).length}, population ${Object.keys(pop).length}, gdp ${Object.keys(gdpN).length}; country universe ${universe.length}; countries shown ${countries.length}`,
  };

  return <MGZSClient countries={countries} btcPrice={btcPrice} meta={meta} />;
}
