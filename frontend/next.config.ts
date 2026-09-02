import type { NextConfig } from "next";

const configuredBackendOrigin = process.env.FASTAPI_ORIGIN?.replace(/\/$/, "");
const backendOrigin = configuredBackendOrigin || (process.env.NODE_ENV === "production" ? undefined : "http://127.0.0.1:8000");

const nextConfig: NextConfig = {
  async rewrites() {
    // A Vercel build must be given the public VPS API origin. Falling back to
    // localhost is only safe for local development and would otherwise proxy
    // production requests into the Vercel function itself.
    if (!backendOrigin) return [];
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  },
};

export default nextConfig;
