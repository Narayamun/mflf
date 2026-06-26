"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

export type ArcDatum = {
  startLat: number; startLng: number; endLat: number; endLng: number;
  color: [string, string];
  speedMs: number;
  from: string; to: string; label: string;
};

export type CountryLight = { light: number; name: string; gdp: number };

type Props = {
  arcs: ArcDatum[];
  countries: Record<string, CountryLight>; // keyed by UPPERCASE iso2 AND iso3
  highlight: string[];                     // names to brighten (selected A / B)
  onSelect: (name: string) => void;
};

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

// ── point-in-polygon (so a click on an arc can resolve the country beneath it) ──
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function featContains(feat: any, lat: number, lng: number): boolean {
  const g = feat?.geometry;
  if (!g) return false;
  if (g.type === "Polygon") return pointInRing(lng, lat, g.coordinates[0]);
  if (g.type === "MultiPolygon") return g.coordinates.some((poly: number[][][]) => pointInRing(lng, lat, poly[0]));
  return false;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
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

export default function GlobeArcs({ arcs, countries, highlight, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [polygons, setPolygons] = useState<object[]>([]);

  useEffect(() => {
    const update = () => { if (wrapRef.current) setWidth(Math.min(wrapRef.current.clientWidth, 900)); };
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

  const entryFor = (feat: object): CountryLight | null => {
    const p = (feat as { properties?: Record<string, unknown> }).properties || {};
    const keys = [p.WB_A3, p.WB_A2, p.ISO_A3, p.ISO_A2, p.ADM0_A3];
    for (const k of keys) {
      if (typeof k === "string") { const e = countries[k.toUpperCase()]; if (e) return e; }
    }
    return null;
  };

  const countryAt = (lat: number, lng: number): CountryLight | null => {
    for (const f of polygons) { if (featContains(f, lat, lng)) return entryFor(f); }
    return null;
  };

  // Transparent "electrical" interior glow. Steep curve so wealth is unmistakable:
  // poor countries stay dim, the richest blaze near-white.
  const capColor = (feat: object): string => {
    const e = entryFor(feat);
    if (!e) return "rgba(36,42,64,0.05)"; // unlit / no data
    const t = Math.max(0, Math.min(1, e.light));
    const g = Math.round(236 + t * 19);   // 236..255
    const b = Math.round(190 + t * 65);   // 190..255 (warm -> electric white)
    let a = 0.04 + Math.pow(t, 1.35) * 0.62; // 0.04 dim .. 0.66 bright (wealth made obvious)
    if (highlight.includes(e.name)) a = Math.min(0.85, a + 0.22);
    return `rgba(255,${g},${b},${a.toFixed(3)})`;
  };

  // Borders: bright gold lines marking every country (the "blinding edges").
  const strokeColor = (feat: object): string => {
    const e = entryFor(feat);
    if (e && highlight.includes(e.name)) return "rgba(255,232,150,1)";
    return "rgba(255,200,72,0.85)";
  };

  return (
    <div ref={wrapRef} style={{ background: "#06070d", borderRadius: 12, overflow: "hidden", marginBottom: 16, minHeight: 460 }}>
      <Boundary>
        <GlobeGl
          width={width}
          height={460}
          backgroundColor="#06070d"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          atmosphereColor="#caa45a"
          atmosphereAltitude={0.18}
          // ── country windows of light + gold borders (wealth = interior brightness) ──
          polygonsData={polygons}
          polygonAltitude={() => 0.01}
          polygonCapColor={capColor}
          polygonSideColor={() => "rgba(255,200,72,0.10)"}
          polygonStrokeColor={strokeColor}
          polygonLabel={(d: object) => {
            const e = entryFor(d);
            return e ? `<div style="font:13px system-ui;padding:5px 9px;background:#111;color:#fff;border-radius:5px"><b>${e.name}</b><br/>wealth ${money(e.gdp)}</div>` : "";
          }}
          onPolygonClick={(d: object) => { const e = entryFor(d); if (e) onSelect(e.name); }}
          polygonsTransitionDuration={200}
          // ── flowing arcs: hover shows info; CLICK falls through to the country beneath ──
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
          onArcClick={(_arc: object, _ev: object, coords?: { lat: number; lng: number }) => {
            if (coords && typeof coords.lat === "number") {
              const e = countryAt(coords.lat, coords.lng);
              if (e) onSelect(e.name);
            }
          }}
        />
      </Boundary>
    </div>
  );
}
