"use client";

import { useState } from "react";

const WY = 47; // working years per lifetime

const countries = [
  { name: "Norway",   debtToGDP: 0.44, taxToGDP: 0.39, primaryBalance:  0.060, realRate: 0.010, inflation: 0.030, population: 5_500_000 },
  { name: "Bulgaria", debtToGDP: 0.24, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.010, inflation: 0.030, population: 6_400_000 },
  { name: "Japan",    debtToGDP: 2.30, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.000, inflation: 0.020, population: 124_000_000 },
  { name: "USA",      debtToGDP: 1.22, taxToGDP: 0.27, primaryBalance: -0.030, realRate: 0.015, inflation: 0.030, population: 335_000_000 },
];

type Country = typeof countries[number];

function compute(c: Country, useReal: boolean) {
  const i = useReal ? c.realRate : c.realRate + c.inflation;
  const denom = c.taxToGDP * WY; // one generation's lifetime tax output (in GDP-years)

  // POSITION — how mortgaged this generation already is (interest-independent)
  const LFF = c.debtToGDP / denom;          // fraction of one generation
  const livesOwed = LFF * c.population;      // citizen-lifetimes owed

  // VELOCITY — lives mortgaged (or freed) per year = the year-on-year change in position
  const interestFlow = (i * c.debtToGDP) / denom; // inherited tribute
  const govFlow = (-c.primaryBalance) / denom;    // current government's own addition
  const velocity = interestFlow + govFlow;

  return {
    LFF,
    livesOwed,
    livesPerYear: velocity * c.population,
    livesGovt: govFlow * c.population,
    livesInherited: interestFlow * c.population,
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

export default function Home() {
  const [useReal, setUseReal] = useState(false);

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Generation Zero Score</h1>
      <p style={{ color: "#666", marginBottom: 16, fontSize: 14 }}>
        Position = how mortgaged this generation is now. Velocity = lives mortgaged (red) or freed (green) per year.
        Negative means a country is buying its citizens back. Figures approximate — live data next.
      </p>

      <button
        onClick={() => setUseReal(!useReal)}
        style={{ marginBottom: 20, padding: "6px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#f7f7f7" }}
      >
        Interest: {useReal ? "real (inflation-adjusted)" : "nominal (cash paid)"} — click to toggle
      </button>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Country</th>
            <th style={{ padding: 8 }}>Mortgaged now (position)</th>
            <th style={{ padding: 8 }}>Lives / year (velocity)</th>
            <th style={{ padding: 8 }}>…govt adds</th>
            <th style={{ padding: 8 }}>…inherited</th>
            <th style={{ padding: 8 }}>Direction</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const r = compute(c, useReal);
            const freeing = r.livesPerYear < 0;
            return (
              <tr key={c.name} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: 8 }}>{(r.LFF * 100).toFixed(1)}% &nbsp;({fmt(r.livesOwed)} lives)</td>
                <td style={{ padding: 8, fontWeight: 600, color: freeing ? "#070" : "#b00" }}>{signed(r.livesPerYear)}</td>
                <td style={{ padding: 8 }}>{signed(r.livesGovt)}</td>
                <td style={{ padding: 8 }}>{signed(r.livesInherited)}</td>
                <td style={{ padding: 8, color: freeing ? "#070" : "#b00" }}>{freeing ? "▲ surfacing" : "▼ sinking"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
