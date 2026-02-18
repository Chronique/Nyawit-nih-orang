"use client"

import { useEffect, useState } from "react"
import { createSmartAccountClient } from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`

export function useSimpleSmartAccount() {
  const [client, setClient] = useState<any>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!(window as any).ethereum) return

    let cancelled = false

    async function init() {
      try {
        const publicClient = createPublicClient({
          chain: base,
          transport: http("https://mainnet.base.org"),
        })

        const smartAccount = await toSimpleSmartAccount({
          client: publicClient,
          owner: (window as any).ethereum, // ✅ EthereumProvider
          entryPoint: {
            address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
            version: "0.6",
          },
        })

        const saClient = createSmartAccountClient({
          account: smartAccount,
          chain: base,
          bundlerTransport: http(PIMLICO_URL),
        })

        if (!cancelled) setClient(saClient)
      } catch (e: any) {
        if (!cancelled) setError(e)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  return { client, error }
}
