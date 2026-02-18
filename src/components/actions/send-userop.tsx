"use client"

import { useSimpleSmartAccount } from "~/hooks/useSimpleSmartAccount"

export function SendUserOp() {
  const { client, error } = useSimpleSmartAccount()

  const send = async () => {
    if (!client) return

    const hash = await client.sendUserOperation({
      calls: [
        {
          to: client.account.address,
          value: 0n,
          data: "0x",
        },
      ],
    })

    console.log("UserOp sent:", hash)
  }

  if (error) return <div>Error: {error.message}</div>

  return <button onClick={send}>Send UserOp</button>
}
