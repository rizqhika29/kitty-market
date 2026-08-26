"""Deploy KittyMarket to GenLayer Studionet and exercise every method.

Prerequisites:
  - .deploy-key.json with {"address": "...", "private_key": "0x.."}
    (or DEPLOYER_KEY env var)
  - The deployer address must hold GEN

Run:
  python scripts/deploy_and_test.py
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import genlayer_py  # noqa: E402
from genlayer_py import create_account, create_client  # noqa: E402

RPC = "https://studio.genlayer.com/api"
WEI = 10**18

RESULTS: list[dict] = []
STATE_FILE = ROOT / ".deploy-state.json"


def save_state() -> None:
    STATE_FILE.write_text(
        json.dumps({"results": RESULTS}, indent=2), encoding="utf-8"
    )


def report(method: str, ok: bool, note: str = "") -> None:
    RESULTS.append({"method": method, "status": "PASS" if ok else "FAIL", "note": note})
    save_state()
    mark = "[PASS]" if ok else "[FAIL]"
    print(f"  {mark} {method:<28} {note}", flush=True)


def load_key() -> str:
    key = os.environ.get("DEPLOYER_KEY")
    if not key:
        f = ROOT / ".deploy-key.json"
        if f.exists():
            key = json.loads(f.read_text())["private_key"]
    if not key:
        raise SystemExit("No deployer key found")
    return key if key.startswith("0x") else "0x" + key


def expect_revert(fn, needle: str, method: str) -> None:
    try:
        fn()
        report(method, False, f"expected revert '{needle}' but succeeded")
    except Exception as e:
        msg = str(e)
        if needle.lower() in msg.lower():
            report(method, True, f"reverted as expected")
        else:
            report(method, False, f"unexpected error: {msg[:150]}")


def main() -> int:
    key = load_key()
    acct = create_account(key)
    print(f"Deployer: {acct.address}")

    client = create_client(chain=genlayer_py.studionet, account=acct)

    bal = client.get_balance(acct.address)
    print(f"Balance : {bal / WEI} GEN")
    if bal < WEI // 10:
        print("\nInsufficient GEN. Fund this address:")
        print(f"  {acct.address}")
        print("via https://studio.genlayer.com (import account -> faucet)")
        return 1

    # ── Deploy ───────────────────────────────────────────────────────────
    code = (ROOT / "contracts" / "kitty_market.py").read_text()
    print("\nDeploying KittyMarket...")
    address = client.deploy_contract(code)
    print(f"Contract: {address}")
    STATE_FILE.write_text(
        json.dumps({"contract": address, "deployer": acct.address}, indent=2),
        encoding="utf-8",
    )

    def view(fn, *args):
        raw = client.read_contract(address=address, function_name=fn, args=list(args))
        return raw

    def write(fn, *args, value=0):
        tx = client.write_contract(
            address=address, function_name=fn, args=list(args), value=value
        )
        return client.wait_for_transaction_receipt(tx, retries=60)

    # ══ 1. Initial views ══════════════════════════════════════════════════
    print("\n=== 1. Initial views ===")
    try:
        ok = (
            int(view("get_total_markets")) == 0
            and int(view("get_total_wagers")) == 0
            and int(view("get_total_traders")) == 0
        )
        report("get_total_* (fresh state)", ok, "all counters zero")
    except Exception as e:
        report("get_total_* (fresh state)", False, str(e)[:130])

    try:
        topics = json.loads(view("list_topics"))
        report("list_topics", len(topics) == 7, f"{topics}")
    except Exception as e:
        report("list_topics", False, str(e)[:130])

    report("get_fee_rate", int(view("get_fee_rate")) == 2, "2% levy")
    report("get_fee_balance", int(view("get_fee_balance")) == 0, "empty vault")

    owner_ok = view("get_owner").lower() == acct.address.lower()
    report("get_owner", owner_ok, f"owner={view('get_owner')[:14]}…")

    report(
        "get_trader_info (unknown)",
        view("get_trader_info", acct.address) == "unknown trader",
    )
    report(
        "get_trader_balance (zero)",
        int(view("get_trader_balance", acct.address)) == 0,
    )
    report(
        "get_trader_positions (empty)",
        json.loads(view("get_trader_positions", acct.address)) == [],
    )
    report("get_top_cats (empty)", json.loads(view("get_top_cats")) == [])

    # ══ 2. join ═══════════════════════════════════════════════════════════
    print("\n=== 2. join ===")
    write("join", "kitty_owner")
    info = json.loads(view("get_trader_info", acct.address))
    report("join + get_trader_info", info["name"] == "kitty_owner", f"alias={info['name']}")

    alice = create_account("0x" + "ab" * 32)  # market host (unfunded)
    bob = create_account("0x" + "cd" * 32)    # bystander (unfunded)
    write("join", "alice_host")
    write("join", "bob")
    traders = int(view("get_total_traders"))
    report("join (x3 accounts)", traders == 3, f"total_traders={traders}")

    write("join", "kitty_owner")  # duplicate join attempt
    still = int(view("get_total_traders"))
    report("join duplicate guard", still == 3, f"still {still} traders")

    # ══ 3. open_market ════════════════════════════════════════════════════
    print("\n=== 3. open_market ===")
    QUESTION = (
        "Does the English Wikipedia article about Bitcoin mention Satoshi Nakamoto?"
    )
    SOURCE = "https://en.wikipedia.org/wiki/Bitcoin"
    now = int(time.time())
    CLOSE1 = now + 420   # market 1 closes in 7 minutes
    CLOSE2 = now + 480   # market 2 closes in 8 minutes

    write("open_market", QUESTION, "crypto", SOURCE, CLOSE1, 0, 0)
    m1 = json.loads(view("get_market", "0"))
    report(
        "open_market #1 (uncapped)",
        m1["question"] == QUESTION and m1["host"].lower() == acct.address.lower(),
        f"id=0 phase={m1['phase']}",
    )

    lim1 = json.loads(view("get_market_limits", "0"))
    report(
        "get_market_limits #1",
        lim1["min_wager"] == "0" and lim1["max_wager"] == "0",
        "uncapped",
    )

    MIN_W, MAX_W = 10**15, 5 * 10**17  # 0.001 / 0.5 GEN
    write("open_market", QUESTION, "tech", SOURCE, CLOSE2, MIN_W, MAX_W)
    lim2 = json.loads(view("get_market_limits", "1"))
    report(
        "open_market #2 (capped)",
        lim2["min_wager"] == str(MIN_W) and lim2["max_wager"] == str(MAX_W),
        "min 0.001 / max 0.5",
    )
    markets = int(view("get_total_markets"))
    report("get_total_markets", markets == 2, f"={markets}")

    expect_revert(
        lambda: write("open_market", "Q", "crypto", SOURCE, CLOSE1, 500, 100),
        "min_wager cannot exceed max_wager",
        "open_market min>max guard",
    )

    # ══ 4. Host lockout ═══════════════════════════════════════════════════
    print("\n=== 4. Host lockout (negative) ===")
    expect_revert(
        lambda: write("take_side", "0", "yes", value=10**17),
        "host cannot hold positions",
        "take_side host-lockout",
    )

    # ══ 5. take_side ══════════════════════════════════════════════════════
    print("\n=== 5. take_side ===")
    write("take_side", "0", "yes", value=3 * 10**17)  # 0.3 GEN on YES
    write("take_side", "0", "no", value=2 * 10**17)   # 0.2 GEN on NO
    m1 = json.loads(view("get_market", "0"))
    report(
        "take_side pools update",
        m1["yes_pool"] == str(3 * 10**17) and m1["no_pool"] == str(2 * 10**17),
        f"pot={int(m1['pool']) / WEI} GEN",
    )
    wagers = int(view("get_total_wagers"))
    report("get_total_wagers", wagers == 2, f"={wagers}")

    pos = json.loads(view("get_trader_positions", acct.address))
    report(
        "get_trader_positions",
        len(pos) == 2 and {p["side"] for p in pos} == {"yes", "no"},
        f"{len(pos)} open positions",
    )

    # ══ 6. Wager caps ═════════════════════════════════════════════════════
    print("\n=== 6. Wager caps ===")
    expect_revert(
        lambda: write("take_side", "1", "yes", value=MIN_W // 2),
        "wager below market minimum",
        "take_side below-min",
    )
    expect_revert(
        lambda: write("take_side", "1", "no", value=MAX_W + 10**17),
        "wager above market maximum",
        "take_side above-max",
    )
    write("take_side", "1", "no", value=10**17)  # 0.1 GEN within caps
    m2 = json.loads(view("get_market", "1"))
    report("take_side within caps", m2["no_pool"] == str(10**17), "0.1 GEN accepted")

    # ══ 7. Lifecycle guards ═══════════════════════════════════════════════
    print("\n=== 7. Lifecycle guards ===")
    expect_revert(
        lambda: write("settle_market", "0"),
        "trading window still open",
        "settle_market too-early",
    )

    print(f"\nWaiting for market #1 close ({int(CLOSE1 - time.time())}s left)...")
    while time.time() < CLOSE1 + 5:
        time.sleep(20)
        print(f"  t-{int(CLOSE1 + 5 - time.time())}s", flush=True)

    expect_revert(
        lambda: write("take_side", "0", "yes", value=10**16),
        "trading window closed",
        "take_side after-close",
    )

    # ══ 8. settle_market (real AI consensus) ══════════════════════════════
    print("\n=== 8. settle_market (AI validators) ===")

    def settle_and_wait(market_id: str, timeout_s: int = 900):
        """Trigger settlement, retrying periodically, until resolved."""
        last_err = ""
        deadline_ts = time.time() + timeout_s
        sent = False
        while time.time() < deadline_ts:
            if not sent:
                try:
                    tx = client.write_contract(
                        address=address,
                        function_name="settle_market",
                        args=[market_id],
                    )
                    client.wait_for_transaction_receipt(tx, retries=60)
                    sent = True
                except Exception as e:
                    last_err = str(e)[:110]
                    print(f"    settle retry note: {last_err}", flush=True)
            time.sleep(12)
            raw = view("get_market", market_id)
            market = json.loads(raw) if isinstance(raw, str) else raw
            if market.get("settled"):
                return market.get("outcome"), market
        return None, {}

    outcome, m1 = settle_and_wait("0")
    report(
        "settle_market #1 (AI verdict)",
        outcome == "yes" and m1.get("outcome") == "yes",
        f"outcome={outcome} | note: {m1.get('verdict_note', '')[:70]}",
    )

    # ══ 9. claim_payout ═══════════════════════════════════════════════════
    print("\n=== 9. claim_payout ===")
    # pot 0.5 GEN, levy 2% => prize 0.49; winning pool (yes) = 0.3
    # expected payout = 0.3 * 0.49 / 0.3 = 0.49 GEN exactly
    write("claim_payout", "0")
    info = json.loads(view("get_trader_info", acct.address))
    got = int(info["paid_out"])
    expected = (3 * 10**17) * (49 * 10**16) // (3 * 10**17)
    report(
        "claim_payout winner math",
        abs(got - expected) <= 2,
        f"paid_out={got / WEI} GEN (expected {expected / WEI})",
    )

    fee = int(view("get_fee_balance"))
    report("get_fee_balance after claim", fee == 10**16, f"levy={fee / WEI} GEN")

    write("claim_payout", "0")  # everything already claimed
    info2 = json.loads(view("get_trader_info", acct.address))
    report(
        "claim double-payout guard",
        int(info2["paid_out"]) == got,
        "payout unchanged on re-claim",
    )
    report(
        "claim spam cannot mint fees",
        int(view("get_fee_balance")) == fee,
        "vault stable",
    )

    # ══ 10. Void path (market #2: only NO was backed) ═════════════════════
    print("\n=== 10. Void path (market #2) ===")
    gap = CLOSE2 + 5 - time.time()
    if gap > 0:
        print(f"Waiting for market #2 close ({int(gap)}s)...")
        while time.time() < CLOSE2 + 5:
            time.sleep(20)
            print(f"  t-{int(CLOSE2 + 5 - time.time())}s", flush=True)

    outcome2, m2 = settle_and_wait("1")
    report(
        "settle_market #2 -> void",
        m2.get("settled") and m2.get("outcome") == "void",
        f"AI said {outcome2}; nobody backed it",
    )

    vault_before = int(view("get_fee_balance"))
    wallet_before = int(view("get_trader_balance", acct.address))
    write("reclaim_stake", "1")
    wallet_after = int(view("get_trader_balance", acct.address))
    report(
        "reclaim_stake full refund",
        wallet_after - wallet_before == 10**17
        and int(view("get_fee_balance")) == vault_before,
        f"+0.1 GEN back, fee untouched",
    )

    # ══ 11. Rankings & cash_out ═══════════════════════════════════════════
    print("\n=== 11. Rankings & cash out ===")
    cats = json.loads(view("get_top_cats"))
    me = next((c for c in cats if c["name"] == "kitty_owner"), None)
    report(
        "get_top_cats",
        me is not None,
        f"earnings={me.get('earnings')} hit_rate={me.get('hit_rate')}%" if me else "missing",
    )

    native_before = client.get_balance(acct.address)
    write("cash_out", 5 * 10**16)
    info3 = json.loads(view("get_trader_info", acct.address))
    native_after = client.get_balance(acct.address)
    report(
        "cash_out",
        int(info3["wallet"]) == wallet_after - 5 * 10**16
        and native_after > native_before,
        f"+{(native_after - native_before) / WEI:.4f} native GEN",
    )
    expect_revert(
        lambda: write("cash_out", 10**24),
        "amount exceeds wallet",
        "cash_out over-balance",
    )

    # ══ 12. collect_fees (owner-only) ═════════════════════════════════════
    print("\n=== 12. collect_fees ===")
    write("collect_fees", 5 * 10**15)
    remaining = int(view("get_fee_balance"))
    report("collect_fees", remaining == 5 * 10**15, f"vault drained to {remaining / WEI} GEN")
    expect_revert(
        lambda: write("collect_fees", 10**24),
        "vault balance too low",
        "collect_fees over-vault",
    )

    # ══ Summary ═══════════════════════════════════════════════════════════
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = [r for r in RESULTS if r["status"] == "FAIL"]
    print(f"\n{'=' * 50}")
    print(f"RESULT: {passed}/{len(RESULTS)} checks passed")
    print(f"Contract: {address}")
    print(f"Explorer: https://explorer-studio.genlayer.com/address/{address}")
    for r in failed:
        print(f"  FAIL {r['method']}: {r['note']}")

    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
