"use client";

import { useMemo } from "react";
import GlobeBase from "./GlobeBase";

export type GlobePoint = {
  name: string;
  iso3: string;
  lat: number;
  lng: number;
  lff: number;    // Position (fraction of a working life) -> glow strength
  color: string;  // R/Y/G from Velocity -> glow colour
  label: string;  // HTML tooltip (name + position + velocity)
};

type Props = { points: GlobePoint[]; onSelect: (name: string) => void };

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export default function Globe({ points, onSelect }: Props) {
  const byIso = useMemo(() => {
    const m: Record<string, GlobePoint> = {};
    for (const p of points) if (p.iso3) m[p.iso3.toUpperCase()] = p;
    return m;
  }, [points]);

  const resolve = (feat: object): GlobePoint | null => {
    const p = (feat as { properties?: Record<string, unknown> }).properties || {};
    for (const k of [p.WB_A3, p.ISO_A3, p.ADM0_A3]) {
      if (typeof k === "string") { const pt = byIso[k.toUpperCase()]; if (pt) return pt; }
    }
    return null;
  };
  const nameOf = (feat: object): string => {
    const p = (feat as { properties?: Record<string, unknown> }).properties || {};
    for (const k of [p.ADMIN, p.NAME, p.NAME_LONG, p.SOVEREIGNT]) if (typeof k === "string") return k;
    return "—";
  };

  // Glow: colour = velocity (R/Y/G); strength = how mortgaged the generation is (Position).
  const capColor = (feat: object): string => {
    const pt = resolve(feat);
    if (!pt) return "rgba(40,46,66,0.05)"; // country with no score data — faint, just borders
    const t = Math.max(0, Math.min(1, pt.lff / 1.5));
    return hexToRgba(pt.color, 0.3 + Math.pow(t, 0.85) * 0.6); // 0.30 .. 0.90 — clearly visible
  };
  const label = (feat: object): string => {
    const pt = resolve(feat);
    return pt
      ? pt.label
      : `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px"><b>${nameOf(feat)}</b><br/><span style="color:#aaa">no score data</span></div>`;
  };

  // Re-key when the per-country colours change (lens toggles) so the caps re-render.
  const colorKey = points.map((p) => p.iso3 + p.color + p.lff.toFixed(2)).join("|");

  return (
    <GlobeBase
      backgroundColor="#0e1220"
      marginBottom={24}
      fallbackText="The 3D globe couldn't load in this browser. The table below still works."
      capColor={capColor}
      label={label}
      onSelectFeature={(feat) => { const pt = resolve(feat); if (pt) onSelect(pt.name); }}
      colorKey={colorKey}
      polygonsTransitionDuration={0}
    />
  );
}
