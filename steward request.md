# Steward Review Response — Kitty Market

**Project:** Kitty Market — AI-resolved prediction markets on GenLayer  
**Repository:** https://github.com/rizqhika29/kitty-market  
**Network:** GenLayer Studionet (Chain ID 61999)  
**Corrected contract:** `0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7`  
**Deployment transaction:** `0x6de070a09761273ee801804157f56a2e1e4086e6414ba090bec9f96878e89de1`  
**Implementation commit:** `a8eb02aa9b7e837860d646a8721d46b3349c84cb`  
**Explorer:** https://explorer-studio.genlayer.com/contracts/0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7

This document maps every item in the Steward request to the concrete fix,
the relevant code, the automated test coverage, and the reproducible Studionet
evidence. All work described here is committed and pushed to `main`.

---

## 1. Status summary

| # | Steward request | Status | Primary evidence |
|---|---|---|---|
| 1 | Remove/redesign `cash_out()` to enforce withdrawal entitlements | **Fixed** | Method removed; only entitlement-based payouts/refunds remain |
| 2 | Accrue fee exactly once per market; protect participant reserves | **Fixed** | Fee reserved at settlement; `collect_fees()` guarded by liability |
| 3 | Enforce close time; count attempts only after closure; gate terminal void | **Fixed** | Deadline checks in `settle_market()` / `terminal_void()` |
| 4 | Define policy for outcomes with no winning positions | **Fixed** | Zero-winner result resolves as `void` with zero fee and full refunds |
| 5 | Enforce wager caps against cumulative exposure | **Fixed** | `max_wager` checked against `existing_size + amount` |
| 6 | Extend automated tests for every reported scenario | **Fixed** | 17 Direct Mode tests, all passing |
| 7 | Provide commit hash, test results, Studionet transaction references | **Fixed** | Sections 8–9 of this document |
| 8 | Confirm frontend uses the corrected deployed contract | **Fixed** | `src/lib/session.tsx` points to the new address; production build passes |

---

## 2. Request 1 — Unauthorized withdrawal through `cash_out()`

### Steward finding

> `cash_out()` permits a caller to withdraw funds based on the contract's
> available balance without verifying that those funds belong to the caller.
> Since the contract holds wagers belonging to multiple participants, this
> creates a potentially critical unauthorized withdrawal vulnerability.

### Root cause

The old function only checked:

```python
assert self.balance >= amount
```

It did not check positions, market outcome, or unpaid entitlements. Any address
could therefore drain GEN belonging to other traders, the fee vault, or
outstanding refund liabilities.

### Fix implemented

`cash_out()` has been **removed entirely** from
`contracts/kitty_market.py`. There is no balance-based withdrawal entry point
for arbitrary callers.

Funds can now leave the contract only through three entitlement-checked paths:

1. **`claim_payout(market_id)`** — caller must hold an open position on the
   resolved winning side. The payout is computed from that position's size.
2. **`reclaim_stake(market_id)`** — caller must hold an open position in a
   resolved void/terminal-void market. The refund equals their own stake.
3. **`collect_fees(amount)`** — contract owner only, capped by the accrued
   `fee_balance`, and additionally guarded so the remaining contract balance
   still covers all participant liabilities.

### Safety properties after the fix

- A caller cannot withdraw another trader's stake.
- A losing position cannot call `claim_payout()`.
- A position can be closed only once (`Already claimed` / `Already reclaimed`).
- A void position can only recover its own recorded `size`, never more.
- The owner cannot withdraw participant reserves through the fee path.

### Test coverage

`tests/test_payouts.py`

- `test_cash_out_is_removed` — asserts the old method no longer exists.
- `test_fee_collection_never_reduces_participant_reserves` — non-owner and
  over-vault withdrawals are rejected.
- `test_multiple_winners_claim_without_minting_extra_fees` — double claim and
  wrong-side claim are rejected.

`tests/test_terminal_void.py`

- `test_cannot_double_reclaim`
- `test_uninvolved_trader_cannot_reclaim`

---

## 3. Request 2 — Fee accrual and participant reserve integrity

### Steward finding

> `claim_payout()` appears to credit the entire market fee to `fee_balance`
> whenever an individual winning participant claims. For markets with multiple
> winners, this can inflate accumulated fees and compromise funds needed for
> other payouts.

### Root cause

The old `claim_payout()` recomputed and credited the whole market fee on every
claim:

```python
fee = total_pool * self.fee_rate // u256(10000)
self.fee_balance = u256(self.fee_balance + fee)
```

With two winners, the fee was credited twice even though only one market fee
was ever owed.

### Fix implemented

Fee computation and accrual now happen **exactly once, at settlement**, in
`settle_market()`:

```python
total_pool = u256(market.yes_pool + market.no_pool)
fee = u256(total_pool * self.fee_rate // u256(10000))
distributable = u256(total_pool - fee)

self.markets[idx].fee_accrued = fee
self.markets[idx].payout_pool = distributable
self.fee_balance = u256(self.fee_balance + fee)
self.liability = u256(self.liability - fee)
```

`claim_payout()` no longer touches `fee_balance`. It only releases the
pre-computed participant pool:

```python
distributable = market.payout_pool
winning_pool = market.yes_pool if pos.side == "yes" else market.no_pool
share = u256(pos.size * distributable // winning_pool)
self.liability = u256(self.liability - share)
```

### Fee model

- Fee rate: `100 / 10000` = **1%**.
- Fee is charged on the total market pool, once.
- `fee_accrued` is stored per market and exposed by `get_market()`.
- `payout_pool` is the amount distributable to winners after the fee.
- `fee_balance` is the global vault the owner may collect.
- Claims are proportional to position size within the winning pool.

### Reserve protection in `collect_fees()`

```python
assert _addr(gl.message.sender_address) == self.owner, "Only owner"
assert amount > u256(0), "Amount must be greater than 0"
assert self.fee_balance >= amount, "Insufficient fee balance"
assert self.balance >= u256(self.liability + amount), (
    "Withdrawal would reduce participant reserves"
)
```

This prevents the owner from treating participant deposits as fees even if the
fee accounting were ever inconsistent.

### Test coverage

`tests/test_payouts.py`

- `test_multiple_winners_claim_without_minting_extra_fees`
  - Two winners on the same side.
  - Fee vault stays constant after each claim.
  - Total payouts equal the full distributable pool.
- `test_fee_is_accrued_once_per_market_not_per_claim`
  - Two independent markets accrue independent fees.
  - Claims do not increase `fee_balance`.
- `test_fee_collection_never_reduces_participant_reserves`
  - Non-owner collection rejected.
  - Over-vault collection rejected.
  - Underfunded reserve scenario rejected.
  - Normal fee withdrawal leaves exactly the winner's reserve.

---

## 4. Request 3 — Settlement lifecycle correctness

### Steward finding

> `settle_market()` does not visibly enforce the market closing timestamp,
> allowing premature resolution. Its settlement-attempt counter can also be
> incremented before closure, potentially enabling premature terminal voiding.

### Fix implemented

#### 4.1 Closing timestamp is enforced

```python
now = u64(int(datetime.now(timezone.utc).timestamp()))
assert now >= market.deadline, "Market has not closed yet"
```

`settle_market()` now rejects any resolution attempt before `closes_at`.
`terminal_void()` also checks the deadline explicitly.

#### 4.2 Attempts are counted only for failed resolutions

The counter is no longer incremented at the start of the call. It is incremented
only after the AI result is known to be `void`:

```python
self.markets[idx].settle_attempts = u64(market.settle_attempts + u64(1))
self.markets[idx].outcome = outcome
self.markets[idx].reasoning = reasoning
self.markets[idx].resolved = False
```

Successful `yes`/`no` resolutions return before this block, so a success does
not increment attempts. A zero-winner market also resolves safely and does not
increment attempts.

#### 4.3 Terminal void conditions

```python
assert not market.resolved, "Already resolved"
assert not market.terminal_void, "Already terminal void"
now = u64(int(datetime.now(timezone.utc).timestamp()))
assert now >= market.deadline, "Market has not closed yet"
assert market.settle_attempts >= MAX_SETTLE_ATTEMPTS, (
    f"Must have {MAX_SETTLE_ATTEMPTS} or more failed settle attempts"
)
```

`MAX_SETTLE_ATTEMPTS = 5`.

Terminal void is therefore possible only when all of the following hold:

1. The market has not already been resolved.
2. It is not already terminal-voided.
3. The close timestamp has passed.
4. At least five failed (void) settlement attempts have been recorded.

#### 4.4 Defensive handling of nondeterministic failures

Unexpected exceptions from `gl.vm.run_nondet_unsafe()` are caught and treated
as a failed (void) attempt instead of reverting without accounting:

```python
try:
    result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
except Exception:
    result = {"outcome": "void", "reasoning": "Settlement failed or timed out"}
```

This preserves the intended retry/terminal-void lifecycle.

### Test coverage

`tests/test_lifecycle_safety.py`

- `test_settlement_cannot_run_before_the_close_time`
  - Premature settlement rejected.
  - Attempt counter remains `0`.
  - Premature terminal void rejected.
- `test_only_failed_attempts_are_counted_and_terminal_void_is_gated`
  - Five void attempts increment `1..5`.
  - Terminal void rejected at attempts `< 5`.
  - Terminal void succeeds at `5`, from an unrelated caller.
  - Full refunds remain covered.
- `test_successful_settlement_does_not_increment_attempts`
  - A successful resolution keeps attempts at `0`.
  - Re-settlement and terminal void after resolution are rejected.
- `test_zero_winning_result_does_not_count_as_a_failed_attempt`

`tests/test_terminal_void.py`

- `test_cannot_terminal_void_before_max_attempts`
- `test_full_refund_after_terminal_void`
- `test_cannot_double_reclaim`
- `test_uninvolved_trader_cannot_reclaim`
- `test_host_can_also_reclaim_from_another_hosts_market`
- `test_cannot_reclaim_stake_on_non_void`

---

## 5. Request 4 — Outcome with no winning positions

### Steward finding

> Implement a clear policy for outcomes with no winning positions.

### Policy implemented

If the AI resolves `yes` or `no` but the corresponding winning pool is empty,
the market becomes a **resolved void with no fee**:

```python
winning_pool = market.yes_pool if outcome == "yes" else market.no_pool
if winning_pool == u256(0):
    outcome = "void"
    reasoning = (
        f"{reasoning} No winning positions existed, so the market "
        f"is void and all stakes are refundable."
    )
    self.markets[idx].resolved = True
    self.markets[idx].outcome = outcome
    self.markets[idx].reasoning = reasoning
    return json.dumps({"outcome": outcome, "reasoning": reasoning})
```

### Why this policy

- There is no correct claimant to pay.
- Leaving the pool locked would permanently trap user funds.
- Charging a fee would take money from participants without a winning payout.
- Treating the market as `void` reuses the existing, audited full-refund path.

### Test coverage

`tests/test_payouts.py`

- `test_zero_winning_positions_become_a_full_refund_void`
  - Only YES positions exist; AI resolves NO.
  - Market becomes settled `void`.
  - `fee_accrued == 0`, `payout_pool == 0`, `winning_pool == 0`.
  - `claim_payout()` is rejected as a void market.
  - The original staker reclaims 100% of their stake.
  - Double reclaim is rejected.
  - Accounting ends at zero liability and zero fee.

`tests/test_lifecycle_safety.py`

- `test_zero_winning_result_does_not_count_as_a_failed_attempt`

---

## 6. Request 5 — Cumulative wager caps

### Steward finding

> Enforce wager caps against cumulative positions rather than individual
> deposits where the advertised limit concerns total exposure.

### Fix implemented

`take_side()` now loads the trader's existing position first, computes the
resulting position size, and applies the cap to the cumulative amount:

```python
existing_size = u256(0)
if pos_key in self.positions:
    existing = self.positions[pos_key]
    assert existing.side == side, "Already on the other side"
    assert not existing.closed, "Position already closed"
    existing_size = existing.size

new_size = u256(existing_size + amount)

if market.min_wager > 0:
    assert amount >= market.min_wager, "Below minimum wager"
if market.max_wager > 0:
    assert new_size <= market.max_wager, "Above maximum wager"
```

Semantics:

- `min_wager` applies to each individual deposit.
- `max_wager` applies to the trader's total exposure in that market.
- A top-up that individually fits under the cap but pushes cumulative exposure
  over the cap is rejected.
- The cap is per trader, not global.

### Test coverage

`tests/test_lifecycle_safety.py::test_wager_cap_applies_to_cumulative_position`

- Cap = 10 GEN.
- 6 GEN deposit succeeds.
- A further 5 GEN deposit fails even though 5 < 10, because 6 + 5 > 10.
- A further 4 GEN deposit succeeds, bringing the position to exactly 10.
- Any additional deposit fails.
- Deposits below the minimum fail.
- A different trader can still take up to the same cap independently.
- Liability equals total pools after all successful deposits.

---

## 7. Request 6 — Expanded automated test suite

### Result

```text
python -m pytest tests/ -q
17 passed in 3.79s
```

### Files

| File | Tests | Focus |
|---|---:|---|
| `tests/test_lifecycle_safety.py` | 6 | Deadline, attempts, terminal gating, caps, liability coverage |
| `tests/test_payouts.py` | 5 | Withdrawal safety, multi-winner claims, fee accounting, zero-winner policy |
| `tests/test_terminal_void.py` | 6 | Terminal void, refunds, double-claim/reclaim guards, host refunds |

### Shared test harness

`tests/conftest.py` provides:

- `MarketEnv` for deploy/open/stake/settle/claim/reclaim/collect flows.
- A `Ledger` that mirrors native value transfers in Direct Mode, so solvency
  can be asserted realistically.
- `assert_solvent()` which checks:

```python
contract_balance >= liability + fee_balance
```

Every payout/refund/fee scenario asserts solvency before and after the
operation, demonstrating that outstanding obligations remain fully covered.

### Covered Steward scenarios

| Scenario | Test |
|---|---|
| Unauthorized withdrawal | `test_cash_out_is_removed`, fee reserve tests |
| Multiple winning claims | `test_multiple_winners_claim_without_minting_extra_fees` |
| Fee accounting | `test_fee_is_accrued_once_per_market_not_per_claim` |
| Premature settlement | `test_settlement_cannot_run_before_the_close_time` |
| Repeated settlement attempts | `test_only_failed_attempts_are_counted_and_terminal_void_is_gated` |
| Cumulative wager limits | `test_wager_cap_applies_to_cumulative_position` |
| Zero-winning-position outcomes | `test_zero_winning_positions_become_a_full_refund_void` |
| Outstanding obligations covered | `test_liabilities_are_fully_covered_through_payout_and_refund_flows` |

---

## 8. Request 7 — Deliverables: commit, tests, Studionet references

### 8.1 Commit

```text
a8eb02aa9b7e837860d646a8721d46b3349c84cb
fix: secure withdrawals, fee accounting, settlement lifecycle, and wager caps
```

Pushed to:

```text
https://github.com/rizqhika29/kitty-market
branch: main
```

### 8.2 Static checks

```text
genvm-lint check contracts/kitty_market.py
  ✓ Lint passed (3 checks)
  ✓ Validation passed
  Contract: KittyMarket
  Methods: 19 (11 view, 8 write)

genvm-lint typecheck contracts/kitty_market.py
  ✓ No type errors found

npm run typecheck
  PASS

npm run build
  PASS
```

### 8.3 Studionet deployment

```text
Contract : 0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7
Deploy tx: 0x6de070a09761273ee801804157f56a2e1e4086e6414ba090bec9f96878e89de1
Explorer : https://explorer-studio.genlayer.com/contracts/0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7
```

### 8.4 Reproducible on-chain flow

Script: `scripts/verify-fixes.js`  
Recorded output: `scripts/studionet-verification.json`

Latest run:

```text
Failures: 0
Final accounting:
{"contract_balance":"0","liability":"0","fee_balance":"0","surplus":"0","solvent":true}
```

| Step | Transaction | Status |
|---|---|---|
| Create payout market | `0x5bb4dc6ab876b758c26ad09215e85347bcc7b4d55cf43ff7bf0ab65d2d210577` | Finalized |
| Stake 3 GEN YES | `0x567c2a1220f3dbe84b33ef90d6c1a0170998a9dc29b8145117e69d15536f618c` | Finalized |
| Stake 1 GEN NO | `0xab260623f8f6f358f46b8248cde23dd4d5da4c2541e75b5fe2355c766d7cb175` | Finalized |
| Premature settle rejected | `0x81087bcf57f5e3401db821e31dc3da29d5a1319093131e329d90d8251b0dfaba` | Error (expected) |
| AI settlement → YES | `0x84c5509d7da6ecb21d3b095ff4aecca9c5f6f646361d67967c14c7235ea3bdec` | Finalized |
| Winning payout claimed | `0xc60dc2c1b53fd9ea6b87275f4749a94a418e73a1f9a4130408afad427588a3fa` | Finalized |
| Double claim rejected | `0x380f8167735e80e672787e4f9c86061ae7408f056bdb25b9f056292274ed3e16` | Error (expected) |
| Non-owner fee collection rejected | `0x4c3fe0ab3132a7ca325d2c7c45921cea4dd7c3a513027a8944353c1dac7aaa13` | Error (expected) |
| Owner collects fee | `0xaec75df121037ad84d3b3161f56ba7e1d0ea374f877aec85d800c4060207c917` | Finalized |
| Create zero-winner market | `0x398f17d30e2e677cf7811af365966dfd771837f041511eddf804995a34827eb4` | Finalized |
| Void bettor stakes 2 GEN YES | `0xb57cc26739c5e68328eace0cf9ed262e6b05e4e8632405f320bb5daa7b648bad` | Finalized |
| AI settlement → zero-winner void | `0x65f44970d821f73a8d1d9d016da46b44f3e5d635df0fcf406b8895d75fc2c4db` | Finalized |
| Void refund reclaimed | `0x2d73ff5bfc87943a0244a8ec3a9b3ce33110d0f95e3bd5a1871699ea9cc5d64b` | Finalized |
| Double reclaim rejected | `0x9f9ebcb00460dc5dd2ad06f6ec8d40f049169eb2da9f5fb2bfb24e88dbb59c67` | Error (expected) |

The on-chain run demonstrated:

- market creation,
- staking on both sides,
- rejection of premature settlement,
- AI consensus resolution,
- successful pro-rata payout,
- exactly-once fee collection,
- zero-winner resolution as void,
- full refund of the void stake,
- rejection of double claims and double refunds,
- solvency at the end of the flow.

The terminal-void path after five failed attempts is additionally covered by
the Direct Mode tests (`tests/test_terminal_void.py` and
`tests/test_lifecycle_safety.py`).

---

## 9. Request 8 — Frontend uses the corrected contract

### Contract address

`src/lib/session.tsx`:

```ts
const CONTRACT_ADDRESS = "0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7";
```

### UI changes

- `cash_out` was removed from the session API and the portfolio page.
- The portfolio now explains that payouts/refunds are released per market.
- The market detail page only shows **Trigger AI Settlement** after the market
  close time, matching the contract deadline rule.
- Void markets continue to use `reclaim_stake`.
- Resolved markets use `claim_payout`.
- Owner fee collection remains available only to the owner.

### Verification

```text
npm run typecheck  -> PASS
npm run build      -> PASS
```

The README also points to the corrected address, deployment, tests, and
transaction references.

---

## 10. Accounting invariants

### New `liability` field

`liability` tracks the total GEN still owed to participants:

- refunds for open positions in void/terminal-void markets,
- unpaid winning payouts in resolved markets.

It changes as follows:

| Operation | Liability change |
|---|---|
| `take_side(amount)` | `+ amount` |
| `settle_market()` with fee | `- fee` (fee becomes owner revenue) |
| `claim_payout()` | `- share` |
| `reclaim_stake()` | `- position.size` |
| void/zero-winner settlement | no change (all stakes remain refundable) |
| `collect_fees()` | no change (fee vault decreases, not participant liability) |

### Invariant

At every point after a completed operation:

```text
contract_balance >= liability + fee_balance
```

`get_accounting()` exposes the live check:

```json
{
  "contract_balance": "...",
  "liability": "...",
  "fee_balance": "...",
  "surplus": "...",
  "solvent": true
}
```

### Note on integer rounding

Payout shares use integer floor division. Any rounding residue remains inside
`liability` and stays in the contract; it is never counted as a fee and never
allows the owner to withdraw participant reserves. This is conservative: the
contract may retain dust, but it can never owe more than it holds.

---

## 11. Contract API changes

### Removed

```python
cash_out(amount)
```

### Added / changed views

```python
get_liability()
get_accounting()
```

`get_market()` now additionally returns:

```json
{
  "fee_accrued": "...",
  "payout_pool": "...",
  "winning_pool": "..."
}
```

### Unchanged participant-facing methods

```python
join(alias)
open_market(question, topic, source_url, closes_at, min_wager, max_wager)
take_side(market_id, side)
settle_market(market_id)
terminal_void(market_id)
claim_payout(market_id)
reclaim_stake(market_id)
collect_fees(amount)
```

---

## 12. Reproduction

### Direct Mode tests

```bash
pip install -r requirements.txt
python -m pytest tests/ -v
```

Expected:

```text
17 passed
```

### Contract lint

```bash
pip install genvm-linter
genvm-lint check contracts/kitty_market.py
genvm-lint typecheck contracts/kitty_market.py
```

### Frontend

```bash
npm install
npm run typecheck
npm run build
```

### Studionet proof

```bash
node scripts/deploy.js         # deploy a fresh instance, update config
node scripts/verify-fixes.js   # exercise the full corrected flow
```

The second command writes `scripts/studionet-verification.json` with all
transaction hashes and statuses.

---

## 13. Summary

All eight Steward requests have been addressed:

- unauthorized balance-based withdrawal removed,
- fee accrued exactly once per market,
- participant reserves protected from fee withdrawals,
- close time enforced before settlement,
- attempt counting and terminal void correctly gated,
- zero-winner outcomes safely refunded,
- wager caps applied to cumulative exposure,
- expanded tests proving the fixes and accounting invariants,
- corrected contract deployed and referenced by the frontend,
- reproducible commit, test results, and Studionet transaction references
  provided.

**Implementation commit:** `a8eb02aa9b7e837860d646a8721d46b3349c84cb`  
**Corrected contract:** `0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7`
