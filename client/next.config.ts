import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/api/creative/:path*",
        destination: `${backendUrl}/creative/:path*`,
      },
      {
        source: "/api/settings/:path*",
        destination: `${backendUrl}/settings/:path*`,
      },
      {
        source: "/api/projects/:path*",
        destination: `${backendUrl}/projects/:path*`,
      },
      {
        source: "/api/users/:path*",
        destination: `${backendUrl}/users/:path*`,
      },
    ];
  },
};

export default nextConfig;
