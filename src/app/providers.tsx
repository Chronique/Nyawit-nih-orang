"use client";

import { WagmiProvider } from "~/components/providers/wagmi-provider";
import { FrameProvider } from "~/components/providers/frame-provider";
import { ErudaProvider } from "~/components/providers/eruda-provider"; 
import { AppDialogProvider } from "~/components/ui/app-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider>
      <FrameProvider>
        <ErudaProvider>
          <AppDialogProvider>
            {children}
          </AppDialogProvider>
        </ErudaProvider>
      </FrameProvider>
    </WagmiProvider>
  );
}
