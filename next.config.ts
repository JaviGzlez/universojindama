import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // el Excel de analítica pesa ~2 MB; Vercel admite hasta 4,5 MB por petición
    serverActions: { bodySizeLimit: "4mb" },
  },
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
