import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    serverActions: {
      // Excel export templates are up to 2 MiB (D124), plus multipart overhead.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
