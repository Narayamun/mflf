import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MoneyFlow's server component fetches a lot from DBnomics + the World Bank at
  // build time, and DBnomics can be slow. The default per-page prerender budget is
  // 60s, which this occasionally exceeds — raise it so a slow source doesn't fail
  // the build. This only affects the build-time budget; no data or runtime behaviour
  // changes, and a fast build simply finishes early.
  staticPageGenerationTimeout: 300,
};

export default nextConfig;
