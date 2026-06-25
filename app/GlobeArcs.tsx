"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

export type ArcDatum = {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: [string, string]; // gradient: [from, to]
  from: string;
  to: string;
  label: string;
};

export type NodeDatum = {
  name: string;
  lat: number;
  lng: number;
  size: number;   // 0..1, scaled from GDP
  color: string;
  label: string;
};

type Props = {
  arcs: ArcDatum[];
  nodes: NodeDatum[];
  onSelect: (name: string) => void;
};

// Keeps a WebGL/library failure contained — the rest of the page stays alive.
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

export default function GlobeArcs({ arcs, nodes, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);

  useEffect(() => {
    const update = () => {
      if (wrapRef.current) setWidth(Math.min(wrapRef.current.clientWidth, 900));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#caa45a"
          atmosphereAltitude={0.18}
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
          arcDashAnimateTime={2600}
          arcsTransitionDuration={500}
          // ── country nodes (sized by wealth) ──
          pointsData={nodes}
          pointLat={(d: object) => (d as NodeDatum).lat}
          pointLng={(d: object) => (d as NodeDatum).lng}
          pointAltitude={(d: object) => 0.01 + (d as NodeDatum).size * 0.12}
          pointRadius={(d: object) => 0.18 + (d as NodeDatum).size * 0.5}
          pointColor={(d: object) => (d as NodeDatum).color}
          pointLabel={(d: object) => (d as NodeDatum).label}
          pointsTransitionDuration={500}
          onPointClick={(d: object) => onSelect((d as NodeDatum).name)}
        />
      </Boundary>
    </div>
  );
}
