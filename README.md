<h2 align="center">Nyawit</h2>
![License](https://img.shields.io/badge/License-MIT-green)
[![Follow on X](https://img.shields.io/twitter/follow/adhichronique?style=social)](https://x.com/adhichronique)
---
**Nyawit** is a Farcaster Mini-App built on the **Base** network,also accessible via the web. It helps users manage their crypto assets by aggregating "dust" (small token balances) into a Smart Account and providing tools to swap them into ETH or USDC efficiently.







```bash


                                  Owner   ──sign──▶  vault.executeBatch()
                                                               │
                                                  ┌────────────▼─────────────┐
                                                  │   Smart Account (Vault)  │
                                                  │  msg.sender = vault ✓    │
                                                  │                          │
                                                  │  approve(router, max)    │
                                                  │  swap(token→WETH)        │
                                                  └──────────────────────────┘
                                                               │
                                                  ┌────────────▼─────────────┐
                                                  │      DEX (LI.FI)         │
                                                  │                          |
                                                  │    fromAddress = vault ✓ |
                                                  │        taker = vault ✓   |
                                                  └──────────────────────────┘
                                                               │
                                                               │
                                                  ┌────────────▼─────────────┐
                                                  │     Withdraw to Owner    │
                                                  │                          │
                                                  └──────────────────────────┘


                          



```
                    
## 🚀 Key Features

- **Context-Aware Architecture**:
  - **Alchemy smart wallet Eip-1967 Light Account
  
- **Dust Sweeper & Batch Swap**:
  - Scan your wallet for small token balances.
  - Batch swap multiple tokens to ETH in a single transaction using the **0x API**.

- **Smart Vault Management**:
  - *View assets stored in your Smart Account.*
  - **Deposit**: Easily transfer assets from your EOA (Owner) to the Vault.
  - **Withdraw**: Transfer assets back to your main wallet.
  - **Spam Filtering**: Automatically detects and sorts spam tokens to the bottom using Alchemy data.
  - **Real-time Pricing**: Token prices fetched via GeckoTerminal.

- **Interactive UI**:
  - Mobile-first design with a bottom navigation bar.
  - Paginated asset lists for better performance.

## 🛠 Tech Stack

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Blockchain Interaction**: [Wagmi](https://wagmi.sh/) & [Viem](https://viem.sh/)
- **Smart Accounts (AA)**: 
  - [Alchemy](https://github.com/alchemyplatform) (Alchemy)
- **Data Providers**:
  - [Alchemy](https://www.alchemy.com/) (RPC & Token Balances)
  - [GeckoTerminal](https://www.geckoterminal.com/) (Price Feeds)
- **Swap Aggregator**: [Lifi](https://li.fi/)
- **Icons**: [Iconoir](https://iconoir.com/) & Lucide

## ⚙️ Environment Variables

To run this project locally, you need to set up the following environment variables in a `.env.local` file:

```bash
# WalletConnect Project ID (Required for Wagmi)
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_project_id

# Alchemy API Key (For Base Mainnet RPC & Data)
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_key

# Moralis API Key (For Token Indexing & Spam Detection)
NEXT_PUBLIC_MORALIS_API_KEY=your_moralis_key

# 0x API Key (For Swap Quotes)
NEXT_PUBLIC_ZEROEX_API_KEY=your_0x_api_key

# ZeroDev Project ID (If using System A)
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your_zerodev_id

# Paymaster URL (Optional, for gas sponsorship)
NEXT_PUBLIC_PAYMASTER_URL=your_paymaster_url
```

## 📦 Installation
Clone the repository:

```Bash
git clone [https://github.com/yourusername/nyawit.git](https://github.com/yourusername/nyawit.git)
cd nyawit
Install dependencies:
```

```Bash
npm install
# or
yarn install
# or
pnpm install
Run the development server:
```

```Bash
npm run dev
```
Open your browser: Navigate to http://localhost:3000 to see the app.

---
## 📖 Usage Guide
1. **Deposit (Blusukan)**

    This tab allows you to activate Smart wallet,view approval token,and send GM



2. **Swap (Bakar Wilayah)**
    Select multiple "dust" tokens inside your Vault.

    Swap preview to see estimate price

    Leverages Account Abstraction for gas efficiency.


3. **Yiled Farming (Tanam)**
    Users can deposite weth or usdc to earn Yield 


4. **Vault (Panen)**
    View your aggregated assets.

    Withdraw assets back to your main wallet if needed.

    Assets are paginated (10 items per page).
---
## ⚠️ Important Note
This application is optimized for Base Mainnet. Please ensure your wallet is connected to the Base network.


---
## 📄 License
This project is licensed under the MIT License - see the LICENSE
 file for details.
