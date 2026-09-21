# 🐾 Kitty Market

**Curiosity pays.** AI-resolved prediction markets on [GenLayer](https://genlayer.com).

Kitty Market is a decentralized prediction market where every verdict comes
from **AI validators that read real web pages** — no trusted oracle, no
middleman. Open a market on anything with a corroborated source of truth, take a
side with GEN, and let consensus fetch reality.

---

## ✨ What makes it different

| Feature | Description |
|---|---|
| 🎯 **Open a market** | Any YES/NO question with an evidence URL and close date |
| 🐋 **Wager caps** | Host sets optional min/max stake per position — whales can't dominate |
| ⚔️ **Take a side** | Back YES or NO with GEN; odds shift live |
| 🤖 **AI settlement** | Validators independently fetch the evidence source and resolve |
| ↩️ **Voided ≠ frozen** | Unusable verdict or terminal failure ⇒ everyone reclaims their full stake |
| 🔁 **Terminal void** | After 5 failed settle attempts, market enters permanent void for full refund |
| 🏆 **Top Cats** | Rankings by lifetime payouts and hit rate |
| 🔐 **Host lockout** | Whoever controls the evidence source can never hold positions |

## 🏗️ Architecture

```
┌────────────────────────────────────────────┐
│  Next.js · React 19 · TypeScript           │
│  Tailwind CSS · genlayer-js SDK            │
└─────────────────┬──────────────────────────┘
                  │ genlayer-js
┌─────────────────▼──────────────────────────┐
│  KittyMarket (Python Intelligent Contract) │
│  markets · positions · traders · fee vault │
└─────────────────┬──────────────────────────┘
┌─────────────────▼──────────────────────────┐
│  GenLayer Optimistic Democracy             │
│  validators run independent LLMs over web  │
│  data and settle via Equivalence Principle │
└────────────────────────────────────────────┘
```

## 📜 Contract

**Live on Studionet:**

```
Address : 0x79e4B28A91277841aC8a3e1Da9204feb564081EF
Network : GenLayer Studionet (Chain ID 61999)
RPC     : https://studio.genlayer.com/api
Explorer: https://explorer-studio.genlayer.com/contracts/0x79e4B28A91277841aC8a3e1Da9204feb564081EF
```

To deploy your own instance, run `contracts/kitty_market.py` through
GenLayer Studio and point `CONTRACT_ADDRESS` in `src/lib/session.tsx` at it.

### Write methods

```python
join(alias)                                                    # register an alias
open_market(question, topic, source_url, closes_at, min_wager, max_wager)
                                                               # payable; create a market
take_side(market_id, side)                    # payable; side = "yes"|"no"
settle_market(market_id)                      # after close: AI verdict
terminal_void(market_id)                      # after 5 failed settles: permanent void
claim_payout(market_id)                       # winners collect pro-rata (1% fee)
reclaim_stake(market_id)                      # voided markets: full refund
cash_out(amount)                              # withdraw GEN from contract balance
collect_fees(amount)                          # owner only: withdraw accumulated fees
```

### Read methods

```python
get_market(id)              get_owner()
get_trader_info(addr)       get_fee_balance()
get_trader_positions(addr)
get_top_cats()
get_total_markets()         get_total_wagers()    get_total_traders()
```

### Design notes

- **AI settlement**: the host provides an evidence URL. AI validators independently
  fetch the page, cross-reference it against the question, and resolve via consensus.
  Conflicting or insufficient evidence yields a void result.
- **Terminal void**: if settlement fails 5 times (evidence permanently inaccessible
  or undecodable), anyone can call `terminal_void` to mark the market for full refund.
  All participants then call `reclaim_stake` to recover 100% of their stakes.
- **Wager caps**: pass `min_wager=0, max_wager=0` for an uncapped market.
  When `max_wager > 0`, positions must satisfy
  `(min_wager or 1) <= value <= max_wager`.
- **Fee integrity**: the 1% levy enters the vault once per settled market,
  only when a real winning payout occurs. Losers spamming `claim_payout`
  cannot mint fees.
- **Host lockout**: the market host picks the evidence URL, so the contract
  forbids them from holding any position in their own market.

## 🚀 Frontend

```bash
npm install
npm run dev               # http://localhost:3000
```

Add GenLayer Studionet to MetaMask:

| Field | Value |
|---|---|
| RPC URL | `https://studio.genlayer.com/api` |
| Chain ID | `61999` |
| Currency | GEN |
| Explorer | `https://explorer-studio.genlayer.com` |

Get testnet GEN from the faucet inside [Studionet](https://studio.genlayer.com).

## 📁 Project structure

```
kitty-market/
├── contracts/
│   └── kitty_market.py          # GenLayer Intelligent Contract
├── tests/
│   └── test_terminal_void.py    # Terminal void refund path tests
├── scripts/
│   └── test-final-v2.js         # Deploy + full method test suite
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Shell + session provider
│   │   ├── page.tsx             # Landing
│   │   ├── globals.css          # Tailwind base styles
│   │   ├── markets/
│   │   │   ├── page.tsx         # Browse + filters
│   │   │   ├── new/page.tsx     # Open a market
│   │   │   └── [id]/page.tsx    # Detail: stake / settle / claim / reclaim
│   │   ├── rankings/page.tsx    # Top Cats board
│   │   └── portfolio/page.tsx   # Stats, cash-out, owner vault
│   ├── components/
│   │   └── Navbar.tsx           # Navigation bar
│   └── lib/
│       └── session.tsx          # Session context + all contract interactions
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.js
└── postcss.config.js
```

## 📄 License

MIT — © 2026 Kitty Market contributors.

---

Built on **GenLayer** — the Intelligent Blockchain. Curiosity pays. 🐾
