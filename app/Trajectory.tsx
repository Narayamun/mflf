"use client";

import { T } from "./theme";

// Pure-SVG line chart (no chart dependency, keeps the copy-paste build lean).
// One series: velocity as a percentage — share of a working life mortgaged (+,
// sinking) or freed (−, surfacing) per year. Plotted as a fraction on purpose:
// population is only fetched latest-only, so "lives/year over time" would smear
// today's population across past years. A percentage carries no such anachronism.
// Solid segment = historical IMF data; dashed segment = IMF forecast (capped).

export type TrajPoint = {
  year: number;
  velocityPct: number; // velocity × 100, signed
  projected: boolean;  // true = IMF forecast year (dashed)
};

const pctLabel = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%";

export default function Trajectory({ data }: { data: TrajPoint[] }) {
  if (data.length < 2) {
    return (
      <p style={{ fontSize: 12, color: T.muted, fontStyle: "italic", margin: "8px 0" }}>
        Not enough yearly data points to draw a trajectory for this country.
      </p>
    );
  }

  // ── geometry ──
  const W = 640, H = 220;
  const padL = 60, padR = 16, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const years = data.map((d) => d.year);
  const vals = data.map((d) => d.velocityPct);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; } // guard a flat line
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;

  const x = (yr: number) =>
    padL + (maxYear === minYear ? innerW / 2 : ((yr - minYear) / (maxYear - minYear)) * innerW);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  const zeroY = y(0);
  const firstProjIdx = data.findIndex((d) => d.projected);
  const curYear = new Date().getFullYear();

  // Solid (historical) path + dashed (projection) path. The dashed path starts at
  // the last historical point so the line reads as continuous.
  const histPts = data.filter((d) => !d.projected);
  const projStartIdx = firstProjIdx === -1 ? -1 : Math.max(0, firstProjIdx - 1);
  const projPts = projStartIdx === -1 ? [] : data.slice(projStartIdx);

  const toPath = (pts: TrajPoint[]) =>
    pts.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.year).toFixed(1)} ${y(d.velocityPct).toFixed(1)}`).join(" ");

  const ticks = Array.from(new Set([lo + pad, 0, hi - pad])).sort((a, b) => b - a);

  return (
    <div style={{ marginTop: 4 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }} role="img"
        aria-label="Velocity over time: share of a working life mortgaged or freed per year">
        {/* sinking / surfacing background tint */}
        <rect x={padL} y={padT} width={innerW} height={Math.max(0, zeroY - padT)} fill={T.bandDown} />
        <rect x={padL} y={zeroY} width={innerW} height={Math.max(0, padT + innerH - zeroY)} fill={T.bandUp} />

        {/* y ticks + gridlines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? T.zeroLine : T.grid} strokeWidth={t === 0 ? 1.2 : 1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={T.muted}>{pctLabel(t)}</text>
          </g>
        ))}

        {/* "now" marker */}
        {curYear >= minYear && curYear <= maxYear && (
          <g>
            <line x1={x(curYear)} x2={x(curYear)} y1={padT} y2={padT + innerH}
              stroke={T.faint} strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(curYear)} y={padT + innerH + 18} textAnchor="middle" fontSize={9} fill={T.muted}>now</text>
          </g>
        )}

        {/* x labels */}
        <text x={x(minYear)} y={padT + innerH + 18} textAnchor="start" fontSize={10} fill={T.muted}>{minYear}</text>
        <text x={x(maxYear)} y={padT + innerH + 18} textAnchor="end" fontSize={10} fill={T.muted}>{maxYear}</text>

        {/* historical (solid) */}
        {histPts.length >= 2 && (
          <path d={toPath(histPts)} fill="none" stroke={T.text} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* projection (dashed) */}
        {projPts.length >= 2 && (
          <path d={toPath(projPts)} fill="none" stroke={T.text} strokeWidth={2}
            strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" opacity={0.65} />
        )}

        {/* data dots */}
        {data.map((d) => (
          <circle key={d.year} cx={x(d.year)} cy={y(d.velocityPct)} r={d.projected ? 2 : 2.6}
            fill={d.velocityPct > 0 ? T.down : T.up} opacity={d.projected ? 0.6 : 1} />
        ))}
      </svg>

      <div style={{ display: "flex", gap: 16, fontSize: 11, color: T.muted, marginTop: 2, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 18, borderTop: "2px solid " + T.text, verticalAlign: "middle", marginRight: 5 }} />historical (IMF)</span>
        <span><span style={{ display: "inline-block", width: 18, borderTop: "2px dashed " + T.text, verticalAlign: "middle", marginRight: 5, opacity: 0.65 }} />IMF forecast</span>
        <span style={{ color: T.down }}>above 0 = sinking</span>
        <span style={{ color: T.up }}>below 0 = surfacing</span>
      </div>
    </div>
  );
}
