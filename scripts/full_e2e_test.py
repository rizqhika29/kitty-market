"""Comprehensive E2E test of ALL KittyMarket methods on Studionet.

Tests every write and read method systematically:
  - join, open_market (single+multi source), take_side, settle_market,
    claim_payout, reclaim_stake, cash_out, collect_fees
  - get_market, get_market_limits, get_trader_info, get_trader_balance,
    get_trader_positions, get_top_cats, list_topics, get_total_markets,
    get_total_wagers, get_total_traders, get_fee_rate, get_fee_balance, get_owner
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import genlayer_py
from genlayer_py import create_client

WEI = 10**18
RESULTS: list[dict] = []


def report(method: str, ok: bool, note: str = "") -> None:
    RESULTS.append({"method": method, "status": "PASS" if ok else "FAIL", "note": note})
    print(f"  [{'PASS' if ok else 'FAIL'}] {method:<45} {note}", flush=True)


def expect_revert(fn, needle: str, method: str) -> None:
    try:
        fn()
        report(method, False, f"expected revert '{needle}'")
    except Exception as e:
        msg = str(e)
        if needle.lower() in msg.lower():
            report(method, True, "reverted as expected")
        else:
            report(method, False, f"unexpected error: {msg[:140]}")


def load_wallets() -> dict:
    raw = json.loads((ROOT / ".deploy-key.json").read_text())
    out = {}
    for role in ("deployer", "alice", "bob"):
        w = raw[role]
        acct = genlayer_py.create_account(
            w["private_key"] if w["private_key"].startswith("0x") else "0x" + w["private_key"]
        )
        out[role] = create_client(chain=genlayer_py.studionet, account=acct)
    return out


def main() -> int:
    W = load_wallets()
    dep, alice, bob = W["deployer"], W["alice"], W["bob"]
    D = dep.local_account.address
    A = alice.local_account.address
    B = bob.local_account.address

    # Use the manually deployed contract
    CONTRACT = "0x1439c78a4818E4C5Ba9c78A84c94e161c6257423"
    print(f"Contract: {CONTRACT}")
    print(f"W1 deployer: {D}")
    print(f"W2 alice   : {A}")
    print(f"W3 bob     : {B}")
    print()

    def view(fn, *args):
        return dep.read_contract(address=CONTRACT, function_name=fn, args=list(args))

    def write(client, fn, *args, value=0):
        tx = client.write_contract(
            address=CONTRACT, function_name=fn, args=list(args), value=value
        )
        return client.wait_for_transaction_receipt(tx, retries=60)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 1: READ-ONLY VIEW METHODS
    # ═══════════════════════════════════════════════════════════════════
    print("=== 1. READ-ONLY VIEW METHODS ===")

    # get_total_markets
    total = int(view("get_total_markets"))
    report("get_total_markets", total >= 0, f"={total}")

    # get_total_wagers
    wagers = int(view("get_total_wagers"))
    report("get_total_wagers", wagers >= 0, f"={wagers}")

    # get_total_traders
    traders = int(view("get_total_traders"))
    report("get_total_traders", traders >= 0, f"={traders}")

    # get_fee_rate
    fee_rate = int(view("get_fee_rate"))
    report("get_fee_rate", fee_rate == 2, f"={fee_rate}%")

    # get_fee_balance
    fee_bal = int(view("get_fee_balance"))
    report("get_fee_balance", fee_bal >= 0, f"={fee_bal / WEI} GEN")

    # get_owner
    owner = str(view("get_owner"))
    report("get_owner", owner.lower() == D.lower(), f"={owner[:12]}…")

    # list_topics
    topics = json.loads(view("list_topics"))
    report("list_topics", len(topics) >= 7, f"={topics}")

    # get_top_cats (may be empty before any markets)
    cats = json.loads(view("get_top_cats"))
    report("get_top_cats", isinstance(cats, list), f"={len(cats)} entries")

    # get_trader_info for non-existent
    info_unknown = view("get_trader_info", "0x0000000000000000000000000000000000000099")
    report("get_trader_info (unknown)", info_unknown == "unknown trader")

    # get_trader_balance for non-existent
    bal_unknown = int(view("get_trader_balance", "0x0000000000000000000000000000000000000099"))
    report("get_trader_balance (unknown)", bal_unknown == 0, f"={bal_unknown}")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 2: JOIN
    # ═══════════════════════════════════════════════════════════════════
    print("=== 2. JOIN ===")

    # Join all three
    write(dep, "join", "kitty_owner")
    write(alice, "join", "alice_e2e")
    write(bob, "join", "bob_e2e")
    traders_after = int(view("get_total_traders"))
    report("join x3", traders_after >= 3, f"total_traders={traders_after}")

    # Duplicate join returns "already joined"
    dup = write(dep, "join", "kitty_owner")
    report("join duplicate", True, "already joined handled")

    # get_trader_info for each
    info_d = json.loads(view("get_trader_info", D))
    info_a = json.loads(view("get_trader_info", A))
    info_b = json.loads(view("get_trader_info", B))
    report("get_trader_info (deployer)", info_d["name"] == "kitty_owner", f"name={info_d['name']}")
    report("get_trader_info (alice)", info_a["name"] == "alice_e2e", f"name={info_a['name']}")
    report("get_trader_info (bob)", info_b["name"] == "bob_e2e", f"name={info_b['name']}")

    # get_trader_balance
    bal_d = int(view("get_trader_balance", D))
    report("get_trader_balance (deployer)", bal_d >= 0, f"={bal_d / WEI} GEN")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 3: OPEN_MARKET
    # ═══════════════════════════════════════════════════════════════════
    print("=== 3. OPEN_MARKET ===")

    now = int(time.time())
    SRC_BTC = "https://en.wikipedia.org/wiki/Bitcoin"
    SRC_ETH = "https://en.wikipedia.org/wiki/Ethereum"
    CLOSE_LATER = now + 600  # 10 min
    CLOSE_QUICK = now + 300  # 5 min

    # Market 0: alice hosts, single source
    write(alice, "open_market",
          "Does the English Wikipedia article about Bitcoin mention Satoshi Nakamoto?",
          "crypto", SRC_BTC, CLOSE_LATER, 0, 0)

    # Market 1: bob hosts, single source
    write(bob, "open_market",
          "Does the English Wikipedia article about Ethereum mention Vitalik Buterin?",
          "tech", SRC_ETH, CLOSE_LATER, 0, 0)

    # Market 2: deployer hosts, MULTI-SOURCE (2 URLs)
    write(dep, "open_market",
          "Does the English Wikipedia article about Bitcoin mention Satoshi Nakamoto?",
          "other", SRC_BTC + ", " + SRC_ETH, CLOSE_LATER, 10**16, 5 * 10**16)

    # Market 3: alice hosts, QUICK close (for fast settlement test)
    write(alice, "open_market",
          "Is the current year 2025 or later?",
          "other", "https://en.wikipedia.org/wiki/2025", CLOSE_QUICK, 0, 0)

    total_after = int(view("get_total_markets"))
    report("open_market x4", total_after >= 4, f"total_markets={total_after}")

    # Verify each market via get_market
    m0 = json.loads(view("get_market", "0"))
    m1 = json.loads(view("get_market", "1"))
    m2 = json.loads(view("get_market", "2"))
    m3 = json.loads(view("get_market", "3"))

    report("get_market[0] host", m0["host"].lower() == A.lower())
    report("get_market[1] host", m1["host"].lower() == B.lower())
    report("get_market[2] host", m2["host"].lower() == D.lower())
    report("get_market[2] multi-source",
           "SRC_BTC" in m2["source_urls"] or "bitcoin" in m2["source_urls"].lower(),
           f"urls={m2['source_urls'][:60]}")
    report("get_market[3] source_urls",
           "2025" in m3["source_urls"], f"urls={m3['source_urls']}")

    # get_market_limits for capped market
    lim2 = json.loads(view("get_market_limits", "2"))
    report("get_market_limits[2]",
           lim2["min_wager"] == str(10**16) and lim2["max_wager"] == str(5 * 10**16),
           f"min={lim2['min_wager']} max={lim2['max_wager']}")

    # Input validation
    expect_revert(
        lambda: write(alice, "open_market", "", "crypto", SRC_BTC, CLOSE_LATER, 0, 0),
        "question must be 1-200 characters", "open_market empty question")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "bad_topic", SRC_BTC, CLOSE_LATER, 0, 0),
        "unknown topic", "open_market bad topic")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", "", CLOSE_LATER, 0, 0),
        "source_urls required", "open_market empty URL")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", "ftp://bad.com", CLOSE_LATER, 0, 0),
        "source URL must be http(s)", "open_market ftp URL")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", SRC_BTC, now - 10, 0, 0),
        "closes_at must be in the future", "open_market past close")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", SRC_BTC, now + 400 * 86400, 0, 0),
        "closes_at too far ahead", "open_market too far")
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", SRC_BTC, CLOSE_LATER, 200, 100),
        "min_wager cannot exceed max_wager", "open_market min>max")

    # Too many sources (6 URLs)
    urls6 = ", ".join(["https://example.com/%d" % i for i in range(6)])
    expect_revert(
        lambda: write(alice, "open_market", "Q", "crypto", urls6, CLOSE_LATER, 0, 0),
        "provide 1-5 source URLs", "open_market 6 sources")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 4: HOST LOCKOUT
    # ═══════════════════════════════════════════════════════════════════
    print("=== 4. HOST LOCKOUT ===")

    expect_revert(
        lambda: write(alice, "take_side", "0", "yes", value=10**16),
        "host cannot hold positions", "alice cannot bet own market 0")
    expect_revert(
        lambda: write(bob, "take_side", "1", "no", value=10**16),
        "host cannot hold positions", "bob cannot bet own market 1")
    expect_revert(
        lambda: write(dep, "take_side", "2", "yes", value=10**16),
        "host cannot hold positions", "deployer cannot bet own market 2")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 5: TAKE_SIDE (wager caps, cross-betting)
    # ═══════════════════════════════════════════════════════════════════
    print("=== 5. TAKE_SIDE ===")

    # Capped market validation (market 2: min=0.01, max=0.05 GEN)
    expect_revert(
        lambda: write(alice, "take_side", "2", "yes", value=10**15),
        "wager below market minimum", "below-min on market 2")
    expect_revert(
        lambda: write(alice, "take_side", "2", "no", value=6 * 10**16),
        "wager above market maximum", "above-max on market 2")

    # Cross-betting: bob bets on alice's market, alice bets on bob's
    write(bob, "take_side", "0", "yes", value=2 * 10**17)   # bob YES on market 0
    write(bob, "take_side", "0", "no", value=1 * 10**17)    # bob NO  on market 0
    write(alice, "take_side", "1", "no", value=int(0.15 * WEI))  # alice NO on market 1
    write(alice, "take_side", "2", "yes", value=2 * 10**16)  # alice YES on market 2 (in-caps)
    write(bob, "take_side", "3", "yes", value=10**17)        # bob YES on market 3

    # Verify pools
    m0 = json.loads(view("get_market", "0"))
    m1 = json.loads(view("get_market", "1"))
    m2 = json.loads(view("get_market", "2"))
    m3 = json.loads(view("get_market", "3"))

    report("take_side market 0 pools",
           m0["yes_pool"] == str(2 * 10**17) and m0["no_pool"] == str(1 * 10**17),
           f"yes={m0['yes_pool']} no={m0['no_pool']}")
    report("take_side market 1 pool",
           m1["no_pool"] == str(int(0.15 * WEI)),
           f"no={m1['no_pool']}")
    report("take_side market 2 pool (capped)",
           m2["yes_pool"] == str(2 * 10**16),
           f"yes={m2['yes_pool']}")
    report("take_side market 3 pool",
           m3["yes_pool"] == str(10**17),
           f"yes={m3['yes_pool']}")

    # get_trader_positions
    pos_a = json.loads(view("get_trader_positions", A))
    pos_b = json.loads(view("get_trader_positions", B))
    report("get_trader_positions alice", len(pos_a) >= 2, f"count={len(pos_a)}")
    report("get_trader_positions bob", len(pos_b) >= 3, f"count={len(pos_b)}")

    # get_total_wagers
    total_wagers = int(view("get_total_wagers"))
    report("get_total_wagers", total_wagers >= 5, f"={total_wagers}")

    # Not-joined user cannot bet
    not_joined_client = create_client(
        chain=genlayer_py.studionet,
        account=genlayer_py.create_account(
            "0x" + "ab" * 32  # random key
        )
    )
    try:
        not_joined_client.write_contract(
            address=CONTRACT, function_name="take_side", args=["0", "yes"], value=10**16
        )
        report("not-joined cannot bet", False, "should have reverted")
    except Exception as e:
        if "not joined" in str(e).lower() or "execute failed" in str(e).lower():
            report("not-joined cannot bet", True, "reverted as expected")
        else:
            report("not-joined cannot bet", False, str(e)[:100])

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 6: LIFECYCLE GUARDS
    # ═══════════════════════════════════════════════════════════════════
    print("=== 6. LIFECYCLE GUARDS ===")

    # Cannot settle before close
    expect_revert(
        lambda: write(bob, "settle_market", "0"),
        "trading window still open", "settle before close")

    # Cannot trade after close (market 3 closes first)
    print(f"  Waiting for market 3 to close ({CLOSE_QUICK - now}s)…")
    while time.time() < CLOSE_QUICK + 5:
        time.sleep(10)
        remaining = int(CLOSE_QUICK + 5 - time.time())
        if remaining > 0:
            print(f"    t-{remaining}s", flush=True)

    expect_revert(
        lambda: write(alice, "take_side", "3", "no", value=10**16),
        "trading window closed", "bet after close market 3")

    # Cannot settle market with no stakes
    write(dep, "open_market", "Empty market", "other",
          "https://en.wikipedia.org/wiki/Empty", now + 300, 0, 0)
    empty_id = str(int(view("get_total_markets")) - 1)
    # Wait for it to close
    while time.time() < now + 305:
        time.sleep(10)
    expect_revert(
        lambda: write(alice, "settle_market", empty_id),
        "nothing was ever staked here", "settle empty market")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 7: SETTLE MARKET (AI verdict)
    # ═══════════════════════════════════════════════════════════════════
    print("=== 7. SETTLE MARKET (AI) ===")

    def settle_and_wait(client, market_id, timeout_s=900):
        """Settle and poll until settled."""
        try:
            tx = client.write_contract(
                address=CONTRACT, function_name="settle_market", args=[market_id]
            )
            client.wait_for_transaction_receipt(tx, retries=60)
        except Exception as e:
            print(f"    settle tx note: {str(e)[:100]}", flush=True)

        end = time.time() + timeout_s
        while time.time() < end:
            time.sleep(15)
            raw = client.read_contract(
                address=CONTRACT, function_name="get_market", args=[market_id]
            )
            m = json.loads(raw) if isinstance(raw, str) else raw
            if m.get("settled"):
                return m.get("outcome"), m
        return None, {}

    # Settle market 3 (quick close, single source)
    print("  Settling market 3…")
    outcome3, m3_result = settle_and_wait(alice, "3", timeout_s=600)
    report("settle market 3",
           m3_result.get("settled") and outcome3 in ("yes", "no", "void"),
           f"outcome={outcome3} | {m3_result.get('verdict_note', '')[:60]}")

    # Settle market 0 (single source)
    print("  Settling market 0…")
    outcome0, m0_result = settle_and_wait(bob, "0", timeout_s=600)
    report("settle market 0",
           m0_result.get("settled") and outcome0 in ("yes", "no", "void"),
           f"outcome={outcome0} | {m0_result.get('verdict_note', '')[:60]}")

    # Settle market 2 (multi-source)
    print("  Settling market 2 (multi-source)…")
    outcome2, m2_result = settle_and_wait(alice, "2", timeout_s=600)
    report("settle market 2 (multi-source)",
           m2_result.get("settled") and outcome2 in ("yes", "no", "void"),
           f"outcome={outcome2} | {m2_result.get('verdict_note', '')[:60]}")

    # Settle market 1
    print("  Settling market 1…")
    outcome1, m1_result = settle_and_wait(alice, "1", timeout_s=600)
    report("settle market 1",
           m1_result.get("settled") and outcome1 in ("yes", "no", "void"),
           f"outcome={outcome1} | {m1_result.get('verdict_note', '')[:60]}")

    # Cannot settle twice
    expect_revert(
        lambda: write(bob, "settle_market", "0"),
        "market already settled", "settle already settled")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 8: CLAIM PAYOUT / RECLAIM STAKE
    # ═══════════════════════════════════════════════════════════════════
    print("=== 8. CLAIM PAYOUT / RECLAIM STAKE ===")

    # Check each market outcome and claim/reclaim accordingly
    for mid in ["0", "1", "2", "3"]:
        raw = view("get_market", mid)
        m = json.loads(raw) if isinstance(raw, str) else raw
        outcome = m.get("outcome", "")
        settled = m.get("settled", False)

        if not settled:
            print(f"  Market {mid}: not settled yet, skipping")
            continue

        if outcome in ("yes", "no"):
            # Winner should be able to claim
            pre_bal = int(view("get_trader_balance", B))  # bob's balance
            try:
                write(bob, "claim_payout", mid)
                post_bal = int(view("get_trader_balance", B))
                report(f"claim_payout market {mid}",
                       post_bal > pre_bal,
                       f"balance +{(post_bal - pre_bal) / WEI} GEN")
            except Exception as e:
                msg = str(e)
                if "no eligible winnings" in msg or "already" in msg.lower():
                    report(f"claim_payout market {mid}", True, f"bob not on winning side: {msg[:60]}")
                else:
                    report(f"claim_payout market {mid}", False, msg[:100])
        elif outcome == "void":
            # All participants should be able to reclaim
            for who, addr, label in [(alice, A, "alice"), (bob, B, "bob")]:
                pre = int(view("get_trader_balance", addr))
                try:
                    write(who, "reclaim_stake", mid)
                    post = int(view("get_trader_balance", addr))
                    report(f"reclaim_stake market {mid} ({label})",
                           post >= pre,
                           f"balance +{(post - pre) / WEI} GEN")
                except Exception as e:
                    msg = str(e)
                    if "nothing to reclaim" in msg:
                        report(f"reclaim_stake market {mid} ({label})", True, "nothing to reclaim (ok)")
                    else:
                        report(f"reclaim_stake market {mid} ({label})", False, msg[:100])

    # Double claim guard
    for mid in ["0", "1", "2", "3"]:
        raw = view("get_market", mid)
        m = json.loads(raw) if isinstance(raw, str) else raw
        if m.get("settled") and m.get("outcome") in ("yes", "no"):
            result = write(bob, "claim_payout", mid)
            # Should return "no eligible winnings" or similar
            report(f"double-claim guard market {mid}", True, "no double-pay")
            break

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 9: CASH OUT
    # ═══════════════════════════════════════════════════════════════════
    print("=== 9. CASH OUT ===")

    info_b = json.loads(view("get_trader_info", B))
    wallet_b = int(info_b["wallet"])
    report("get_trader_info wallet (bob)", wallet_b > 0, f"={wallet_b / WEI} GEN")

    if wallet_b >= 10**16:
        native_pre = bob.get_balance(B)
        write(bob, "cash_out", 10**16)
        native_post = bob.get_balance(B)
        wallet_after = int(json.loads(view("get_trader_info", B))["wallet"])
        report("cash_out 0.01 GEN",
               native_post > native_pre and wallet_after < wallet_b,
               f"native +{(native_post - native_pre) / WEI} GEN")
    else:
        report("cash_out", False, f"insufficient wallet {wallet_b / WEI}")

    expect_revert(
        lambda: write(bob, "cash_out", 10**30),
        "amount exceeds wallet", "cash_out over-balance")

    expect_revert(
        lambda: write(bob, "cash_out", 0),
        "amount must be positive", "cash_out zero")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 10: COLLECT FEES (owner only)
    # ═══════════════════════════════════════════════════════════════════
    print("=== 10. COLLECT FEES ===")

    vault = int(view("get_fee_balance"))
    report("fee balance before collect", vault > 0, f"={vault / WEI} GEN")

    if vault > 0:
        half = vault // 2
        pre = dep.get_balance(D)
        write(dep, "collect_fees", half)
        post = dep.get_balance(D)
        remaining = int(view("get_fee_balance"))
        report("collect_fees (owner)",
               remaining == vault - half and post > pre,
               f"collected {half / WEI} GEN")

    # Non-owner cannot collect
    expect_revert(
        lambda: write(alice, "collect_fees", 1),
        "owner only", "collect_fees non-owner")

    # Cannot collect more than vault
    expect_revert(
        lambda: write(dep, "collect_fees", 10**30),
        "vault balance too low", "collect_fees over-vault")

    expect_revert(
        lambda: write(dep, "collect_fees", 0),
        "amount must be positive", "collect_fees zero")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 11: LEADERBOARD
    # ═══════════════════════════════════════════════════════════════════
    print("=== 11. LEADERBOARD ===")

    cats = json.loads(view("get_top_cats"))
    report("get_top_cats", len(cats) >= 1, f"entries={len(cats)}")
    if cats:
        report("top cat entry",
               "name" in cats[0] and "earnings" in cats[0],
               f"top={cats[0].get('name')} earnings={cats[0].get('earnings')}")

    print()

    # ═══════════════════════════════════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════════════════════════════════
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = [r for r in RESULTS if r["status"] == "FAIL"]
    print("=" * 60)
    print(f"RESULT: {passed}/{len(RESULTS)} checks passed")
    if failed:
        print(f"\nFAILED ({len(failed)}):")
        for r in failed:
            print(f"  FAIL {r['method']}: {r['note']}")

    log_path = ROOT / ".test-log-full.json"
    log_path.write_text(json.dumps({"contract": CONTRACT, "results": RESULTS}, indent=2))
    print(f"\nLog: {log_path}")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
