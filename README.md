# 🐾 Kitty Market

**Curiosity pays.** AI-resolved prediction markets on [GenLayer](https://genlayer.com).

Kitty Market is a decentralized prediction market where every verdict comes
from **AI validators that read real web pages** — no trusted oracle, no
middleman. Open a market on anything with corroborated sources of truth, take a
side with GEN, and let consensus fetch reality.

---

## ✨ What makes it different

| Feature | Description |
|---|---|
| 🎯 **Open a market** | Any YES/NO question with 1–5 corroborated evidence URLs and close date |
| 🐋 **Wager caps** | Host sets optional min/max stake per position — whales can't dominate |
| ⚔️ **Take a side** | Back YES or NO with GEN; odds shift live |
| 🤖 **AI settlement** | Validators independently fetch all evidence sources and cross-reference |
| 🔍 **Multi-source** | AI cross-references multiple sources — conflicting evidence → inconclusive |
| ↩️ **Voided ≠ frozen** | Unusable verdict or inconclusive ⇒ everyone reclaims their full stake |
| 🏆 **Top Cats** | Rankings by lifetime payouts and hit rate |
| 🔐 **Host lockout** | Whoever controls the evidence sources can never hold positions |

## 🏗️ Architecture

```
┌────────────────────────────────────────────┐
│  Next.js 14 · React 18 · TypeScript        │
│  violet/fuchsia design system              │
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
Address : 0x1439c78a4818E4C5Ba9c78A84c94e161c6257423
Network : GenLayer Studionet (Chain ID 61999)
RPC     : https://studio.genlayer.com/api
Explorer: https://explorer-studio.genlayer.com/address/0x1439c78a4818E4C5Ba9c78A84c94e161c6257423
```

To deploy your own instance, run `contracts/kitty_market.py` through
GenLayer Studio and point `NEXT_PUBLIC_CONTRACT_ADDRESS` at it.

### Write methods

```python
join(name)                                    # register an alias
open_market(question, topic, source_urls, closes_at, min_wager, max_wager)
take_side(market_id, side)                    # payable; side = "yes"|"no"
settle_market(market_id)                      # after close: AI verdict
claim_payout(market_id)                       # winners collect pro-rata (2% levy)
reclaim_stake(market_id)                      # voided markets: full refund
cash_out(amount)                              # wallet -> your address
collect_fees(amount)                          # owner only
```

### Read methods

```python
get_market(id)            get_market_limits(id)
get_trader_info(addr)     get_trader_balance(addr)
get_trader_positions(addr)
get_top_cats()            list_topics()
get_total_markets()       get_total_wagers()    get_total_traders()
get_fee_rate()            get_fee_balance()     get_owner()
```

### Design notes

- **Multi-source settlement**: hosts provide 1–5 corroborated evidence URLs.
  The AI validator cross-references all sources before resolving.
  Conflicting or insufficient evidence yields an inconclusive (void) result.
- **Wager caps**: pass `min_wager=0, max_wager=0` for an uncapped market.
  When `max_wager > 0`, positions must satisfy
  `(min_wager or 1) <= value <= max_wager`.
- **Fee integrity**: the 2 % levy enters the vault once per settled market,
  only when a real winning payout occurs. Losers spamming `claim_payout`
  cannot mint fees.
- **Host lockout**: the market host picks the evidence URLs, so the contract
  forbids them from holding any position in their own market.
- **Void semantics**: resolver failure, unusable verdict, or inconclusive
  result voids the market; `reclaim_stake` returns every stake at full
  value, no fee.
- **Transient retry**: transient fetch/decode errors (network timeout, 502/503,
  decode failure) are retried up to 3 times before giving up. Only persistent
  failures void the market — temporary glitches leave it unsettled for retry.

## 🧪 Testing

In-memory direct-mode tests via `genlayer-test` (Python 3.12+):

```bash
pip install -r requirements.txt
pytest tests/ -v
```

Covers: fee-once integrity, lifecycle enforcement, void/refund paths,
fund conservation across outcomes, host lockout, wager-cap enforcement,
input validation, transient-failure retryable path, and multi-source
inconclusive resolution (36 tests).

Lint the contract:

```bash
genvm-lint check contracts/kitty_market.py
```

## 🚀 Frontend

```bash
npm install
cp .env.example .env      # paste deployed contract address
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
│   ├── conftest.py              # Windows gltest direct-mode fix
│   └── test_kitty_market.py     # property-based test suite
├── src/
│   ├── app/
│   │   ├── layout.tsx           # shell + session provider
│   │   ├── page.tsx             # landing
│   │   ├── markets/
│   │   │   ├── page.tsx         # browse + filters
│   │   │   ├── new/page.tsx     # open a market (multi-URL + wager caps UI)
│   │   │   └── [id]/page.tsx    # detail: stake / settle / claim / reclaim
│   │   ├── rankings/page.tsx    # Top Cats board
│   │   └── portfolio/page.tsx   # stats, cash-out, owner vault
│   ├── components/
│   │   ├── Navbar.tsx           # floating pill nav
│   │   ├── WalletModal.tsx      # multi-wallet picker
│   │   ├── OnboardingDialog.tsx # alias claim
│   │   └── MarketCard.tsx       # reusable market card
│   └── lib/
│       ├── gl.ts                # SDK client factory + formatters
│       ├── session.tsx          # session context
│       ├── wallets.ts           # injected-wallet detection
│       └── types.ts             # shared types/helpers
└── gltest.config.yaml
```

## 📄 License

MIT — see [LICENSE](./LICENSE). © 2026 Kitty Market contributors.

---

Built on **GenLayer** — the Intelligent Blockchain. Curiosity pays. 🐾
