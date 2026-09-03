import type { NextConfig } from "next";

const configuredBackendOrigin = process.env.FASTAPI_ORIGIN?.replace(/\/$/, "");
const backendOrigin = configuredBackendOrigin || (process.env.NODE_ENV === "production" ? undefined : "http://127.0.0.1:8000");
const serverlessOrigin = process.env.SERVERLESS_API_ORIGIN?.replace(/\/$/, "") || "https://serverless-snowy-kappa-42.vercel.app";

const nextConfig: NextConfig = {
  async rewrites() {
    // A Vercel build must be given the public VPS API origin. Falling back to
    // localhost is only safe for local development and would otherwise proxy
    // production requests into the Vercel function itself.
    const routes = [{ source: "/api/serverless/:path*", destination: `${serverlessOrigin}/api/serverless/:path*` }];
    if (backendOrigin) routes.push({ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` });
    return routes;
  },
};

export default nextConfig;
