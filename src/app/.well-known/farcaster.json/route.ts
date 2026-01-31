import { METADATA } from "../../../lib/utils";

export async function GET() {
  const config = {
    accountAssociation: {
       "header": "eyJmaWQiOjM0NTk5MywidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweDExMDkxOGJiRmQ2ODE3NjRhMTU3MDU4MUVBNTI0N2ZmYjk5M0NGYzAifQ",
    "payload": "eyJkb21haW4iOiJueWF3aXQtbmloLW9yYW5nLnZlcmNlbC5hcHAifQ",
    "signature": "ORgYca03RGyzFMoa+pf0FRfUUnWAC8Q0ZhmfwIDwtO9FyPxH7x5zYZNrQjgGbzNL6DcqFESq0nvv9GD8TlAwHhs="
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
