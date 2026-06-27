"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useMemo, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

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

// Country borders (Natural Earth 110m) — same gold-edged look as the MoneyFlow globe.
const POLY_URLS = [
  "https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson",
];

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24, color: "#888", fontSize: 13, textAlign: "center" }}>
          The 3D globe couldn&apos;t load in this browser. The table below still works.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Globe({ points, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [polygons, setPolygons] = useState<object[]>([]);

  useEffect(() => {
    const update = () => {
      if (wrapRef.current) setWidth(Math.min(wrapRef.current.clientWidth, 900));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const url of POLY_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const gj = await res.json();
          if (alive && Array.isArray(gj?.features)) { setPolygons(gj.features); return; }
        } catch { /* try next */ }
      }
    })();
    return () => { alive = false; };
  }, []);

  const byIso = useMemo(() => {
    const m: Record<string, GlobePoint> = {};
    for (const p of points) if (p.iso3) m[p.iso3.toUpperCase()] = p;
    return m;
  }, [points]);

  // Re-key the polygon data when the per-country colours change (lens toggles),
  // so react-globe.gl re-runs the colour accessors.
  const colorKey = points.map((p) => p.iso3 + p.color + p.lff.toFixed(2)).join("|");
  const polyData = useMemo(() => polygons.slice(), [polygons, colorKey]);

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
    return hexToRgba(pt.color, 0.1 + Math.pow(t, 1.2) * 0.55); // 0.10 .. 0.65
  };

  return (
    <div
      ref={wrapRef}
      style={{ background: "#06070d", borderRadius: 12, overflow: "hidden", marginBottom: 24, minHeight: 460 }}
    >
      <Boundary>
        <GlobeGl
          width={width}
          height={460}
          backgroundColor="#06070d"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          atmosphereColor="#caa45a"
          atmosphereAltitude={0.18}
          polygonsData={polyData}
          polygonAltitude={() => 0.01}
          polygonCapColor={capColor}
          polygonSideColor={() => "rgba(255,200,72,0.08)"}
          polygonStrokeColor={() => "rgba(255,200,72,0.8)"}
          polygonLabel={(feat: object) => {
            const pt = resolve(feat);
            return pt
              ? pt.label
              : `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px"><b>${nameOf(feat)}</b><br/><span style="color:#aaa">no score data</span></div>`;
          }}
          onPolygonClick={(feat: object) => { const pt = resolve(feat); if (pt) onSelect(pt.name); }}
          polygonsTransitionDuration={0}
        />
      </Boundary>
    </div>
  );
}
