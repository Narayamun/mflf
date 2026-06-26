"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

export type GlobePoint = {
  name: string;
  lat: number;
  lng: number;
  altitude: number; // (no longer used for poles; kept for compatibility)
  color: string;    // R/Y/G from Velocity
  label: string;    // HTML tooltip
};

type Props = { points: GlobePoint[]; onSelect: (name: string) => void };

// Country borders (Natural Earth 110m) — same gold-edged look as the MoneyFlow globe.
const POLY_URLS = [
  "https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson",
];

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
          // ── gold country borders ──
          polygonsData={polygons}
          polygonAltitude={() => 0.008}
          polygonCapColor={() => "rgba(255,205,90,0.05)"}
          polygonSideColor={() => "rgba(255,200,72,0.08)"}
          polygonStrokeColor={() => "rgba(255,200,72,0.8)"}
          polygonsTransitionDuration={0}
          // ── status dots (colour = Velocity: green surfacing / amber / red sinking) ──
          pointsData={points}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointAltitude={() => 0.005}
          pointColor={(d: object) => (d as GlobePoint).color}
          pointRadius={0.42}
          pointLabel={(d: object) => (d as GlobePoint).label}
          pointsTransitionDuration={0}
          onPointClick={(d: object) => onSelect((d as GlobePoint).name)}
          // ── country names inside their borders; click a name for its detail ──
          labelsData={points}
          labelLat={(d: object) => (d as GlobePoint).lat}
          labelLng={(d: object) => (d as GlobePoint).lng}
          labelText={(d: object) => (d as GlobePoint).name}
          labelColor={() => "rgba(240,240,245,0.92)"}
          labelSize={0.95}
          labelResolution={2}
          labelAltitude={0.01}
          labelIncludeDot={false}
          labelLabel={(d: object) => (d as GlobePoint).label}
          onLabelClick={(d: object) => onSelect((d as GlobePoint).name)}
        />
      </Boundary>
    </div>
  );
}
