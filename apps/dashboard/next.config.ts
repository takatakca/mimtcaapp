import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered admin app: pages fetch the MIMT API at request time with
  // the operator's bearer token (httpOnly cookie). NOT a static export.
  poweredByHeader: false,
  transpilePackages: ["@mimt/shared"],
};

export default nextConfig;
