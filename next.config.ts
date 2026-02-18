import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fix: valtio dan @reown/appkit pakai ESM yang tidak bisa di-handle webpack tanpa ini
  transpilePackages: [
    "valtio",
    "@reown/appkit",
    "@reown/appkit-controllers",
    "@reown/appkit-common",
    "@walletconnect/ethereum-provider",
  ],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
