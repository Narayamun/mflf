"use client";

// Pure-SVG yearly trade chart (no chart dependency, keeps the copy-paste build lean).
// Two uses:
//   • one signed series (a country's net balance) -> zeroBands: green above 0 (net
//     seller), red below (net buyer), dots coloured by sign.
//   • two positive series (A→B and B→A exports) -> two coloured lines + legend.
import { T } from "./theme";

export type HistPoint = { year: number; value: number }; // value in USD
export type HistSeries = { label: string; color: string; points: HistPoint[] };

function money(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return sign + "$" + (a / 1e12).toFixed(a >= 1e13 ? 0 : 1) + "T";
  if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(0) + "M";
  if (a === 0) return "$0";
  return sign + "$" + Math.round(a).toLocaleString("en-US");
}

export default function TradeHistory({
  series,
  zeroBands = false,
  height = 200,
}: {
  series: HistSeries[];
  zeroBands?: boolean;
  height?: number;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return (
      <p style={{ fontSize: 12, color: T.muted, fontStyle: "italic", margin: "8px 0" }}>
        Not enough yearly data to chart this one.
      </p>
    );
  }

  const W = 640, H = height;
  const padL = 66, padR = 14, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const years = all.map((p) => p.year);
  const vals = all.map((p) => p.value);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padv = (hi - lo) * 0.08;
  lo -= padv; hi += padv;

  const x = (yr: number) =>
    padL + (maxYear === minYear ? innerW / 2 : ((yr - minYear) / (maxYear - minYear)) * innerW);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;
  const zeroY = y(0);

  const pathOf = (s: HistSeries) =>
    s.points.slice().sort((a, b) => a.year - b.year)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.year).toFixed(1)} ${y(p.value).toFixed(1)}`)
      .join(" ");

  const ticks = Array.from(new Set([hi - padv, 0, lo + padv])).sort((a, b) => b - a);

  return (
    <div style={{ marginTop: 4 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }} role="img"
        aria-label="Trade value over time">
        {/* net seller / buyer tint */}
        {zeroBands && (
          <g>
            <rect x={padL} y={padT} width={innerW} height={Math.max(0, zeroY - padT)} fill={T.bandUp} />
            <rect x={padL} y={zeroY} width={innerW} height={Math.max(0, padT + innerH - zeroY)} fill={T.bandDown} />
          </g>
        )}

        {/* y ticks + gridlines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? T.zeroLine : T.grid} strokeWidth={t === 0 ? 1.2 : 1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={T.muted}>{money(t)}</text>
          </g>
        ))}

        {/* x labels */}
        <text x={x(minYear)} y={padT + innerH + 17} textAnchor="start" fontSize={10} fill={T.muted}>{minYear}</text>
        <text x={x(maxYear)} y={padT + innerH + 17} textAnchor="end" fontSize={10} fill={T.muted}>{maxYear}</text>

        {/* series lines */}
        {series.map((s, si) => (
          <path key={si} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* sign-coloured dots for the single net series */}
        {/* data dots + easy-to-hover hit areas showing year and value */}
        {series.map((s, si) => (
          <g key={"dots" + si}>
            {s.points.map((p) => (
              <g key={p.year}>
                <circle cx={x(p.year)} cy={y(p.value)} r={2.4} fill={zeroBands ? (p.value >= 0 ? T.up : T.down) : s.color} />
                <circle cx={x(p.year)} cy={y(p.value)} r={9} fill="transparent" style={{ cursor: "pointer" }}>
                  <title>{(series.length > 1 ? s.label + " — " : "") + p.year + ": " + money(p.value)}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
      </svg>

      <div style={{ display: "flex", gap: 16, fontSize: 11, color: T.muted, marginTop: 2, flexWrap: "wrap" }}>
        {zeroBands ? (
          <>
            <span style={{ color: T.up }}>above 0 = net seller</span>
            <span style={{ color: T.down }}>below 0 = net buyer</span>
          </>
        ) : (
          series.map((s, si) => (
            <span key={si}>
              <span style={{ display: "inline-block", width: 18, borderTop: "2px solid " + s.color, verticalAlign: "middle", marginRight: 5 }} />
              {s.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
