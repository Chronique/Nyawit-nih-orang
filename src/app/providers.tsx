"use client";

import dynamic from "next/dynamic";
import FrameProvider from "~/components/providers/frame-provider";

// 🔥 FIX: Ambil 'mod.Providers' (karena export-nya bernama Providers)
const WagmiProvider = dynamic(
  () => import("~/components/providers/wagmi-provider").then((mod) => mod.Providers),
  {
    ssr: false,
  }
);

const ErudaProvider = dynamic(
  () => import("~/components/providers/eruda-provider"),
  {
    ssr: false,
  }
);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider>
      <FrameProvider>
        <ErudaProvider />
        {children}
      </FrameProvider>
    </WagmiProvider>
  );
}