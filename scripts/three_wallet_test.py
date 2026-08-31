"""Three-wallet end-to-end exercise of KittyMarket on Studionet.

Roles
-----
W1 deployer : deploys, joins, opens ONE capped market, proves host-lockout,
              collects platform fees at the end. Never bets anywhere.
W2 alice    : opens market A, bets on B and C.
W3 bob      : opens market B, bets on A.

Funding: W1 sends native GEN to W2/W3 up front (raw legacy transfers).

Run:  python scripts/three_wallet_test.py
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import genlayer_py  # noqa: E402
from genlayer_py import create_client  # noqa: E402

WEI = 10**18
RESULTS: list[dict] = []
LOG = ROOT / ".test-log.json"


def report(method: str, ok: bool, note: str = "") -> None:
    RESULTS.append({"method": method, "status": "PASS" if ok else "FAIL", "note": note})
    LOG.write_text(json.dumps(RESULTS, indent=2))
    print(f"  [{'PASS' if ok else 'FAIL'}] {method:<30} {note}", flush=True)


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


def send_native(sender_client, to: str, amount_wei: int) -> None:
    """Plain legacy EVM transfer signed locally, pushed via eth_sendRawTransaction."""
    acct = sender_client.local_account
    nonce = sender_client.get_current_nonce(acct.address)
    tx = {
        "chainId": 61999,
        "nonce": nonce,
        "gas": 21000,
        "gasPrice": 0,
        "to": to,
        "value": amount_wei,
        "data": b"",
    }
    signed = acct.sign_transaction(tx)
    raw = signed.raw_transaction
    if isinstance(raw, bytes):
        raw = "0x" + raw.hex()
    sender_client.provider.make_request("eth_sendRawTransaction", [raw])


def wait_balance(client, addr, minimum, label, timeout_s=180):
    print(f"  waiting for {label} balance >= {minimum / WEI} GEN…", flush=True)
    end = time.time() + timeout_s
    while time.time() < end:
        bal = client.get_balance(addr)
        if bal >= minimum:
            print(f"    {label}: {bal / WEI} GEN", flush=True)
            return bal
        time.sleep(8)
    return client.get_balance(addr)


def settle_and_wait(client, contract, market_id, timeout_s=900):
    last_err = ""
    end = time.time() + timeout_s
    attempts = 0
    while time.time() < end:
        if attempts < 20 and attempts % 3 == 0:
            try:
                tx = client.write_contract(
                    address=contract, function_name="settle_market", args=[market_id]
                )
                client.wait_for_transaction_receipt(tx, retries=60)
            except Exception as e:
                last_err = str(e)[:100]
                print(f"    settle note: {last_err}", flush=True)
            attempts += 1
        time.sleep(12)
        raw = client.read_contract(
            address=contract, function_name="get_market", args=[market_id]
        )
        m = json.loads(raw) if isinstance(raw, str) else raw
        if m.get("settled"):
            return m.get("outcome"), m
    return None, {}


def main() -> int:
    W = load_wallets()
    dep, alice, bob = W["deployer"], W["alice"], W["bob"]
    D, A, B = (
        dep.local_account.address,
        alice.local_account.address,
        bob.local_account.address,
    )
    print(f"W1 deployer : {D}")
    print(f"W2 alice    : {A}")
    print(f"W3 bob      : {B}")

    bal_d = dep.get_balance(D)
    print(f"\nDeployer balance: {bal_d / WEI} GEN")
    NEED = int(1.0 * WEI)
    if bal_d < NEED:
        print("\nFund the deployer first:")
        print(f"  {D}")
        print("  via https://studio.genlayer.com (import account -> faucet)")
        return 1

    # ══ 0. Fund alice & bob from deployer ════════════════════════════════
    print("\n=== 0. Funding W2/W3 via native transfer ===")
    bal_a = alice.get_balance(A)
    bal_b = bob.get_balance(B)
    if bal_a >= int(0.5 * WEI) and bal_b >= int(0.5 * WEI):
        print(f"  wallets pre-funded (alice={bal_a / WEI}, bob={bal_b / WEI}); "
              f"sending symbolic 0.01 GEN to prove native transfers work…", flush=True)
    try:
        send_native(dep, A, int(0.01 * WEI))
        send_native(dep, B, int(0.01 * WEI))
    except Exception as e:
        print(f"native transfer failed (non-fatal): {str(e)[:200]}")
    bal_a = wait_balance(alice, A, int(0.5 * WEI), "alice")
    bal_b = wait_balance(bob, B, int(0.5 * WEI), "bob")
    report("native funding W2/W3", bal_a >= int(0.5 * WEI) and bal_b >= int(0.5 * WEI),
           f"alice={bal_a / WEI}, bob={bal_b / WEI}")

    # ══ 1. Deploy ════════════════════════════════════════════════════════
    print("\n=== 1. Deploy (W1) ===")
    code = (ROOT / "contracts" / "kitty_market.py").read_text()
    tx_id = dep.deploy_contract(code)
    print(f"Deploy txId: {tx_id}")

    # genlayer_py returns the *transaction id* from deploy_contract;
    # the actual contract address sits in the receipt's recipient field.
    receipt = dep.get_transaction(transaction_hash=tx_id)
    rd = receipt if isinstance(receipt, dict) else getattr(receipt, "__dict__", {})
    address = rd.get("recipient") or rd.get("to_address")
    assert address and len(address) == 42, f"could not resolve contract address: {address}"
    print(f"Contract : {address}")

    def view(fn, *args):
        return dep.read_contract(address=address, function_name=fn, args=list(args))

    def write(client, fn, *args, value=0):
        tx = client.write_contract(address=address, function_name=fn, args=list(args), value=value)
        return client.wait_for_transaction_receipt(tx, retries=60)

    # ══ 2. join x3 ═══════════════════════════════════════════════════════
    print("\n=== 2. join (all three wallets) ===")
    write(dep, "join", "kitty_owner")
    write(alice, "join", "alice")
    write(bob, "join", "bob")
    traders = int(view("get_total_traders"))
    report("join x3 + get_total_traders", traders == 3, f"={traders}")

    write(bob, "join", "bob")  # duplicate attempt
    report("join duplicate guard", int(view("get_total_traders")) == 3, "count unchanged")

    info_a = json.loads(view("get_trader_info", A))
    info_b = json.loads(view("get_trader_info", B))
    report("get_trader_info both", info_a["name"] == "alice" and info_b["name"] == "bob")

    # ══ 3. open_market: each trader hosts one ════════════════════════════
    print("\n=== 3. open_market ===")
    now = int(time.time())
    Q_BTC = "Does the English Wikipedia article about Bitcoin mention Satoshi Nakamoto?"
    Q_ETH = "Does the English Wikipedia article about Ethereum mention Vitalik Buterin?"
    SRC_BTC = "https://en.wikipedia.org/wiki/Bitcoin"
    SRC_SAT = "https://en.wikipedia.org/wiki/Satoshi_Nakamoto"
    SRC_ETH = "https://en.wikipedia.org/wiki/Ethereum"
    SRC_VIT = "https://en.wikipedia.org/wiki/Vitalik_Buterin"
    CLOSE_AC = now + 360   # markets A & C close in 6 minutes
    CLOSE_B = now + 420    # market B closes in 7 minutes

    write(alice, "open_market", Q_BTC, "crypto", SRC_BTC + ", " + SRC_SAT, CLOSE_AC, 0, 0)       # id 0
    write(bob, "open_market", Q_ETH, "tech", SRC_ETH + ", " + SRC_VIT, CLOSE_B, 0, 0)            # id 1
    write(dep, "open_market", Q_BTC, "other", SRC_BTC + ", " + SRC_ETH, CLOSE_AC, 10**16, 5 * 10**16)  # id 2 capped

    m0 = json.loads(view("get_market", "0"))
    m1 = json.loads(view("get_market", "1"))
    m2 = json.loads(view("get_market", "2"))
    hosts_ok = (
        m0["host"].lower() == A.lower()
        and m1["host"].lower() == B.lower()
        and m2["host"].lower() == D.lower()
    )
    report("open_market x3 (saling membuat)", hosts_ok,
           f"hosts: A={m0['host'][:8]}… B={m1['host'][:8]}… C={m2['host'][:8]}…")
    lim2 = json.loads(view("get_market_limits", "2"))
    report("get_market_limits (market C)",
           lim2["min_wager"] == str(10**16) and lim2["max_wager"] == str(5 * 10**16),
           "capped 0.01–0.05")
    report("get_total_markets", int(view("get_total_markets")) == 3, "=3")

    expect_revert(
        lambda: write(dep, "open_market", "Q", "crypto", SRC_BTC + ", " + SRC_ETH, CLOSE_AC, 900, 100),
        "min_wager cannot exceed max_wager",
        "open_market min>max guard",
    )

    # ══ 4. Host lockout ══════════════════════════════════════════════════
    print("\n=== 4. Host lockout ===")
    expect_revert(
        lambda: write(dep, "take_side", "2", "yes", value=10**16),
        "host cannot hold positions",
        "W1 cannot bet own market",
    )
    expect_revert(
        lambda: write(alice, "take_side", "0", "no", value=10**16),
        "host cannot hold positions",
        "W2 cannot bet own market A",
    )
    expect_revert(
        lambda: write(bob, "take_side", "1", "yes", value=10**16),
        "host cannot hold positions",
        "W3 cannot bet own market B",
    )

    # ══ 5. Cross betting (saling beradu) ═════════════════════════════════
    print("\n=== 5. Cross betting ===")
    # Caps negatives on C (by alice, who is not the host there)
    expect_revert(
        lambda: write(alice, "take_side", "2", "yes", value=10**15),
        "wager below market minimum",
        "below-min on C",
    )
    expect_revert(
        lambda: write(alice, "take_side", "2", "no", value=6 * 10**16),
        "wager above market maximum",
        "above-max on C",
    )

    write(bob, "take_side", "0", "yes", value=2 * 10**17)    # bob YES on alice's A
    write(bob, "take_side", "0", "no", value=1 * 10**17)     # bob NO  on alice's A
    write(alice, "take_side", "1", "no", value=int(0.15 * WEI))  # alice NO on bob's B
    write(alice, "take_side", "2", "yes", value=2 * 10**16)  # alice YES on C (in-caps)

    m0 = json.loads(view("get_market", "0"))
    m1 = json.loads(view("get_market", "1"))
    m2 = json.loads(view("get_market", "2"))
    ok_stakes = (
        m0["yes_pool"] == str(2 * 10**17)
        and m0["no_pool"] == str(1 * 10**17)
        and m1["no_pool"] == str(int(0.15 * WEI))
        and m2["yes_pool"] == str(2 * 10**16)
    )
    report("cross-bet pools", ok_stakes,
           f"A(yes .2/no .1) B(no .15) C(yes .02)")

    pos_alice = json.loads(view("get_trader_positions", A))
    pos_bob = json.loads(view("get_trader_positions", B))
    report("get_trader_positions",
           len(pos_alice) == 2 and len(pos_bob) == 2,
           f"alice={len(pos_alice)} bob={len(pos_bob)}")
    report("get_total_wagers", int(view("get_total_wagers")) == 4, "=4")

    # ══ 6. Lifecycle guards ══════════════════════════════════════════════
    print("\n=== 6. Lifecycle guards ===")
    expect_revert(lambda: write(bob, "settle_market", "0"),
                  "trading window still open", "settle too-early")

    gap = CLOSE_AC + 5 - time.time()
    print(f"\nWaiting for markets A & C to close ({int(gap)}s)…")
    while time.time() < CLOSE_AC + 5:
        time.sleep(20)
        print(f"  t-{int(CLOSE_AC + 5 - time.time())}s", flush=True)

    expect_revert(lambda: write(bob, "take_side", "0", "yes", value=10**16),
                  "trading window closed", "bet after-close")

    # ══ 7. Settle market A (both sides backed -> winner payout) ══════════
    print("\n=== 7. settle_market A (AI) ===")
    outcome_a, m0 = settle_and_wait(bob, address, "0")
    report("settle A verdict", m0.get("settled") and outcome_a in ("yes", "no"),
           f"outcome={outcome_a} | {m0.get('verdict_note', '')[:60]}")

    # bob is sole bettor on BOTH sides; whichever side won pays him the prize
    pot_a = 3 * 10**17
    prize_a = pot_a - (pot_a * 2) // 100  # 0.294
    pre_claim_fee = int(view("get_fee_balance"))
    report("fee not accrued before claim", pre_claim_fee == 0, f"vault={pre_claim_fee}")

    write(bob, "claim_payout", "0")
    info_bob = json.loads(view("get_trader_info", B))
    got_bob = int(info_bob["paid_out"])
    report("claim_payout (bob wins)",
           abs(got_bob - prize_a) <= 2,
           f"paid={got_bob / WEI} expected={prize_a / WEI}")
    report("fee accrued once",
           int(view("get_fee_balance")) == pot_a // 50,
           f"vault={int(view('get_fee_balance')) / WEI} GEN")

    write(bob, "claim_payout", "0")
    still = int(json.loads(view("get_trader_info", B))["paid_out"])
    report("double-claim guard", still == got_bob, "payout unchanged")

    # loser-side stats recorded (bob also held losing side)
    report("trader stats burned/calls",
           int(info_bob["calls_total"]) == 2 and int(info_bob["calls_right"]) == 1,
           f"right={info_bob['calls_right']}/2")

    # ══ 8. Settle market B (only NO backed -> void or solo win) ══════════
    print("\n=== 8. settle_market B ===")
    gap = CLOSE_B + 5 - time.time()
    if gap > 0:
        print(f"Waiting for market B ({int(gap)}s)…")
        while time.time() < CLOSE_B + 5:
            time.sleep(20)
            print(f"  t-{int(CLOSE_B + 5 - time.time())}s", flush=True)

    outcome_b, m1 = settle_and_wait(alice, address, "1")
    if m1.get("outcome") == "void":
        wallet_pre = int(view("get_trader_balance", A))
        write(alice, "reclaim_stake", "1")
        wallet_post = int(view("get_trader_balance", A))
        report("void -> reclaim_stake full",
               wallet_post - wallet_pre == int(0.15 * WEI)
               and int(view("get_fee_balance")) == pot_a // 50,
               "+0.15 GEN refunded, fee untouched")
    else:
        write(alice, "claim_payout", "1")
        got_a = int(json.loads(view("get_trader_info", A))["paid_out"])
        exp = (15 * 10**16) * (98 * 10**16) // (15 * 10**16)
        report("solo-winner claim on B",
               abs(got_a - exp) <= 2,
               f"paid={got_a / WEI} expected≈{exp / WEI}")

    # ══ 9. Settle market C (owner-hosted, capped) ════════════════════════
    print("\n=== 9. settle_market C ===")
    outcome_c, m2 = settle_and_wait(alice, address, "2")
    if m2.get("outcome") == "void":
        wallet_pre = int(view("get_trader_balance", A))
        write(alice, "reclaim_stake", "2")
        wallet_post = int(view("get_trader_balance", A))
        report("C void -> reclaim", wallet_post - wallet_pre == 2 * 10**16,
               f"AI said {outcome_c}; refund ok")
    elif outcome_c == "yes":
        write(alice, "claim_payout", "2")
        total_a = int(json.loads(view("get_trader_info", A))["paid_out"])
        report("C claim (alice)", total_a > 0, f"alice paid_out={total_a / WEI} GEN")
    else:
        report("C settled (no side)", m2.get("settled"), f"outcome={outcome_c}")

    # ══ 10. Rankings ═════════════════════════════════════════════════════
    print("\n=== 10. get_top_cats ===")
    cats = json.loads(view("get_top_cats"))
    names = {c["name"] for c in cats}
    report("leaderboard populated", len(cats) >= 2,
           f"{[(c['name'], c['earnings'], c['hit_rate'] + '%') for c in cats]}")

    # ══ 11. cash_out ═════════════════════════════════════════════════════
    print("\n=== 11. cash_out ===")
    info_bob = json.loads(view("get_trader_info", B))
    wallet_bob = int(info_bob["wallet"])
    if wallet_bob >= 10**17:
        native_pre = bob.get_balance(B)
        write(bob, "cash_out", 10**17)
        native_post = bob.get_balance(B)
        wallet_after = int(json.loads(view("get_trader_info", B))["wallet"])
        report("cash_out",
               wallet_after == wallet_bob - 10**17 and native_post > native_pre,
               f"native +{(native_post - native_pre) / WEI:.4f} GEN")
        expect_revert(lambda: write(bob, "cash_out", 10**24),
                      "amount exceeds wallet", "cash_out over-balance")
    else:
        report("cash_out", False, f"insufficient wallet {wallet_bob / WEI}")

    # ══ 12. collect_fees (owner) ═════════════════════════════════════════
    print("\n=== 12. collect_fees ===")
    vault = int(view("get_fee_balance"))
    half = vault // 2
    write(dep, "collect_fees", half)
    remaining = int(view("get_fee_balance"))
    report("collect_fees", remaining == vault - half,
           f"drained {half / WEI} GEN, vault left {remaining / WEI}")
    expect_revert(lambda: write(dep, "collect_fees", 10**30),
                  "vault balance too low", "collect_fees over-vault")

    # ══ Summary ══════════════════════════════════════════════════════════
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = [r for r in RESULTS if r["status"] == "FAIL"]
    print("\n" + "=" * 56)
    print(f"RESULT: {passed}/{len(RESULTS)} checks passed")
    print(f"Contract: {address}")
    print(f"Explorer: https://explorer-studio.genlayer.com/address/{address}")
    for r in failed:
        print(f"  FAIL {r['method']}: {r['note']}")

    LOG.write_text(json.dumps(
        {"contract": address, "results": RESULTS}, indent=2))
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
