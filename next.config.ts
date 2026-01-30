import type { NextConfig } from "next";

const nextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  
  typescript: {
    ignoreBuildErrors: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Access-Control-Allow-Origin", value: "*" }
        ]
      }
    ];
  },

  webpack: (config: any) => {
    // 1. Fallback untuk modul Node.js
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      child_process: false, 
      worker_threads: false,
      'tap': false,
      'fastbench': false,
      'why-is-node-running': false,
      'pino-elasticsearch': false,
      'desm': false
    };

    // 2. [FIX BARU] Alias modul React Native ke 'false' agar diabaikan di Web
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // 3. Ignore file testing
    config.module.rules.push({
      test: /thread-stream\/test\//,
      use: 'ignore-loader', 
    });
    config.module.rules.push({
      test: /\.test\.(js|ts|mjs)$/,
      use: 'ignore-loader', 
    });

    return config;
  },
};

export default nextConfig;