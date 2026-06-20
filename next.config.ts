import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {
    root: "/home/z/my-project",
  },
  allowedDevOrigins: ["21.0.2.210", ".space-z.ai", "localhost"],
};

export default nextConfig;
