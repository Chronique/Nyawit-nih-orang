import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

  // Config Webpack ini SANGAT KRUSIAL untuk Web3
  webpack: (config: any) => {
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

    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

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