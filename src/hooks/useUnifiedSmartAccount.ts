"use client";

import { useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { createUnifiedSmartAccountClient } from "~/lib/unified-smart-account";

export function useUnifiedSmartAccount() {
  const { data: walletClient } = useWalletClient();
  const [client, setClient] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!walletClient) return;

    createUnifiedSmartAccountClient(walletClient)
      .then(setClient)
      .catch(setError);
  }, [walletClient]);

  return { client, error };
}
