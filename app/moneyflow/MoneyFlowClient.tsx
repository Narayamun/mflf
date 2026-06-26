"use client";

import { useEffect, useMemo, useState } from "react";
import GlobeArcs, { ArcDatum, CountryLight } from "../GlobeArcs";

// ─── Types (shared with the server component in page.tsx) ─────────────────────
export type Partner = { name: string; valueUSD: number };
export type WealthRow = {
  name: string; iso2: string; iso3: string; lat: number; lng: number;
  gdpUSD: number;
  expUSD: number | null; impUSD: number | null; netUSD: number | null;
  tradeToGDP: number | null; topOut: Partner[]; topIn: Partner[];
};
export type Flow = {
  from: string; to: string;
  fromLat: number; fromLng: number; toLat: number; toLng: number;
  valueUSD: number; dominant: boolean;
};
export type PulseCorridor = {
  from: string; to: string;
  fromLat: number; fromLng: number; toLat: number; toLng: number;
  dominant: boolean; monthly: Record<string, number>;
};
export type Pulse = { months: string[]; corridors: PulseCorridor[]; totals: Record<string, number> };
export type MFMeta = { asOf: string; live: string[]; diag?: string };
export type Props = {
  wealth: WealthRow[];
  flows: Flow[];
  pulse: Pulse | null;
  bilateral: Record<string, number>; // "iso3>iso3" -> exports USD (directed)
  meta: MFMeta;
};

type SortKey = "wealth" | "name" | "net" | "trade";

// ─── Formatting ───────────────────────────────────────────────────────────────
function money(v: number) {
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}
function signedMoney(v: number) {
  if (v > 0) return "+" + money(v);
  if (v < 0) return "−" + money(-v);
  return "$0";
}
const pct = (x: number) => (x * 100).toFixed(0) + "%";
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (names[parseInt(mo, 10)] || mo) + " " + y;
};

const card: React.CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 10, padding: 16, background: "#fff" };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6,
  border: "1px solid " + (active ? "#222" : "#ccc"),
  background: active ? "#222" : "#fff", color: active ? "#fff" : "#333",
});
const th: React.CSSProperties = { padding: 8, cursor: "pointer", whiteSpace: "nowrap" };
const warmCool = (warm: boolean, a: number): [string, string] =>
  warm ? [`rgba(245,190,90,${a})`, "rgba(245,190,90,0.04)"] : [`rgba(95,170,235,${a})`, "rgba(95,170,235,0.04)"];
const tip = (a: string, b: string, val: number, extra: string) =>
  `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
  + `<b>${a} → ${b}</b><br/>${extra} ${money(val)}</div>`;

export default function MoneyFlowClient({ wealth, flows, pulse, bilateral, meta }: Props) {
  // Two-country selection: A only = country info; A+B = their bilateral trade.
  const [selA, setSelA] = useState<string | null>(null);
  const [selB, setSelB] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("wealth");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [pulseOn, setPulseOn] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [monthIdx, setMonthIdx] = useState(0);
  const monthsLen = pulse?.months.length ?? 0;

  useEffect(() => {
    if (!pulseOn || !playing || monthsLen === 0) return;
    const id = setInterval(() => setMonthIdx((i) => (i + 1) % monthsLen), 1100);
    return () => clearInterval(id);
  }, [pulseOn, playing, monthsLen]);

  const rowByName = useMemo(() => {
    const m: Record<string, WealthRow> = {};
    for (const w of wealth) m[w.name] = w;
    return m;
  }, [wealth]);

  // Click handler: 1st pick = A; 2nd (different) = B; clicking A again clears; a
  // 3rd pick starts over on the new country.
  const pick = (name: string) => {
    if (!selA) { setSelA(name); setSelB(null); return; }
    if (!selB) {
      if (name === selA) { setSelA(null); return; }
      setSelB(name); return;
    }
    setSelA(name); setSelB(null);
  };
  const clearSel = () => { setSelA(null); setSelB(null); };
  const highlight = [selA, selB].filter((x): x is string => !!x);

  const countries: Record<string, CountryLight> = useMemo(() => {
    const map: Record<string, CountryLight> = {};
    if (!wealth.length) return map;
    const logs = wealth.map((w) => Math.log10(w.gdpUSD));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    for (const w of wealth) {
      const entry: CountryLight = { light: (Math.log10(w.gdpUSD) - lo) / span, name: w.name, gdp: w.gdpUSD };
      if (w.iso2) map[w.iso2.toUpperCase()] = entry;
      if (w.iso3) map[w.iso3.toUpperCase()] = entry;
    }
    return map;
  }, [wealth]);

  const pulseRange = useMemo(() => {
    if (!pulse) return null;
    let lo = Infinity, hi = -Infinity;
    for (const c of pulse.corridors) for (const k of Object.keys(c.monthly)) {
      const v = Math.log10(c.monthly[k]); if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    return { lo, span: hi - lo || 1 };
  }, [pulse]);

  const curMonth = pulse && monthsLen ? pulse.months[Math.min(monthIdx, monthsLen - 1)] : null;

  const arcs: ArcDatum[] = useMemo(() => {
    // Two selected → just the A↔B corridor (annual bilateral), regardless of pulse.
    if (selA && selB) {
      const A = rowByName[selA], B = rowByName[selB];
      if (!A || !B) return [];
      const ab = bilateral[A.iso3 + ">" + B.iso3];
      const ba = bilateral[B.iso3 + ">" + A.iso3];
      const out: ArcDatum[] = [];
      const mk = (F: WealthRow, T: WealthRow, v: number, warm: boolean): ArcDatum => ({
        startLat: F.lat, startLng: F.lng, endLat: T.lat, endLng: T.lng,
        color: warmCool(warm, 0.95), speedMs: 1600, from: F.name, to: T.name, label: tip(F.name, T.name, v, "exports"),
      });
      if (typeof ab === "number") out.push(mk(A, B, ab, ab >= (ba || 0)));
      if (typeof ba === "number") out.push(mk(B, A, ba, ba > (ab || 0)));
      return out;
    }

    // Pulse (0 or 1 selected).
    if (pulseOn && pulse && pulseRange && curMonth) {
      let src = pulse.corridors.filter((c) => typeof c.monthly[curMonth] === "number");
      if (selA) src = src.filter((c) => c.from === selA || c.to === selA);
      return src.map((c) => {
        const val = c.monthly[curMonth];
        const t = (Math.log10(val) - pulseRange.lo) / pulseRange.span;
        const speedMs = 3400 - t * 2800;
        const a = 0.3 + t * 0.65;
        return {
          startLat: c.fromLat, startLng: c.fromLng, endLat: c.toLat, endLng: c.toLng,
          color: warmCool(c.dominant, a), speedMs, from: c.from, to: c.to,
          label: tip(c.from, c.to, val, monthLabel(curMonth) + ":"),
        };
      });
    }

    // Annual (0 or 1 selected).
    if (!flows.length) return [];
    const logs = flows.map((f) => Math.log10(f.valueUSD));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    const src = selA ? flows.filter((f) => f.from === selA || f.to === selA) : flows;
    return src.map((f) => {
      const t = (Math.log10(f.valueUSD) - lo) / span;
      const speedMs = 3600 - t * 2900;
      const a = selA ? 0.95 : 0.6;
      return {
        startLat: f.fromLat, startLng: f.fromLng, endLat: f.toLat, endLng: f.toLng,
        color: warmCool(f.dominant, a), speedMs, from: f.from, to: f.to, label: tip(f.from, f.to, f.valueUSD, "exports"),
      };
    });
  }, [flows, selA, selB, pulseOn, pulse, pulseRange, curMonth, bilateral, rowByName]);

  const rows = useMemo(() => {
    const nz = (v: number | null) => (v == null ? (sortDir === "asc" ? Infinity : -Infinity) : v);
    return [...wealth].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "wealth") cmp = a.gdpUSD - b.gdpUSD;
      else if (sortKey === "net") cmp = nz(a.netUSD) - nz(b.netUSD);
      else cmp = nz(a.tradeToGDP) - nz(b.tradeToGDP);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [wealth, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };
  const arrow = (k: SortKey) => (
    <span style={{ color: sortKey === k ? "#222" : "#c5c5c5", fontSize: 11, marginLeft: 3 }}>
      {sortKey === k ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
    </span>
  );

  if (wealth.length === 0) {
    return (
      <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#fff", borderRadius: 14 }}>
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>MoneyFlow</h1>
        <p style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
          Live data couldn&apos;t be loaded right now. Rather than show placeholder figures, nothing is displayed. Please refresh in a moment.
        </p>
        {meta.diag && <p style={{ color: "#aaa", fontSize: 11, fontFamily: "monospace" }}>{meta.diag}</p>}
      </main>
    );
  }

  const A = selA ? rowByName[selA] : null;
  const B = selB ? rowByName[selB] : null;
  const netWord = (v: number) => (v > 0 ? "net seller" : v < 0 ? "net buyer" : "balanced");

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#fff", borderRadius: 14 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>MoneyFlow</h1>
      <p style={{ color: "#666", marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
        Wealth as moving life-force. Countries glow by wealth, edged in gold; each arc is money flowing between them —
        <b style={{ color: "#b88227" }}> warm</b> = the earning direction, <b style={{ color: "#3f7fc4" }}>cool</b> = the
        spending side; bigger flows rush faster. Click one country for its profile, a second to see the trade between them.
      </p>

      <div style={{ fontSize: 11, color: "#888", marginBottom: 16, lineHeight: 1.5, borderLeft: "3px solid #ddd", paddingLeft: 10 }}>
        <b>Live</b> ({meta.asOf}): {meta.live.length ? meta.live.join(", ") : "—"}.<br />
        Trade is goods only (services excluded) among the largest economies — most of world trade, not all; countries
        outside that web show “—”. Wealth is GDP, the live measure of economic size.
        {meta.diag && <><br /><span style={{ fontFamily: "monospace", color: "#aaa" }}>{meta.diag}</span></>}
      </div>

      {pulse && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <button onClick={() => { setPulseOn((on) => !on); setMonthIdx(0); setPlaying(true); }} style={chip(pulseOn)}>
            {pulseOn ? "● Pulse (monthly)" : "○ Pulse (monthly)"}
          </button>
          {pulseOn && (
            <>
              <button onClick={() => setPlaying((p) => !p)} style={chip(false)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
              <input type="range" min={0} max={Math.max(0, monthsLen - 1)} value={Math.min(monthIdx, monthsLen - 1)}
                onChange={(e) => { setPlaying(false); setMonthIdx(parseInt(e.target.value, 10)); }}
                style={{ flex: "1 1 160px", maxWidth: 280 }} />
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 700, minWidth: 78 }}>
                {curMonth ? monthLabel(curMonth) : ""}
              </span>
            </>
          )}
        </div>
      )}

      {pulseOn && pulse && curMonth && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10,
          padding: "10px 14px", borderRadius: 10, background: "#06070d", color: "#f3e2bb" }}>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums" }}>
            {typeof pulse.totals[curMonth] === "number" ? money(pulse.totals[curMonth]) : "—"}
          </span>
          <span style={{ fontSize: 13, color: "#caa45a" }}>in goods crossed borders worldwide · {monthLabel(curMonth)}</span>
          {curMonth === pulse.months[monthsLen - 1] && (
            <span style={{ fontSize: 11, color: "#8a7a52", fontStyle: "italic" }}>latest month — may be partial as reports arrive</span>
          )}
        </div>
      )}

      <GlobeArcs arcs={arcs} countries={countries} highlight={highlight} onSelect={pick} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
        <p style={{ fontSize: 11, color: "#aaa", margin: 0 }}>
          Drag to rotate. Hover an arc for its value; click a country (the arcs pass the click through to the land beneath).
          Click a second country to compare the two.
        </p>
        {(selA || selB) && <button onClick={clearSel} style={chip(false)}>Clear selection</button>}
      </div>

      {/* Two countries selected → bilateral trade */}
      {A && B && (() => {
        const ab = bilateral[A.iso3 + ">" + B.iso3];
        const ba = bilateral[B.iso3 + ">" + A.iso3];
        const has = typeof ab === "number" || typeof ba === "number";
        const aSell = typeof ab === "number" ? ab : 0;
        const bSell = typeof ba === "number" ? ba : 0;
        const total = aSell + bSell;
        const net = aSell - bSell;
        return (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{A.name} ↔ {B.name}</div>
            {has ? (
              <>
                <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "8px 0", fontSize: 13 }}>
                  <span>{A.name} sells to {B.name}: <b>{money(aSell)}</b></span>
                  <span>{B.name} sells to {A.name}: <b>{money(bSell)}</b></span>
                  <span>Two-way total: <b>{money(total)}</b></span>
                  {total > 0 && (
                    <span>Balance: <b style={{ color: net >= 0 ? "#1a7a3a" : "#b03030" }}>
                      {net >= 0 ? A.name : B.name} runs the surplus ({money(Math.abs(net))})</b></span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "#999", margin: 0 }}>
                  Goods totals only — IMF DOTS doesn&apos;t break trade into product categories, so this is who sells how
                  much to whom, not what.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#555", margin: "8px 0 0" }}>
                No bilateral goods trade between {A.name} and {B.name} is recorded in the data — one or both may sit
                outside the major-economy trade web.
              </p>
            )}
            <button onClick={clearSel} style={{ ...chip(false), marginTop: 12 }}>Clear selection</button>
          </div>
        );
      })()}

      {/* One country selected → its profile */}
      {A && !B && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{A.name}</div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "8px 0", fontSize: 13 }}>
            <span>Wealth (GDP): <b>{money(A.gdpUSD)}</b></span>
            {A.expUSD != null && <span>Exports: <b>{money(A.expUSD)}</b></span>}
            {A.impUSD != null && <span>Imports: <b>{money(A.impUSD)}</b></span>}
            {A.netUSD != null && (
              <span>Net: <b style={{ color: A.netUSD >= 0 ? "#1a7a3a" : "#b03030" }}>
                {signedMoney(A.netUSD)} ({netWord(A.netUSD)})</b></span>
            )}
            {A.tradeToGDP != null && <span>Trade / GDP: <b>{pct(A.tradeToGDP)}</b></span>}
          </div>
          {(A.topOut.length > 0 || A.topIn.length > 0) ? (
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.6 }}>
              {A.topOut.length > 0 && <div>Sells most to: {A.topOut.map((p) => `${p.name} (${money(p.valueUSD)})`).join(", ")}</div>}
              {A.topIn.length > 0 && <div>Buys most from: {A.topIn.map((p) => `${p.name} (${money(p.valueUSD)})`).join(", ")}</div>}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#999", margin: 0 }}>Outside the major-economy trade web — no bilateral flows shown.</p>
          )}
          <p style={{ fontSize: 12, color: "#888", margin: "10px 0 0" }}>Click another country to see the trade between them.</p>
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", userSelect: "none" }}>
            <th style={th} onClick={() => toggleSort("name")}>Country{arrow("name")}</th>
            <th style={th} onClick={() => toggleSort("wealth")}>Wealth (GDP){arrow("wealth")}</th>
            <th style={th} onClick={() => toggleSort("net")}>Net seller / buyer{arrow("net")}</th>
            <th style={th} onClick={() => toggleSort("trade")}>Trade / GDP{arrow("trade")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, idx) => {
            const isSel = selA === w.name || selB === w.name;
            return (
              <tr key={w.iso3} onClick={() => pick(w.name)}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer", background: isSel ? "#fbf3df" : "transparent" }}>
                <td style={{ padding: 8, fontWeight: 600 }}>
                  <span style={{ color: "#bbb", marginRight: 6 }}>{idx + 1}</span>{w.name}
                </td>
                <td style={{ padding: 8 }}>{money(w.gdpUSD)}</td>
                <td style={{ padding: 8, color: w.netUSD == null ? "#bbb" : w.netUSD >= 0 ? "#1a7a3a" : "#b03030" }}>
                  {w.netUSD == null ? "—" : signedMoney(w.netUSD)}
                </td>
                <td style={{ padding: 8, color: w.tradeToGDP == null ? "#bbb" : "#333" }}>
                  {w.tradeToGDP == null ? "—" : pct(w.tradeToGDP)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
        {wealth.length} countries. Sort by Country, Wealth, Net seller/buyer, or Trade / GDP. Click a country (here or on
        the globe) to select it; click a second to compare; “Clear selection” resets.
      </p>
    </main>
  );
}
