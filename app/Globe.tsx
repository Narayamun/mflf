"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

export type GlobePoint = {
  name: string;
  lat: number;
  lng: number;
  altitude: number; // scaled Position (bar height)
  color: string;    // from Velocity
  label: string;    // HTML tooltip
};

type Props = { points: GlobePoint[]; onSelect: (name: string) => void };

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
      style={{ background: "#0b1020", borderRadius: 12, overflow: "hidden", marginBottom: 24, minHeight: 460 }}
    >
      <Boundary>
        <GlobeGl
          width={width}
          height={460}
          backgroundColor="#0b1020"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#5577aa"
          pointsData={points}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointAltitude={(d: object) => (d as GlobePoint).altitude}
          pointColor={(d: object) => (d as GlobePoint).color}
          pointRadius={0.6}
          pointLabel={(d: object) => (d as GlobePoint).label}
          pointsTransitionDuration={600}
          onPointClick={(d: object) => onSelect((d as GlobePoint).name)}
        />
      </Boundary>
    </div>
  );
}
