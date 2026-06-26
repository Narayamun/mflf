"use client";

import { useState } from "react";
import Globe, { GlobePoint } from "./Globe";
import Trajectory, { TrajPoint } from "./Trajectory";

// ─── Constants ──────────────────────────────────────────────────────────────
const GG = 28; // generation gap in years (maps years → descendant generations)

function velocityColor(velocity: number) {
  if (velocity < 0) return "#22c55e";
  if (velocity < 0.003) return "#f59e0b";
  return "#dc2626";
}

// ─── Types (shared with the server component in page.tsx) ─────────────────────
// One year of the three IMF flows the trajectory needs (all as decimal fractions).
export type SeriesPoint = {
  year: number;
  debtToGDP: number;
  primaryBalance: number;
  taxToGDP: number;
};

export type Country = {
  name: string;
  iso3: string;
  lat: number;
  lng: number;
  debtToGDP: number;
  taxToGDP: number;
  primaryBalance: number;
  realRate: number;
  inflation: number;
  population: number;
  popGrowth: number;
  gdpGrowth: number;   // real GDP growth (for the debt-snowball test)
  gdp: number;         // nominal USD
  pppFactor: number;   // GDP_PPP / GDP_nominal
  series: SeriesPoint[]; // per-year debt / primary balance / revenue, oldest→newest
};

export type Meta = { asOf: string; live: string[]; curated: string[]; diag?: string };
export type Props = { countries: Country[]; btcPrice: number; meta: Meta };

type Currency = "usd" | "ppp" | "btc";
type Opts = { useReal: boolean; manualRate: number | null; currency: Currency; wy: number };
type SortKey = "name" | "position" | "velocity" | "govt" | "inherited" | "nextgen";

// ─── Core maths (verified against handoff §2.6) ───────────────────────────────
function rate(c: Country, { useReal, manualRate, currency }: Opts) {
  if (manualRate != null) return manualRate;
  if (currency === "btc") return c.realRate + c.inflation; // hard money: inflation cannot erase the claim
  return useReal ? c.realRate : c.realRate + c.inflation;
}

function compute(c: Country, opts: Opts) {
  const i = rate(c, opts);
  const wy = opts.wy;
  const denom = c.taxToGDP * wy;

  const LFF = c.debtToGDP / denom;                 // POSITION (fraction of a working life)
  const yearsToClear = c.debtToGDP / c.taxToGDP;   // = LFF*wy, INDEPENDENT of working-life length
  const livesOwed = LFF * c.population;

  const interestFlow = (i * c.debtToGDP) / denom;  // inherited tribute, per year
  const govFlow = (-c.primaryBalance) / denom;      // current government's own addition, per year
  const velocity = interestFlow + govFlow;

  const nextGenLFF = LFF / Math.pow(1 + c.popGrowth, GG);

  // cumulative interest over one generation, as a share of a working life (wy cancels out)
  const tribLifeShare = (i * c.debtToGDP) / c.taxToGDP; // = interestFlow * wy
  const tribLives = tribLifeShare * c.population;

  // debt snowball (structural, real terms): pb* = (realRate − realGrowth) * debt/GDP
  const pbStar = (c.realRate - c.gdpGrowth) * c.debtToGDP;
  const snowballing = c.primaryBalance < pbStar;
  const borrowingForInterest = c.primaryBalance < 0;

  return {
    i, LFF, yearsToClear, nextGenLFF, velocity, livesOwed,
    livesPerYear: velocity * c.population,
    livesGovt: govFlow * c.population,
    livesInherited: interestFlow * c.population,
    tribLifeShare, tribLives, pbStar, snowballing, borrowingForInterest,
  };
}

// Per-year velocity for the trajectory chart. Uses the SAME rate() and denominator
// as compute(), so the chart reacts to the interest and working-life lenses.
// Plotted as a PERCENTAGE (velocity × 100), not lives/year: population is fetched
// latest-only, so a lives figure would smear today's population across past years.
// Historical = years ≤ now (solid). Projection = IMF forecast years, capped at +5
// (dashed). We deliberately do NOT fabricate an "own extrapolation" tier — every
// point on the line is a real IMF figure; the only assumption is the flagged rate,
// and that sits only in the interest term (the government term is pure IMF data).
const PROJ_CAP_YEARS = 5;
function buildTrajectory(c: Country, opts: Opts): TrajPoint[] {
  if (!c.series || c.series.length < 2) return [];
  const i = rate(c, opts);
  const wy = opts.wy;
  const curY = new Date().getFullYear();
  const cap = curY + PROJ_CAP_YEARS;
  const out: TrajPoint[] = [];
  for (const s of c.series) {
    if (s.year > cap) continue;
    if (s.taxToGDP <= 0) continue;
    const denom = s.taxToGDP * wy;
    const interestFlow = (i * s.debtToGDP) / denom; // assumed-rate term
    const govFlow = -s.primaryBalance / denom;       // pure IMF primary balance
    const velocity = interestFlow + govFlow;
    out.push({ year: s.year, velocityPct: velocity * 100, projected: s.year > curY });
  }
  return out;
}


const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

function money(valueUSD: number, currency: Currency, ppp: number, btcPrice: number) {
  if (currency === "btc") {
    const btc = valueUSD / btcPrice;
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

function relation(genIndex: number) {
  if (genIndex <= 0) return "your children";
  if (genIndex === 1) return "your grandchildren";
  return "your " + "great-".repeat(genIndex - 1) + "grandchildren";
}

// ─── Tooltip ("?" badge; hover on desktop, tap on mobile) ─────────────────────
function Info({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow((s) => !s)}
        style={{
          cursor: "help", fontSize: 10, fontWeight: 700, color: "#fff", background: "#9aa3b2",
          borderRadius: "50%", width: 15, height: 15, display: "inline-flex",
          alignItems: "center", justifyContent: "center", marginLeft: 5, verticalAlign: "middle",
        }}
      >?</span>
      {show && (
        <span style={{
          position: "absolute", bottom: "150%", left: "50%", transform: "translateX(-50%)",
          width: 240, background: "#111", color: "#fff", fontSize: 12, lineHeight: 1.45,
          fontWeight: 400, padding: "9px 11px", borderRadius: 7, zIndex: 20,
          boxShadow: "0 3px 12px rgba(0,0,0,.35)", textAlign: "left",
        }}>{text}</span>
      )}
    </span>
  );
}

const TIP = {
  position: "How much of this generation's entire working-life taxes the current debt equals. This is the principal only, and it stops with today's adults.",
  years: "If every tax dollar collected from everyone went to nothing but clearing the debt, this is how many years it would take. It does NOT change when you adjust the working-life slider.",
  velocity: "How many citizen-lifetimes of tax get newly committed (red) or freed (green) each year. This is the part that actually reaches your descendants.",
  govt: "The share of this year's change caused by the government spending more than it collects, before interest. A choice that can be reversed.",
  inherited: "The share caused purely by interest on debt that already existed. Owed every year the principal stands, and it buys nothing new.",
  tribute: "Interest paid across one whole generation, as a share of a working life. Set it beside the principal: you pay nearly the debt's value again and still owe the principal.",
  wy: "How many years a person works before retiring. Extending it makes the debt a smaller percentage of a lifetime without changing the debt itself.",
  status: "Whether the debt-to-GDP ratio rises or falls on its own, comparing the real borrowing rate against real growth. 'Snowballing' means it grows even if the government changed nothing.",
};

// ─── UI ─────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 10, padding: 16, background: "#fafafa" };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6,
  border: "1px solid " + (active ? "#222" : "#ccc"),
  background: active ? "#222" : "#fff", color: active ? "#fff" : "#333",
});

export default function MGZSClient({ countries, btcPrice, meta }: Props) {
  const [useReal, setUseReal] = useState(true);
  const [manualOn, setManualOn] = useState(false);
  const [manualRate, setManualRate] = useState(0.05);
  const [currency, setCurrency] = useState<Currency>("usd");
  const [genAdjust, setGenAdjust] = useState(false);
  const [wy, setWy] = useState(47);
  const [selected, setSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showAll, setShowAll] = useState(false);

  const opts: Opts = { useReal, manualRate: manualOn ? manualRate : null, currency, wy };
  const sel = countries.find((c) => c.name === selected) || null;

  const rows = countries.map((c) => ({ c, r: compute(c, opts) }));
  const sortVal = (row: { c: Country; r: ReturnType<typeof compute> }): number | string => {
    switch (sortKey) {
      case "name": return row.c.name;
      case "position": return row.r.LFF;
      case "velocity": return row.r.livesPerYear;
      case "govt": return row.r.livesGovt;
      case "inherited": return row.r.livesInherited;
      case "nextgen": return row.r.nextGenLFF;
    }
  };
  rows.sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortDir === "asc" ? cmp : -cmp;
  });
  const shown = showAll ? rows : rows.slice(0, 20);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };
  const arrow = (k: SortKey) => (
    <span style={{ color: sortKey === k ? "#222" : "#c5c5c5", fontSize: 11, marginLeft: 3 }}>
      {sortKey === k ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
    </span>
  );

  const points: GlobePoint[] = countries.map((c) => {
    const r = compute(c, opts);
    return {
      name: c.name, lat: c.lat, lng: c.lng,
      altitude: 0.03 + r.LFF * 2,
      color: velocityColor(r.velocity),
      label: `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
        + `<b>${c.name}</b><br/>position ${(r.LFF * 100).toFixed(1)}%<br/>velocity ${signed(r.livesPerYear)}/yr</div>`,
    };
  });

  if (countries.length === 0) {
    return (
      <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#ffffff", borderRadius: 14 }}>
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>Generation Zero Score</h1>
        <p style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
          Live data from the IMF and World Bank couldn&apos;t be loaded right now. Rather than show stale or
          placeholder figures, nothing is displayed. Please refresh in a moment.
        </p>
        {meta.diag && <p style={{ color: "#aaa", fontSize: 11, fontFamily: "monospace" }}>{meta.diag}</p>}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#ffffff", borderRadius: 14 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Generation Zero Score</h1>
      <p style={{ color: "#666", marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
        <b>Position</b> = how mortgaged this generation is right now (the principal, gives the ranking).
        <b> Velocity</b> = citizen-lifetimes mortgaged (red) or freed (green) per year. Negative means a country is
        buying its citizens back, surfacing toward Generation Zero.
      </p>

      <div style={{ fontSize: 11, color: "#888", marginBottom: 20, lineHeight: 1.5, borderLeft: "3px solid #ddd", paddingLeft: 10 }}>
        <b>Live</b> ({meta.asOf}): {meta.live.join(", ")}.<br />
        <b>Interest</b>: {meta.curated.join(", ")}. Position (the ranking) doesn&apos;t use the rate at all.<br />
        The denominator is government revenue, slightly broader than pure tax, so resource-rich states read a little lighter than a tax-only measure would show.
        {meta.diag && <><br /><span style={{ fontFamily: "monospace", color: "#aaa" }}>{meta.diag}</span></>}
      </div>

      {/* ── Lenses ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12, marginBottom: 20 }}>
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

        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 }}>CURRENCY</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button style={chip(currency === "usd")} onClick={() => setCurrency("usd")}>USD</button>
            <button style={chip(currency === "ppp")} onClick={() => setCurrency("ppp")}>PPP</button>
            <button style={chip(currency === "btc")} onClick={() => setCurrency("btc")}>BTC</button>
          </div>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4 }}>
            {currency === "usd" && "Raw dollars: exposes global power asymmetry."}
            {currency === "ppp" && "Purchasing power: same fraction as USD; absolute figures differ."}
            {currency === "btc" && `Hard money (₿ at $${fmt(btcPrice)}): inflation can no longer erase the claim.`}
          </div>
        </div>

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

        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 }}>
            WORKING LIFE<Info text={TIP.wy} />
          </div>
          <input type="range" min={35} max={55} step={1} value={wy}
            onChange={(e) => setWy(parseInt(e.target.value))} style={{ width: "100%" }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{wy} years</div>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4, marginTop: 6 }}>
            Stretch it and watch Position shrink while the debt itself never moves.
          </div>
        </div>
      </div>

      {/* ── Globe ── */}
      <Globe points={points} onSelect={(name) => setSelected(name === selected ? null : name)} />
      <p style={{ fontSize: 11, color: "#aaa", margin: "0 0 20px" }}>
        Bar height = how mortgaged now (Position). Colour = direction (green surfacing, amber/red sinking).
        Drag to rotate; click a bar for detail.
      </p>

      {/* ── Table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", userSelect: "none" }}>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("name")}>Country{arrow("name")}</th>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("position")}>Mortgaged now<Info text={TIP.position} />{arrow("position")}</th>
            {genAdjust && <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("nextgen")}>next-gen per head{arrow("nextgen")}</th>}
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("velocity")}>Lives / year<Info text={TIP.velocity} />{arrow("velocity")}</th>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("govt")}>…govt adds<Info text={TIP.govt} />{arrow("govt")}</th>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("inherited")}>…inherited<Info text={TIP.inherited} />{arrow("inherited")}</th>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("velocity")}>Direction{arrow("velocity")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ c, r }, idx) => {
            const freeing = r.livesPerYear < 0;
            const isSel = selected === c.name;
            return (
              <tr key={c.iso3}
                onClick={() => setSelected(isSel ? null : c.name)}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer", background: isSel ? "#eef3ff" : "transparent" }}>
                <td style={{ padding: 8, fontWeight: 600 }}><span style={{ color: "#bbb", marginRight: 6 }}>{idx + 1}</span>{c.name}</td>
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        {countries.length > 20 && (
          <button onClick={() => setShowAll((s) => !s)} style={chip(showAll)}>
            {showAll ? `Show top 20` : `Show all ${countries.length}`}
          </button>
        )}
        <span style={{ fontSize: 11, color: "#aaa" }}>
          Showing {shown.length} of {countries.length}. Click a column to sort, again to reverse. Click a country for its bloodline reach.
        </span>
      </div>

      {/* ── Detail panel ── */}
      {sel && (() => {
        const r = compute(sel, opts);
        const traj = buildTrajectory(sel, opts);
        const lifetimeTax = sel.gdp * sel.taxToGDP * wy;
        const interestBill = r.i * sel.debtToGDP * sel.gdp;
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
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{sel.name}</div>

            {/* SELF REACH */}
            <div style={{ fontWeight: 700, fontSize: 13, color: "#555", marginTop: 4 }}>Self reach<Info text={TIP.position} /></div>
            <p style={{ margin: "4px 0", color: "#333" }}>
              Today's debt equals <b>{(r.LFF * 100).toFixed(1)}%</b> of all the tax this generation pays across a
              working life. Picture it as everyone's taxes for about <b>{r.yearsToClear.toFixed(1)} years</b>
              <Info text={TIP.years} /> going to nothing but the debt. It is bounded, and it stops with you: it does
              not reach your children.
            </p>
            <p style={{ margin: "4px 0 12px", color: "#8a6d00", fontSize: 13, background: "#fff8e6", border: "1px solid #f0e0a0", borderRadius: 6, padding: "8px 10px" }}>
              <b>But this is a clean-payoff hypothetical.</b> The principal is almost never repaid. Governments roll it
              over and pay only the interest, so across one generation the interest alone comes to
              about <b>{(r.tribLifeShare * 100).toFixed(1)}%</b> of a working life — about <b>{(r.tribLifeShare / r.LFF).toFixed(1)}×</b>
              {" "}the principal itself ({(r.LFF * 100).toFixed(1)}%) — and at the end the full principal is still owed. The
              {" "}{r.yearsToClear.toFixed(1)}-year figure is a floor that never actually gets cleared.
            </p>

            {/* BLOODLINE REACH */}
            <div style={{ fontWeight: 700, fontSize: 13, color: "#555" }}>Bloodline reach<Info text={TIP.velocity} /></div>
            {reach}
            {genAdjust && (
              <p style={{ margin: "8px 0", color: "#333" }}>
                <b>Branching ({(sel.popGrowth * 100).toFixed(1)}%/yr).</b> One generation down, the per-descendant
                share moves from {(r.LFF * 100).toFixed(1)}% to <b>{(r.nextGenLFF * 100).toFixed(1)}%</b> —
                the line {sel.popGrowth >= 0 ? "widens and dilutes the claim" : "narrows and concentrates the claim on fewer shoulders"}.
              </p>
            )}

            {/* VELOCITY TRAJECTORY */}
            {traj.length >= 2 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#555", marginBottom: 4 }}>
                  Velocity over time<Info text={TIP.velocity} />
                </div>
                <Trajectory data={traj} />
                <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0", lineHeight: 1.5 }}>
                  Debt, primary balance and revenue are IMF figures (history solid, forecast dashed, capped at five
                  years). The government term is pure IMF data; the interest term uses each country&apos;s live effective
                  rate, so the line shifts with the interest and working-life lenses.
                </p>
              </div>
            )}

            {/* TRIBUTE + DEBT STATUS */}
            <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap", fontSize: 13, color: "#555", borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div>Principal now<br /><b style={{ fontSize: 15, color: "#1a1a1a" }}>{(r.LFF * 100).toFixed(1)}% of a life</b></div>
              <div>Interest over one generation<Info text={TIP.tribute} /><br />
                <b style={{ fontSize: 15, color: "#b00" }}>{(r.tribLifeShare * 100).toFixed(1)}% of a life</b>
                <span style={{ color: "#888" }}> ({fmt(r.tribLives)} lives)</span>
              </div>
              <div>Lifetime tax output<br /><b style={{ fontSize: 15, color: "#1a1a1a" }}>{money(lifetimeTax, currency, sel.pppFactor, btcPrice)}</b></div>
              <div>Annual interest bill<br /><b style={{ fontSize: 15, color: "#1a1a1a" }}>{money(interestBill, currency, sel.pppFactor, btcPrice)}</b></div>
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 13 }}>
              <b>Debt status<Info text={TIP.status} />:</b>{" "}
              {r.snowballing
                ? <span style={{ color: "#b00", fontWeight: 600 }}>Snowballing</span>
                : <span style={{ color: "#070", fontWeight: 600 }}>Stabilising</span>}
              {" "}— the debt ratio {r.snowballing ? "rises" : "holds or falls"} on its own at current real rates and growth
              {r.borrowingForInterest ? ", and the country is currently borrowing to cover its interest." : "."}
            </p>

            <p style={{ fontSize: 12, color: "#888", marginTop: 14, lineHeight: 1.5, fontStyle: "italic" }}>
              The debt's size is a fraction of your own generation, but its trajectory reaches down your entire
              bloodline — and the gap between those two facts is political choice, not arithmetic.
            </p>
          </div>
        );
      })()}
    </main>
  );
}
