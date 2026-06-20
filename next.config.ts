import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // turbopack disabled — root path was invalid and caused build panics
  allowedDevOrigins: ["21.0.2.210", ".space-z.ai", "localhost"],
};

export default nextConfig;
