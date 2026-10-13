import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // cacheComponents DISABLED (2026-10-13): hangs page renders on Cloudflare
  // Workers (workerd kills the request). Re-evaluate after adapter/Next
  // compatibility is confirmed on staging.
  cacheComponents: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
