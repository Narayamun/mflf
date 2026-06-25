"use client";

import { useMemo, useState } from "react";
import GlobeArcs, { ArcDatum, NodeDatum } from "../GlobeArcs";

// ─── Types (shared with the server component in page.tsx) ─────────────────────
export type WealthRow = {
  name: string;
  iso2: string;
  iso3: string;
  lat: number;
  lng: number;
  gdpUSD: number;
};
export type Flow = {
  from: string;
  to: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  valueUSD: number;
};
export type MFMeta = { asOf: string; live: string[]; diag?: string };
export type Props = { wealth: WealthRow[]; flows: Flow[]; meta: MFMeta };

type SortKey = "wealth" | "name";

// ─── Formatting ───────────────────────────────────────────────────────────────
function money(v: number) {
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}

const card: React.CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 10, padding: 16, background: "#fafafa" };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6,
  border: "1px solid " + (active ? "#222" : "#ccc"),
  background: active ? "#222" : "#fff", color: active ? "#fff" : "#333",
});

export default function MoneyFlowClient({ wealth, flows, meta }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("wealth");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Globe nodes: every wealth country, sized by log-GDP so giants don't erase the rest.
  const nodes: NodeDatum[] = useMemo(() => {
    if (!wealth.length) return [];
    const logs = wealth.map((w) => Math.log10(w.gdpUSD));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    return wealth.map((w) => {
      const size = (Math.log10(w.gdpUSD) - lo) / span; // 0..1
      const isSel = selected === w.name;
      return {
        name: w.name, lat: w.lat, lng: w.lng, size,
        color: isSel ? "#fff3d6" : "#caa45a",
        label: `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
          + `<b>${w.name}</b><br/>wealth ${money(w.gdpUSD)}</div>`,
      };
    });
  }, [wealth, selected]);

  // Arcs: at rest, the heaviest global flows. With a country selected, only its flows.
  const arcs: ArcDatum[] = useMemo(() => {
    const src = selected ? flows.filter((f) => f.from === selected || f.to === selected) : flows;
    return src.map((f) => {
      const bright = selected ? 0.9 : 0.55;
      return {
        startLat: f.fromLat, startLng: f.fromLng, endLat: f.toLat, endLng: f.toLng,
        color: [`rgba(245,205,110,${bright})`, "rgba(245,205,110,0.04)"] as [string, string],
        from: f.from, to: f.to,
        label: `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
          + `<b>${f.from} → ${f.to}</b><br/>exports ${money(f.valueUSD)}</div>`,
      };
    });
  }, [flows, selected]);

  // Sorted wealth list.
  const rows = useMemo(() => {
    const copy = [...wealth];
    copy.sort((a, b) => {
      const cmp = sortKey === "name" ? a.name.localeCompare(b.name) : a.gdpUSD - b.gdpUSD;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
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

  const selRow = selected ? wealth.find((w) => w.name === selected) : null;

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#fff", borderRadius: 14 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>MoneyFlow</h1>
      <p style={{ color: "#666", marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
        Wealth as moving life-force. Each arc is money flowing between countries — the value of goods one economy
        sells another. The brighter the web, the more of the world&apos;s wealth pulses through that country.
        Each glowing point is a nation, sized by its wealth.
      </p>

      <div style={{ fontSize: 11, color: "#888", marginBottom: 16, lineHeight: 1.5, borderLeft: "3px solid #ddd", paddingLeft: 10 }}>
        <b>Live</b> ({meta.asOf}): {meta.live.length ? meta.live.join(", ") : "—"}.<br />
        Arcs are bilateral goods exports among the largest economies (the clearest live signal of money moving between
        countries). Wealth is GDP — the live, comparable measure of economic size and power; a true total-wealth stock
        isn&apos;t published live for every country, so it is not shown.
        {meta.diag && <><br /><span style={{ fontFamily: "monospace", color: "#aaa" }}>{meta.diag}</span></>}
      </div>

      {/* ── Globe ── */}
      <GlobeArcs arcs={arcs} nodes={nodes} onSelect={(name) => setSelected(name === selected ? null : name)} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
        <p style={{ fontSize: 11, color: "#aaa", margin: 0 }}>
          Drag to rotate. Click a country to see only its flows; click it again to release.
          {flows.length === 0 && " (Trade flows couldn't be loaded — see the diagnostic above.)"}
        </p>
        {selected && (
          <button onClick={() => setSelected(null)} style={chip(false)}>Clear {selected}</button>
        )}
      </div>

      {selRow && (
        <div style={{ ...card, marginBottom: 20, background: "#fff" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{selRow.name}</div>
          <p style={{ margin: "4px 0 0", color: "#333", fontSize: 14 }}>
            Wealth (GDP): <b>{money(selRow.gdpUSD)}</b>. The globe now shows only the trade flowing into and out of
            {" "}{selRow.name}. Its brightest arcs are its largest trading partners.
          </p>
        </div>
      )}

      {/* ── Wealth list ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", userSelect: "none" }}>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("name")}>Country{arrow("name")}</th>
            <th style={{ padding: 8, cursor: "pointer" }} onClick={() => toggleSort("wealth")}>Wealth (GDP){arrow("wealth")}</th>
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
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
        {wealth.length} countries. Click a header to sort — Country (A–Z / Z–A), Wealth (high→low / low→high).
        Click a country to light up its flows on the globe.
      </p>
    </main>
  );
}
