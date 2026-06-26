"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

export type ArcDatum = {
  startLat: number; startLng: number; endLat: number; endLng: number;
  color: [string, string];
  speedMs: number;
  from: string; to: string; label: string;
};

// Per-country light: brightness 0..1 (from wealth), plus name + gdp for label/click.
export type CountryLight = { light: number; name: string; gdp: number };

type Props = {
  arcs: ArcDatum[];
  countries: Record<string, CountryLight>; // keyed by UPPERCASE iso2 AND iso3
  selected: string | null;
  onSelect: (name: string) => void;
};

// Country borders (Natural Earth 110m). jsDelivr is CORS-friendly; raw GitHub is the fallback.
const POLY_URLS = [
  "https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson",
];

function money(v: number) {
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
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
          The 3D globe couldn&apos;t load in this browser. The wealth list below still works.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GlobeArcs({ arcs, countries, selected, onSelect }: Props) {
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

  // Load country borders once (try CDN, then raw GitHub).
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const url of POLY_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const gj = await res.json();
          if (alive && Array.isArray(gj?.features)) { setPolygons(gj.features); return; }
        } catch {
          /* try next */
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  // Resolve a polygon feature -> our country light entry (World Bank codes first).
  const entryFor = (feat: object): CountryLight | null => {
    const p = (feat as { properties?: Record<string, unknown> }).properties || {};
    const keys = [p.WB_A3, p.WB_A2, p.ISO_A3, p.ISO_A2, p.ADM0_A3];
    for (const k of keys) {
      if (typeof k === "string") {
        const e = countries[k.toUpperCase()];
        if (e) return e;
      }
    }
    return null;
  };

  // Warm yellowish-white, brightness by wealth: dim "unlit" -> near-blinding rich.
  const capColor = (feat: object): string => {
    const e = entryFor(feat);
    if (!e) return "rgba(64,70,92,0.16)"; // no data: faint, like an unlit window
    const t = Math.max(0, Math.min(1, e.light));
    const g = Math.round(243 + t * 12);   // 243..255
    const b = Math.round(210 + t * 40);   // 210..250 (warm amber -> whiter as it brightens)
    let a = 0.06 + t * 0.86;              // 0.06 dim .. 0.92 bright
    if (selected && e.name === selected) a = Math.min(1, a + 0.25);
    return `rgba(255,${g},${b},${a.toFixed(3)})`;
  };

  return (
    <div
      ref={wrapRef}
      style={{ background: "#06070d", borderRadius: 12, overflow: "hidden", marginBottom: 16, minHeight: 460 }}
    >
      <Boundary>
        <GlobeGl
          width={width}
          height={460}
          backgroundColor="#06070d"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          atmosphereColor="#caa45a"
          atmosphereAltitude={0.18}
          // ── country windows of light (wealth = brightness, no height) ──
          polygonsData={polygons}
          polygonAltitude={() => 0.012}
          polygonCapColor={capColor}
          polygonSideColor={() => "rgba(255,236,198,0.05)"}
          polygonStrokeColor={() => "rgba(255,238,205,0.22)"}
          polygonLabel={(d: object) => {
            const e = entryFor(d);
            if (!e) return "";
            return `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px">`
              + `<b>${e.name}</b><br/>wealth ${money(e.gdp)}</div>`;
          }}
          onPolygonClick={(d: object) => { const e = entryFor(d); if (e) onSelect(e.name); }}
          polygonsTransitionDuration={200}
          // ── flowing arcs ──
          arcsData={arcs}
          arcStartLat={(d: object) => (d as ArcDatum).startLat}
          arcStartLng={(d: object) => (d as ArcDatum).startLng}
          arcEndLat={(d: object) => (d as ArcDatum).endLat}
          arcEndLng={(d: object) => (d as ArcDatum).endLng}
          arcColor={(d: object) => (d as ArcDatum).color}
          arcLabel={(d: object) => (d as ArcDatum).label}
          arcStroke={0.32}
          arcAltitudeAutoScale={0.4}
          arcDashLength={0.4}
          arcDashGap={0.18}
          arcDashInitialGap={() => Math.random()}
          arcDashAnimateTime={(d: object) => (d as ArcDatum).speedMs}
          arcsTransitionDuration={500}
        />
      </Boundary>
    </div>
  );
}
