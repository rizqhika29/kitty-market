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
Address : 0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7
Network : GenLayer Studionet (Chain ID 61999)
RPC     : https://studio.genlayer.com/api
Explorer: https://explorer-studio.genlayer.com/contracts/0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7
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
collect_fees(amount)                          # owner only: withdraw accumulated fees
```

The unsafe balance-based `cash_out()` method has been removed. Participants
receive funds only through `claim_payout()` (their winning entitlement) or
`reclaim_stake()` (their own refund). The owner can withdraw only accrued fees.

### Read methods

```python
get_market(id)              get_owner()
get_trader_info(addr)       get_fee_balance()
get_trader_positions(addr)  get_liability()
get_top_cats()              get_accounting()
get_total_markets()         get_total_wagers()    get_total_traders()
```

### Design notes

- **AI settlement**: the host provides an evidence URL. AI validators independently
  fetch the page, cross-reference it against the question, and resolve via consensus.
  Conflicting or insufficient evidence yields a void result.
- **Close-time enforcement**: `settle_market` and `terminal_void` reject any call
  before `closes_at`. Settlement attempts are incremented only after a failed
  (void) resolution, so the terminal-void counter can never be built up early.
- **Terminal void**: if settlement fails 5 times (evidence permanently inaccessible
  or undecodable), anyone can call `terminal_void` to mark the market for full refund.
  All participants then call `reclaim_stake` to recover 100% of their stakes.
- **Wager caps**: pass `min_wager=0, max_wager=0` for an uncapped market.
  `max_wager` is enforced against a trader's **cumulative position**, not each
  individual deposit. The minimum applies to each deposit.
- **Zero-winner policy**: if the AI resolves a side that has no positions, the
  market settles as `void` with no fee so every stake is refundable.
- **Fee integrity**: the 1% levy is accrued exactly once, at settlement, into a
  dedicated `fee_balance`. Claims only release the pre-computed `payout_pool`;
  `collect_fees` is owner-only and refuses transfers that would leave the
  contract below outstanding participant liabilities.
- **Liability accounting**: `liability` tracks every outstanding refund and
  unpaid winning payout. `get_accounting()` exposes contract balance, liability,
  fee vault, surplus, and a `solvent` flag.
- **Host lockout**: the market host picks the evidence URL, so the contract
  forbids them from holding any position in their own market.

## 🔐 Steward review fixes

| Issue | Resolution |
|---|---|
| Unauthorized `cash_out()` | Method removed entirely; funds leave only via `claim_payout()` / `reclaim_stake()` / owner-only `collect_fees()`. |
| Fee inflated per winning claim | Fee is computed and accrued exactly once at settlement; `claim_payout()` only releases `payout_pool`. |
| Fee withdrawal could touch reserves | `collect_fees()` is capped by `fee_balance` and checks `balance >= liability + amount`. |
| Premature settlement | `settle_market()` requires `now >= deadline`; failed-attempt counter increments only after a void resolution. |
| Premature terminal void | `terminal_void()` requires the close time plus 5 counted failed attempts. |
| Wager cap bypass via top-ups | `max_wager` is enforced against the cumulative position (`existing + new`). |
| No policy for zero winning positions | Such markets resolve as `void` with zero fee, making every stake refundable. |
| Frontend writes failed with `No account set` | Reads and writes use separate clients; every write is bound to the connected address and signs through the browser wallet, which is switched to Studionet first. |

## 🚀 Frontend

```bash
npm install
npm run dev               # http://localhost:3000
```

Market creation and every other state-changing action require a browser wallet
(MetaMask or any EIP-1193 wallet). The app adds/switches the wallet to GenLayer
Studionet (chain ID 61999) before sending a transaction, so the wallet shows its
usual signature prompt.

To verify the wallet client path without a browser:

```bash
node scripts/verify-wallet-client.js
```

The script builds the same client the frontend uses, deploys a scratch instance
of the contract, and creates a market through the provider signing flow.

## ✅ Tests & linting

```bash
pip install -r requirements.txt
python -m pytest tests/ -v          # 17 Direct Mode tests (no Studio needed)

pip install genvm-linter
genvm-lint check contracts/kitty_market.py   # fast AST safety checks
genvm-lint typecheck contracts/kitty_market.py
```

The direct suite covers unauthorized withdrawals, multiple winning claims,
fee accounting, premature settlement, repeated/terminal settlement attempts,
cumulative wager caps, zero-winning-position voids, and liability coverage
throughout every payout and refund flow.

### Studionet proof

`scripts/verify-fixes.js` deploys no extra state and exercises the already
deployed corrected contract:

```bash
node scripts/deploy.js         # deploy a fresh instance + update config
node scripts/verify-fixes.js   # full on-chain flow, writes tx references
```

Latest run: **0 failures**, contract
`0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7`. Full hashes are in
[`scripts/studionet-verification.json`](scripts/studionet-verification.json).

| Step | Studionet transaction |
|---|---|
| Create payout market | `0x5bb4dc6ab876b758c26ad09215e85347bcc7b4d55cf43ff7bf0ab65d2d210577` |
| Stake 3 GEN YES | `0x567c2a1220f3dbe84b33ef90d6c1a0170998a9dc29b8145117e69d15536f618c` |
| Stake 1 GEN NO | `0xab260623f8f6f358f46b8248cde23dd4d5da4c2541e75b5fe2355c766d7cb175` |
| Premature settle rejected | `0x81087bcf57f5e3401db821e31dc3da29d5a1319093131e329d90d8251b0dfaba` |
| AI settlement (YES) | `0x84c5509d7da6ecb21d3b095ff4aecca9c5f6f646361d67967c14c7235ea3bdec` |
| Winning payout claimed | `0xc60dc2c1b53fd9ea6b87275f4749a94a418e73a1f9a4130408afad427588a3fa` |
| Fee collected by owner | `0xaec75df121037ad84d3b3161f56ba7e1d0ea374f877aec85d800c4060207c917` |
| Zero-winner market created | `0x398f17d30e2e677cf7811af365966dfd771837f041511eddf804995a34827eb4` |
| AI settlement -> void | `0x65f44970d821f73a8d1d9d016da46b44f3e5d635df0fcf406b8895d75fc2c4db` |
| Void refund reclaimed | `0x2d73ff5bfc87943a0244a8ec3a9b3ce33110d0f95e3bd5a1871699ea9cc5d64b` |

Explorer:
`https://explorer-studio.genlayer.com/contracts/0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7`

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
│   ├── conftest.py              # Shared Direct Mode env + liability ledger
│   ├── test_terminal_void.py    # Terminal void refund path tests
│   ├── test_payouts.py          # Settlement / claim / fee collection tests
│   └── test_lifecycle_safety.py # Deadline, attempts, caps, invariants
├── scripts/
│   ├── deploy.js                # Deploy to Studionet
│   ├── verify-fixes.js          # Full corrected-contract Studionet proof
│   ├── studionet-verification.json # Recorded tx references
│   ├── deploy-and-test-full.js  # Legacy deploy + terminal void proof
│   └── full-test.js             # Legacy 35-assertion method suite
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
│   │   └── portfolio/page.tsx   # Stats, positions, owner fee vault
│   ├── components/
│   │   └── Navbar.tsx           # Navigation bar
│   └── lib/
│       └── session.tsx          # Session context + all contract interactions
├── requirements.txt             # Python test dependencies
├── gltest.config.yaml           # genlayer-test configuration
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
