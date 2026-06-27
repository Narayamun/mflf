// ─── Shared theme ────────────────────────────────────────────────────────────
// One palette for both tools (MGZS at "/" and MoneyFlow at "/moneyflow"). Every
// page-level colour references a token here, so the whole look can be changed — or
// reverted to a light theme — by editing this one file. The two globe components
// (Globe.tsx, GlobeArcs.tsx) keep their own dark canvas colours, which already sit
// a hair lighter than `bg` so each globe reads as an inset panel on the page.
export const T = {
  // backgrounds
  bg: "#0b0e17",          // page background
  surface: "#141a27",     // cards / panels
  inset: "#06070d",       // darkest inset (MoneyFlow world-total strip)
  rowSel: "rgba(232,196,106,0.14)", // selected table row (soft gold tint)

  // borders / rules
  border: "#252c3d",      // standard card / control border
  borderStrong: "#33405a",// table header underline
  borderFaint: "#1e2636", // table row separator
  accentRule: "rgba(232,196,106,0.55)", // gold left-rule on the "Live" block

  // text
  text: "#e7e9f0",        // primary
  text2: "#aeb6c8",       // secondary
  muted: "#7f889c",       // muted / captions
  faint: "#5a6276",       // faint (rank numbers, inactive arrows, em-dashes)

  // accents
  gold: "#e8c46a",        // headings + key accents
  goldSoft: "#caa45a",    // softer gold (subtext)
  warm: "#e3aa4e",        // MoneyFlow "warm" earning direction
  cool: "#5fa6e6",        // MoneyFlow "cool" spending direction

  // semantics
  up: "#3ddc77",          // surfacing / net seller / surplus (green)
  down: "#ff6b6b",        // sinking / net buyer (red)

  // trajectory chart (pure-SVG)
  grid: "#222a3a",        // gridlines
  zeroLine: "#5a6276",    // the v = 0 baseline
  bandDown: "rgba(255,107,107,0.10)", // "sinking" region tint
  bandUp: "rgba(61,220,119,0.10)",    // "surfacing" region tint

  // amber "important" callout (score tool's clean-payoff caveat)
  warnBg: "rgba(232,196,106,0.08)",
  warnBorder: "rgba(232,196,106,0.32)",
  warnText: "#e8c46a",

  // chips (active = light fill on the dark page; inactive = surface)
  chipActiveBg: "#e7e9f0",
  chipActiveText: "#0b0e17",
  chipBg: "#141a27",
  chipText: "#c2cadb",
  chipBorder: "#313a4f",
};
