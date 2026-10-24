import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bgutils-js", "jsdom"],
  // Turbopack externalizes these as hashed names under .next/node_modules.
  // The serverless trace otherwise omits the aliases, and /api/summarize
  // crashes on boot with an empty 500.
  outputFileTracingIncludes: {
    "/api/summarize": ["./.next/node_modules/**"],
  },
};

export default nextConfig;
