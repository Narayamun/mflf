// MGZS validation view — Step 2a
// Figures below are APPROXIMATE, for validating the math only.
// Real per-country numbers arrive in Step 2b (live World Bank feed).

const WY = 47; // working years per lifetime

const countries = [
  { name: "Japan",    debtToGDP: 2.30, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.000 },
  { name: "USA",      debtToGDP: 1.22, taxToGDP: 0.27, primaryBalance: -0.030, realRate: 0.015 },
  { name: "Norway",   debtToGDP: 0.44, taxToGDP: 0.39, primaryBalance:  0.060, realRate: 0.010 },
  { name: "Bulgaria", debtToGDP: 0.24, taxToGDP: 0.30, primaryBalance: -0.020, realRate: 0.010 },
];

function computeMGZS(c: typeof countries[number]) {
  // GDP cancels out, so we work in units of GDP (GDP = 1).
  const D = c.debtToGDP;            // debt as multiple of GDP
  const R = c.taxToGDP;             // annual tax revenue as fraction of GDP

  // Framing A — Life-Force Fraction: D / (R * WY)
  const LFF = D / (R * WY);

  // Framing B — Realistic Time-to-Zero
  const annualPaydown = c.primaryBalance - c.realRate * D; // in units of GDP
  let yearsToZero: number | null;
  let generations: number | null;
  if (annualPaydown <= 0) {
    yearsToZero = null;      // escape velocity → infinite
    generations = null;
  } else {
    yearsToZero = D / annualPaydown;
    generations = yearsToZero / WY;
  }
  return { LFF, annualPaydown, yearsToZero, generations };
}

export default function Home() {
  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Marinov Generation Zero Score</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        Step 2a — math validation. Figures approximate; live data comes next.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Country</th>
            <th style={{ padding: 8 }}>Framing A (LFF)</th>
            <th style={{ padding: 8 }}>Framing B (years→0)</th>
            <th style={{ padding: 8 }}>Generations</th>
            <th style={{ padding: 8 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const r = computeMGZS(c);
            const escape = r.yearsToZero === null;
            return (
              <tr key={c.name} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: 8 }}>{(r.LFF * 100).toFixed(1)}%</td>
                <td style={{ padding: 8 }}>{escape ? "∞" : r.yearsToZero!.toFixed(1)}</td>
                <td style={{ padding: 8 }}>{escape ? "—" : r.generations!.toFixed(2)}</td>
                <td style={{ padding: 8, color: escape ? "#b00" : "#070" }}>
                  {escape ? "escape velocity" : "reachable"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
