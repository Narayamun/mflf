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
  dominant: boolean;
  monthly: Record<string, number>; // "YYYY-MM" -> USD
};
export type Pulse = { months: string[]; corridors: PulseCorridor[]; totals: Record<string, number> };
export type MFMeta = { asOf: string; live: string[]; diag?: string };
export type Props = { wealth: WealthRow[]; flows: Flow[]; pulse: Pulse | null; meta: MFMeta };

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

// Warm = earning (heavier) direction; cool = spending side.
const arcColor = (warm: boolean, a: number): [string, string] =>
  warm ? [`rgba(245,190,90,${a})`, "rgba(245,190,90,0.04)"] : [`rgba(95,170,235,${a})`, "rgba(95,170,235,0.04)"];

export default function MoneyFlowClient({ wealth, flows, pulse, meta }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("wealth");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pulse (monthly animation) state.
  const [pulseOn, setPulseOn] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [monthIdx, setMonthIdx] = useState(0);
  const monthsLen = pulse?.months.length ?? 0;

  useEffect(() => {
    if (!pulseOn || !playing || monthsLen === 0) return;
    const id = setInterval(() => setMonthIdx((i) => (i + 1) % monthsLen), 1100);
    return () => clearInterval(id);
  }, [pulseOn, playing, monthsLen]);

  // Stable value range for the pulse, across the whole window (so sizing doesn't jump).
  const pulseRange = useMemo(() => {
    if (!pulse) return null;
    let lo = Infinity, hi = -Infinity;
    for (const c of pulse.corridors) for (const k of Object.keys(c.monthly)) {
      const v = Math.log10(c.monthly[k]);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    return { lo, span: hi - lo || 1 };
  }, [pulse]);

  // Country light map: brightness 0..1 from log-GDP, keyed by UPPERCASE iso2 AND iso3
  // so the globe can match either code on the border shapes. No height — wealth = light.
  const countries: Record<string, CountryLight> = useMemo(() => {
    const map: Record<string, CountryLight> = {};
    if (!wealth.length) return map;
    const logs = wealth.map((w) => Math.log10(w.gdpUSD));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    for (const w of wealth) {
      const entry: CountryLight = {
        light: (Math.log10(w.gdpUSD) - lo) / span,
        name: w.name,
        gdp: w.gdpUSD,
      };
      if (w.iso2) map[w.iso2.toUpperCase()] = entry;
      if (w.iso3) map[w.iso3.toUpperCase()] = entry;
    }
    return map;
  }, [wealth]);

  const curMonth = pulse && monthsLen ? pulse.months[Math.min(monthIdx, monthsLen - 1)] : null;

  // Arcs: annual (static) OR one month of the pulse.
  const arcs: ArcDatum[] = useMemo(() => {
    const tip = (a: string, b: string, val: number, extra: string) =>
      `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
      + `<b>${a} → ${b}</b><br/>${extra} ${money(val)}</div>`;

    if (pulseOn && pulse && pulseRange && curMonth) {
      let src = pulse.corridors.filter((c) => typeof c.monthly[curMonth] === "number");
      if (selected) src = src.filter((c) => c.from === selected || c.to === selected);
      return src.map((c) => {
        const val = c.monthly[curMonth];
        const t = (Math.log10(val) - pulseRange.lo) / pulseRange.span; // 0..1
        const speedMs = 3400 - t * 2800;
        const a = 0.3 + t * 0.65; // swell: heavier months glow stronger
        return {
          startLat: c.fromLat, startLng: c.fromLng, endLat: c.toLat, endLng: c.toLng,
          color: arcColor(c.dominant, a), speedMs, from: c.from, to: c.to,
          label: tip(c.from, c.to, val, monthLabel(curMonth) + ":"),
        };
      });
    }

    if (!flows.length) return [];
    const logs = flows.map((f) => Math.log10(f.valueUSD));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    const src = selected ? flows.filter((f) => f.from === selected || f.to === selected) : flows;
    return src.map((f) => {
      const t = (Math.log10(f.valueUSD) - lo) / span;
      const speedMs = 3600 - t * 2900;
      const a = selected ? 0.95 : 0.6;
      return {
        startLat: f.fromLat, startLng: f.fromLng, endLat: f.toLat, endLng: f.toLng,
        color: arcColor(f.dominant, a), speedMs, from: f.from, to: f.to,
        label: tip(f.from, f.to, f.valueUSD, "exports"),
      };
    });
  }, [flows, selected, pulseOn, pulse, pulseRange, curMonth]);

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

  const sel = selected ? wealth.find((w) => w.name === selected) : null;
  const netWord = (v: number) => (v > 0 ? "net seller" : v < 0 ? "net buyer" : "balanced");

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#fff", borderRadius: 14 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>MoneyFlow</h1>
      <p style={{ color: "#666", marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
        Wealth as moving life-force. Each arc is money flowing between countries — the value of goods one economy
        sells another. <b style={{ color: "#b88227" }}>Warm</b> arcs are the earning direction of a corridor,
        {" "}<b style={{ color: "#3f7fc4" }}>cool</b> arcs the spending side; the bigger the flow, the faster it rushes.
        Each glowing point is a nation, sized by its wealth.
      </p>

      <div style={{ fontSize: 11, color: "#888", marginBottom: 16, lineHeight: 1.5, borderLeft: "3px solid #ddd", paddingLeft: 10 }}>
        <b>Live</b> ({meta.asOf}): {meta.live.length ? meta.live.join(", ") : "—"}.<br />
        Trade is goods only (services excluded) among the largest economies — most of world trade, not all; countries
        outside that web show “—”. Wealth is GDP, the live measure of economic size; a true total-wealth stock isn&apos;t
        published live for every country, so it is not shown.
        {meta.diag && <><br /><span style={{ fontFamily: "monospace", color: "#aaa" }}>{meta.diag}</span></>}
      </div>

      {/* ── Pulse controls ── */}
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

      {/* ── World-total headline (moves with the pulse) ── */}
      {pulseOn && pulse && curMonth && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10,
          padding: "10px 14px", borderRadius: 10, background: "#06070d", color: "#f3e2bb" }}>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums" }}>
            {typeof pulse.totals[curMonth] === "number" ? money(pulse.totals[curMonth]) : "—"}
          </span>
          <span style={{ fontSize: 13, color: "#caa45a" }}>
            in goods crossed borders worldwide · {monthLabel(curMonth)}
          </span>
          {curMonth === pulse.months[monthsLen - 1] && (
            <span style={{ fontSize: 11, color: "#8a7a52", fontStyle: "italic" }}>latest month — may be partial as reports arrive</span>
          )}
        </div>
      )}

      <GlobeArcs arcs={arcs} countries={countries} selected={selected} onSelect={(name) => setSelected(name === selected ? null : name)} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
        <p style={{ fontSize: 11, color: "#aaa", margin: 0 }}>
          Drag to rotate. Click a country to see only its flows; click again to release.
          {pulseOn && " Pulse shows the heaviest corridors, month by month."}
          {flows.length === 0 && " (Trade flows couldn't be loaded — see the diagnostic above.)"}
        </p>
        {selected && <button onClick={() => setSelected(null)} style={chip(false)}>Clear {selected}</button>}
      </div>

      {sel && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{sel.name}</div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "8px 0", fontSize: 13 }}>
            <span>Wealth (GDP): <b>{money(sel.gdpUSD)}</b></span>
            {sel.expUSD != null && <span>Exports: <b>{money(sel.expUSD)}</b></span>}
            {sel.impUSD != null && <span>Imports: <b>{money(sel.impUSD)}</b></span>}
            {sel.netUSD != null && (
              <span>Net: <b style={{ color: sel.netUSD >= 0 ? "#1a7a3a" : "#b03030" }}>
                {signedMoney(sel.netUSD)} ({netWord(sel.netUSD)})</b></span>
            )}
            {sel.tradeToGDP != null && <span>Trade / GDP: <b>{pct(sel.tradeToGDP)}</b></span>}
          </div>
          {(sel.topOut.length > 0 || sel.topIn.length > 0) ? (
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.6 }}>
              {sel.topOut.length > 0 && <div>Sells most to: {sel.topOut.map((p) => `${p.name} (${money(p.valueUSD)})`).join(", ")}</div>}
              {sel.topIn.length > 0 && <div>Buys most from: {sel.topIn.map((p) => `${p.name} (${money(p.valueUSD)})`).join(", ")}</div>}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#999", margin: 0 }}>Outside the major-economy trade web — no bilateral flows shown.</p>
          )}
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
            const isSel = selected === w.name;
            return (
              <tr key={w.iso3}
                onClick={() => setSelected(isSel ? null : w.name)}
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
        {wealth.length} countries. Sort by Country (A–Z / Z–A), Wealth, Net seller/buyer (surplus → deficit), or
        Trade / GDP. Net is goods exports − imports: <span style={{ color: "#1a7a3a" }}>+ sells more</span>,
        {" "}<span style={{ color: "#b03030" }}>− buys more</span>. Click a country to light its flows.
      </p>
    </main>
  );
}
