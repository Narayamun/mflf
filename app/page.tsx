"use client";

import { useState } from "react";

// ─── Constants ──────────────────────────────────────────────────────────────
const WY = 47;  // working years per lifetime (debt/life-force math)
const GG = 28;  // generation gap in years (maps years → descendant generations)
const BTC_PRICE = 95_000; // PLACEHOLDER spot price (USD). Live feed comes with step 4.

// ─── Data (STILL PLACEHOLDER — read the pattern, not the digits) ──────────────
// gdp = nominal USD; pppFactor ≈ GDP_PPP / GDP_nominal (purchasing-power lens)
const countries = [
  { name: "Norway",   debtToGDP: 0.44, taxToGDP: 0.39, primaryBalance:  0.060, realRate: 0.010, inflation: 0.030, population: 5_500_000,   popGrowth:  0.007, gdp: 485e9,    pppFactor: 0.85 },
  { name: "Bulgaria", debtToGDP: 0.24, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.010, inflation: 0.030, population: 6_400_000,   popGrowth: -0.007, gdp: 100e9,    pppFactor: 2.10 },
  { name: "Japan",    debtToGDP: 2.30, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.000, inflation: 0.020, population: 124_000_000, popGrowth: -0.005, gdp: 4200e9,   pppFactor: 1.05 },
  { name: "USA",      debtToGDP: 1.22, taxToGDP: 0.27, primaryBalance: -0.030, realRate: 0.015, inflation: 0.030, population: 335_000_000, popGrowth:  0.005, gdp: 27400e9,  pppFactor: 1.00 },
];

type Country = typeof countries[number];
type Currency = "usd" | "ppp" | "btc";
type Opts = { useReal: boolean; manualRate: number | null; currency: Currency };

// ─── Core maths (verified against handoff §2.6) ───────────────────────────────
// Interest-rate selection. Order of precedence: manual override > BTC > toggle.
// BTC is "hard money": inflation cannot quietly erase the claim, so the inflation
// credit of the real view is removed — the deflationary escape hatch is closed.
function rate(c: Country, { useReal, manualRate, currency }: Opts) {
  if (manualRate != null) return manualRate;
  if (currency === "btc") return c.realRate + c.inflation;
  return useReal ? c.realRate : c.realRate + c.inflation;
}

function compute(c: Country, opts: Opts) {
  const i = rate(c, opts);
  const denom = c.taxToGDP * WY; // one generation's lifetime tax output (in GDP-years)

  // POSITION — how mortgaged this generation already is (interest-independent)
  const LFF = c.debtToGDP / denom;
  const livesOwed = LFF * c.population;

  // VELOCITY — lives mortgaged (+) or freed (−) per year = year-on-year change in position
  const interestFlow = (i * c.debtToGDP) / denom; // inherited tribute
  const govFlow = (-c.primaryBalance) / denom;     // current government's own addition
  const velocity = interestFlow + govFlow;

  // Per-descendant share one generation down, after population growth spreads the line
  const nextGenLFF = LFF / Math.pow(1 + c.popGrowth, GG);

  return {
    i,
    LFF,
    nextGenLFF,
    velocity,
    livesOwed,
    livesPerYear: velocity * c.population,
    livesGovt: govFlow * c.population,
    livesInherited: interestFlow * c.population,
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

// Big-money in the chosen currency lens
function money(valueUSD: number, currency: Currency, ppp: number) {
  if (currency === "btc") {
    const btc = valueUSD / BTC_PRICE;
    if (btc >= 1e6) return "₿" + (btc / 1e6).toFixed(2) + "M";
    if (btc >= 1e3) return "₿" + (btc / 1e3).toFixed(1) + "k";
    return "₿" + fmt(btc);
  }
  const v = currency === "ppp" ? valueUSD * ppp : valueUSD;
  const symbol = currency === "ppp" ? "int$" : "$";
  if (v >= 1e12) return symbol + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return symbol + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return symbol + (v / 1e6).toFixed(1) + "M";
  return symbol + fmt(v);
}

// "your children" / "your grandchildren" / "your great-…-grandchildren"
function relation(genIndex: number) {
  if (genIndex <= 0) return "your children";
  if (genIndex === 1) return "your grandchildren";
  return "your " + "great-".repeat(genIndex - 1) + "grandchildren";
}

// ─── UI ─────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 10, padding: 16, background: "#fafafa" };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6,
  border: "1px solid " + (active ? "#222" : "#ccc"),
  background: active ? "#222" : "#fff", color: active ? "#fff" : "#333",
});

export default function Home() {
  const [useReal, setUseReal] = useState(false);
  const [manualOn, setManualOn] = useState(false);
  const [manualRate, setManualRate] = useState(0.05); // 5%
  const [currency, setCurrency] = useState<Currency>("usd");
  const [genAdjust, setGenAdjust] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const opts: Opts = { useReal, manualRate: manualOn ? manualRate : null, currency };
  const sel = countries.find((c) => c.name === selected) || null;

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#1a1a1a" }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Generation Zero Score</h1>
      <p style={{ color: "#666", marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
        <b>Position</b> = how mortgaged this generation is right now (interest-independent, gives the ranking).
        <b> Velocity</b> = citizen-lifetimes mortgaged (red) or freed (green) per year. Negative means a country is buying
        its citizens back, surfacing toward Generation Zero. Figures are placeholder — live data is the next step.
      </p>

      {/* ── Lenses ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>

        {/* Lens 1 — Interest */}
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 }}>INTEREST</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, opacity: manualOn ? 0.4 : 1 }}>
            <button style={chip(!useReal)} onClick={() => setUseReal(false)}>nominal</button>
            <button style={chip(useReal)} onClick={() => setUseReal(true)}>real</button>
          </div>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 6 }}>
            <input type="checkbox" checked={manualOn} onChange={(e) => setManualOn(e.target.checked)} />
            override rate
          </label>
          {manualOn && (
            <div>
              <input type="range" min={0} max={0.20} step={0.005} value={manualRate}
                onChange={(e) => setManualRate(parseFloat(e.target.value))} style={{ width: "100%" }} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>{(manualRate * 100).toFixed(1)}% on all</div>
            </div>
          )}
        </div>

        {/* Lens 2 — Currency */}
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 }}>CURRENCY</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button style={chip(currency === "usd")} onClick={() => setCurrency("usd")}>USD</button>
            <button style={chip(currency === "ppp")} onClick={() => setCurrency("ppp")}>PPP</button>
            <button style={chip(currency === "btc")} onClick={() => setCurrency("btc")}>BTC</button>
          </div>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4 }}>
            {currency === "usd" && "Raw dollars: exposes global power asymmetry."}
            {currency === "ppp" && "Purchasing power: fairest within-economy view. Same fraction as USD; absolute figures differ."}
            {currency === "btc" && "Hard money: inflation can no longer erase the claim — velocity worsens for inflators."}
          </div>
        </div>

        {/* Lens 3 — Generational adjustment */}
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 }}>GENERATIONAL</div>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={genAdjust} onChange={(e) => setGenAdjust(e.target.checked)} />
            spread across descendants
          </label>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4, marginTop: 8 }}>
            Growing populations dilute the claim; shrinking ones concentrate it on fewer shoulders.
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Country</th>
            <th style={{ padding: 8 }}>Mortgaged now (position)</th>
            {genAdjust && <th style={{ padding: 8 }}>next-gen per head</th>}
            <th style={{ padding: 8 }}>Lives / year (velocity)</th>
            <th style={{ padding: 8 }}>…govt adds</th>
            <th style={{ padding: 8 }}>…inherited</th>
            <th style={{ padding: 8 }}>Direction</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const r = compute(c, opts);
            const freeing = r.livesPerYear < 0;
            const isSel = selected === c.name;
            return (
              <tr key={c.name}
                onClick={() => setSelected(isSel ? null : c.name)}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer", background: isSel ? "#eef3ff" : "transparent" }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: 8 }}>{(r.LFF * 100).toFixed(1)}% &nbsp;({fmt(r.livesOwed)} lives)</td>
                {genAdjust && (
                  <td style={{ padding: 8, color: r.nextGenLFF > r.LFF ? "#b00" : "#070" }}>
                    {(r.nextGenLFF * 100).toFixed(1)}% {r.nextGenLFF > r.LFF ? "▲" : "▼"}
                  </td>
                )}
                <td style={{ padding: 8, fontWeight: 600, color: freeing ? "#070" : "#b00" }}>{signed(r.livesPerYear)}</td>
                <td style={{ padding: 8 }}>{signed(r.livesGovt)}</td>
                <td style={{ padding: 8 }}>{signed(r.livesInherited)}</td>
                <td style={{ padding: 8, color: freeing ? "#070" : "#b00" }}>{freeing ? "▲ surfacing" : "▼ sinking"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>Click a country for its bloodline reach.</p>

      {/* ── Bloodline / ancestry panel ── */}
      {sel && (() => {
        const r = compute(sel, opts);
        const ownLifeYears = r.LFF * WY;
        const lifetimeTax = sel.gdp * sel.taxToGDP * WY; // one generation's total tax output (USD)
        const interestBill = r.i * sel.debtToGDP * sel.gdp; // annual interest bill (USD)
        let reach: React.ReactNode;
        if (r.velocity < 0) {
          const yearsToFree = r.LFF / Math.abs(r.velocity);
          const gens = Math.floor(yearsToFree / GG);
          reach = (
            <p style={{ margin: "8px 0", color: "#070" }}>
              <b>Surfacing.</b> At the current pace the standing claim clears in ~{yearsToFree.toFixed(0)} years —
              &nbsp;<b>{relation(gens)}'s generation is the first born into Generation Zero.</b>
            </p>
          );
        } else {
          reach = (
            <p style={{ margin: "8px 0", color: "#b00" }}>
              <b>Sinking.</b> Under current behaviour the claim grows every year — no descendant in your line is ever
              born free. The trajectory reaches every projectable generation, indefinitely.
            </p>
          );
        }
        return (
          <div style={{ ...card, marginTop: 20, background: "#fff" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{sel.name} — bloodline reach</div>

            <p style={{ margin: "8px 0", color: "#333" }}>
              <b>Stock reach.</b> Today's debt is {(r.LFF * 100).toFixed(1)}% of one working life —
              about <b>{ownLifeYears.toFixed(1)} years of your own career</b>. It does not even reach your children.
            </p>

            {reach}

            {genAdjust && (
              <p style={{ margin: "8px 0", color: "#333" }}>
                <b>Branching ({(sel.popGrowth * 100).toFixed(1)}%/yr).</b> Spread one generation down, the per-descendant
                share moves from {(r.LFF * 100).toFixed(1)}% to <b>{(r.nextGenLFF * 100).toFixed(1)}%</b> —
                the line {sel.popGrowth >= 0 ? "widens and dilutes the claim" : "narrows and concentrates the claim on fewer shoulders"}.
              </p>
            )}

            <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 13, color: "#555", borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div>One generation's lifetime tax output<br /><b style={{ fontSize: 15, color: "#1a1a1a" }}>{money(lifetimeTax, currency, sel.pppFactor)}</b></div>
              <div>Annual interest bill<br /><b style={{ fontSize: 15, color: "#1a1a1a" }}>{money(interestBill, currency, sel.pppFactor)}</b></div>
            </div>

            <p style={{ fontSize: 12, color: "#888", marginTop: 14, lineHeight: 1.5, fontStyle: "italic" }}>
              The debt's size is a fraction of your own generation, but its trajectory reaches down your entire bloodline —
              and the gap between those two facts is political choice, not arithmetic.
            </p>
          </div>
        );
      })()}
    </main>
  );
}
