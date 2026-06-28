"use client";

import dynamic from "next/dynamic";
import { Component, ReactNode, useEffect, useMemo, useRef, useState } from "react";

// react-globe.gl touches `window`, so it must load client-only (no SSR).
const GlobeGl = dynamic(() => import("react-globe.gl"), { ssr: false });

// Arc shape for any tool that draws flows (MoneyFlow). Tools with no arcs
// (the score globe) simply omit `arcs`.
export type GlobeArc = {
  startLat: number; startLng: number; endLat: number; endLng: number;
  color: [string, string];
  speedMs: number;
  from: string; to: string; label: string;
};

export type GlobeBaseProps = {
  // appearance
  backgroundColor: string;
  marginBottom?: number;
  fallbackText?: string;
  // polygon layer — every country is a gold-bordered polygon; the cap colour is the
  // part each tool varies (velocity glow for the score tool, wealth light for MoneyFlow)
  capColor: (feat: object) => string;
  strokeColor?: (feat: object) => string;
  sideColor?: (feat: object) => string;
  label: (feat: object) => string;
  // a feature was clicked (directly, or via an arc passing the click through to the
  // land beneath it) — the wrapper decides whether it maps to a selectable country
  onSelectFeature?: (feat: object) => void;
  polygonsTransitionDuration?: number;
  // re-key the polygon array when per-country colours change, so react-globe.gl
  // re-runs the colour accessors (the score tool needs this on every lens toggle)
  colorKey?: string;
  // optional flowing arcs
  arcs?: GlobeArc[];
};

// Country borders: Natural Earth 110m (177 features), fetched client-side.
const POLY_URLS = [
  "https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson",
];

const GOLD = "rgba(255,200,72,0.85)";       // the "blinding edges"
const GOLD_SIDE = "rgba(255,200,72,0.09)";  // faint extruded side

// ── point-in-polygon (so a click on an arc resolves the country beneath it) ──
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

class Boundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24, color: "#888", fontSize: 13, textAlign: "center" }}>
          {this.props.text}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GlobeBase({
  backgroundColor,
  marginBottom = 16,
  fallbackText = "The 3D globe couldn't load in this browser. The list below still works.",
  capColor,
  strokeColor,
  sideColor,
  label,
  onSelectFeature,
  polygonsTransitionDuration = 0,
  colorKey = "",
  arcs,
}: GlobeBaseProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 700, height: 460 });
  const [polygons, setPolygons] = useState<object[]>([]);

  // Responsive sizing: follow the container's width (capped) and derive the height
  // from it. ResizeObserver catches container reflow a window-resize listener misses.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.min(el.clientWidth, 900);
      const h = Math.round(Math.min(Math.max(w * 0.72, 300), 520));
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
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

  // New array reference whenever the colours change, so the cap accessors re-run.
  const polyData = useMemo(() => polygons.slice(), [polygons, colorKey]);

  const featAt = (lat: number, lng: number): object | null => {
    for (const f of polyData) { if (featContains(f, lat, lng)) return f; }
    return null;
  };

  return (
    <div
      ref={wrapRef}
      style={{ background: backgroundColor, borderRadius: 12, overflow: "hidden", marginBottom, height: size.height, minHeight: 300 }}
    >
      <Boundary text={fallbackText}>
        <GlobeGl
          width={size.width}
          height={size.height}
          backgroundColor={backgroundColor}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          atmosphereColor="#caa45a"
          atmosphereAltitude={0.18}
          // ── shared country-polygon layer (gold borders + per-tool cap colour) ──
          polygonsData={polyData}
          polygonAltitude={() => 0.01}
          polygonCapColor={capColor}
          polygonSideColor={sideColor || (() => GOLD_SIDE)}
          polygonStrokeColor={strokeColor || (() => GOLD)}
          polygonLabel={label}
          onPolygonClick={(d: object) => { if (onSelectFeature) onSelectFeature(d); }}
          polygonsTransitionDuration={polygonsTransitionDuration}
          // ── optional flowing arcs (MoneyFlow); empty for the score globe ──
          arcsData={arcs ?? []}
          arcStartLat={(d: object) => (d as GlobeArc).startLat}
          arcStartLng={(d: object) => (d as GlobeArc).startLng}
          arcEndLat={(d: object) => (d as GlobeArc).endLat}
          arcEndLng={(d: object) => (d as GlobeArc).endLng}
          arcColor={(d: object) => (d as GlobeArc).color}
          arcLabel={(d: object) => (d as GlobeArc).label}
          arcStroke={0.32}
          arcAltitudeAutoScale={0.4}
          arcDashLength={0.4}
          arcDashGap={0.18}
          arcDashInitialGap={() => Math.random()}
          arcDashAnimateTime={(d: object) => (d as GlobeArc).speedMs}
          arcsTransitionDuration={500}
          onArcClick={(_arc: object, _ev: object, coords?: { lat: number; lng: number }) => {
            if (coords && typeof coords.lat === "number" && onSelectFeature) {
              const f = featAt(coords.lat, coords.lng);
              if (f) onSelectFeature(f);
            }
          }}
        />
      </Boundary>
    </div>
  );
}
