import { METADATA } from "../../../lib/utils";

export async function GET() {
  const config = {
    accountAssociation: {
      "header": "eyJmaWQiOjM0NTk5MywidHlwZSI6ImF1dGgiLCJrZXkiOiIweDk2Q2MxN0M3N2E1MDREM0ZERDUxNmU2NjIxMzAzMDdFZjc0M2QzMEIifQ",
      "payload": "eyJkb21haW4iOiJkdXN0LXN3ZWVwZXItdGhldGEudmVyY2VsLmFwcCJ9",
      "signature": "2wqRxDh0kDbp/88fTK5RUlznwuff4Rf5b7MQ1+7yz5dVwD1D+9MjeAzinKBBQlbOv4e5xJLJrNIHMq049YmYVhs="
    },

      "frame": {
        "version": "1",
        "name": METADATA.name,
        "iconUrl": METADATA.iconImageUrl,
        "homeUrl": METADATA.homeUrl,
        "imageUrl": METADATA.bannerImageUrl,
        "webhookUrl": `${METADATA.homeUrl}/api/webhook`,
        "splashImageUrl": METADATA.iconImageUrl,
        "splashBackgroundColor": METADATA.splashBackgroundColor,
        "description": METADATA.description,
        "ogTitle": METADATA.name,
        "ogDescription": METADATA.description,
        "ogImageUrl": METADATA.bannerImageUrl,
        "primaryCategory": "finance",
        "requiredCapabilities": [
      "actions.ready",
      "actions.signIn",          
      "actions.addMiniApp",       
      "actions.openUrl",          
      "actions.sendToken",        
      "actions.viewToken",        
      "actions.composeCast",      
      "actions.viewProfile",      
      "actions.swapToken",        
      "actions.close",            
      "actions.viewCast"          
    ],
        "requiredChains": [
          "eip155:8453",
          "eip155:10"
        ],
        "noindex": false,
        "tags": ["base", "baseapp", "miniapp", "swap" , "dex"]
      },
      "baseBuilder": {
        "allowedAddresses": ["0x4fba95e4772be6d37a0c931D00570Fe2c9675524"],
      }
  };

  return Response.json(config);
}
