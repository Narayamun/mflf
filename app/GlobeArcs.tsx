"use client";

import GlobeBase, { GlobeArc } from "./GlobeBase";

// Kept as named exports so MoneyFlowClient's imports don't change.
export type ArcDatum = GlobeArc;
export type CountryLight = { light: number; name: string; gdp: number };

type Props = {
  arcs: ArcDatum[];
  countries: Record<string, CountryLight>; // keyed by UPPERCASE iso2 AND iso3
  highlight: string[];                     // names to brighten (selected A / B)
  onSelect: (name: string) => void;
};

function money(v: number) {
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}

export default function GlobeArcs({ arcs, countries, highlight, onSelect }: Props) {
  const entryFor = (feat: object): CountryLight | null => {
    const p = (feat as { properties?: Record<string, unknown> }).properties || {};
    const keys = [p.WB_A3, p.WB_A2, p.ISO_A3, p.ISO_A2, p.ADM0_A3];
    for (const k of keys) {
      if (typeof k === "string") { const e = countries[k.toUpperCase()]; if (e) return e; }
    }
    return null;
  };

  // Transparent "electrical" interior glow; brightness = wealth. Selected = brighter.
  const capColor = (feat: object): string => {
    const e = entryFor(feat);
    if (!e) return "rgba(36,42,64,0.05)"; // unlit / no data
    const t = Math.max(0, Math.min(1, e.light));
    const g = Math.round(236 + t * 19);   // 236..255
    const b = Math.round(190 + t * 65);   // 190..255 (warm -> electric white)
    let a = 0.04 + Math.pow(t, 1.35) * 0.62; // 0.04 dim .. 0.66 bright
    if (highlight.includes(e.name)) a = Math.min(0.85, a + 0.22);
    return `rgba(255,${g},${b},${a.toFixed(3)})`;
  };
  const strokeColor = (feat: object): string => {
    const e = entryFor(feat);
    if (e && highlight.includes(e.name)) return "rgba(255,232,150,1)";
    return "rgba(255,200,72,0.85)";
  };
  const label = (feat: object): string => {
    const e = entryFor(feat);
    return e ? `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px"><b>${e.name}</b><br/>wealth ${money(e.gdp)}</div>` : "";
  };

  return (
    <GlobeBase
      backgroundColor="#06070d"
      marginBottom={16}
      fallbackText="The 3D globe couldn't load in this browser. The wealth list below still works."
      capColor={capColor}
      strokeColor={strokeColor}
      label={label}
      onSelectFeature={(feat) => { const e = entryFor(feat); if (e) onSelect(e.name); }}
      polygonsTransitionDuration={200}
      arcs={arcs}
    />
  );
}
