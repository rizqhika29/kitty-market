# Kitty Market

Prediction market built on [GenLayer](https://genlayer.com) with terminal void refund mechanism.

## Overview

Kitty Market is a decentralized prediction market where users can:
- Create prediction markets on any Yes/No question
- Place wagers on outcomes (YES/NO)
- Cash out winning positions
- Settle markets with AI-powered resolution via GenLayer intelligent contracts

### Terminal Void Mechanism

When market evidence becomes permanently inaccessible (e.g., URL dead after 5 settle attempts), the market enters **terminal void** status and all participants can reclaim their stakes in full.

## Architecture

- **Contract**: `contracts/kitty_market.py` — GenLayer intelligent contract (Python)
- **Frontend**: Next.js + React 19 + Tailwind CSS + genlayer-js SDK
- **Network**: GenLayer Studionet (chainId 61999)

## Contract Methods

| Method | Description |
|--------|-------------|
| `join(name, avatar)` | Register as a trader |
| `open_market(question, topic, source_url, closes_in, min_wager, max_wager)` | Create a new market |
| `take_side(market_id, side, amount)` | Place a wager (YES/NO) |
| `cash_out(market_id)` | Collect winnings from resolved market |
| `settle_market(market_id)` | Trigger AI resolution (may fail multiple times) |
| `terminal_void(market_id)` | Mark permanently failed market for refund |
| `reclaim_stake(market_id)` | Get full refund from voided market |
| `collect_fees()` | Host withdraws accumulated fees |

## Setup

```bash
npm install
npm run dev
```

## Deployed Contract

- **Address**: `0xB4941E7F849C112aCe354E5eaD956E08D95744Bc`
- **Explorer**: https://explorer-studio.genlayer.com/contracts/0xB4941E7F849C112aCe354E5eaD956E08D95744Bc
