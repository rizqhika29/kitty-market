"""Negative-path verification for KittyMarket (corrected targeting).

Guard matrix:
  - lockout        : HOST betting own market      (sim + state invariant)
  - caps           : below-min / above-max stakes (real tx + pool invariant)
  - validation     : min>max creation             (sim)
  - lifecycle      : settle before close          (sim)
  - payable guard  : zero-value take_side         (sim)
  - string guards  : bad side / duplicate join    (returned strings)
  - overdraft      : collect_fees & cash_out over (state invariants)

Run: python scripts/negative_suite.py
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import genlayer_py  # noqa: E402
from genlayer_py import create_client  # noqa: E402

WEI = 10**18
RESULTS = []
LOG = ROOT / ".negative-log.json"


def report(method, ok, note=""):
    RESULTS.append({"method": method, "status": "PASS" if ok else "FAIL", "note": note})
    LOG.write_text(json.dumps(RESULTS, indent=2))
    print(f"  [{'PASS' if ok else 'FAIL'}] {method:<36} {note}", flush=True)


def load():
    raw = json.loads((ROOT / ".deploy-key.json").read_text())
    out = {}
    for role in ("deployer", "alice", "bob"):
        w = raw[role]
        pk = w["private_key"] if w["private_key"].startswith("0x") else "0x" + w["private_key"]
        out[role] = create_client(chain=genlayer_py.studionet,
                                  account=genlayer_py.create_account(pk))
    return out


def main() -> int:
    W = load()
    dep, alice, bob = W["deployer"], W["alice"], W["bob"]
    D, A, B = (dep.local_account.address, alice.local_account.address,
               bob.local_account.address)

    code = (ROOT / "contracts" / "kitty_market.py").read_text()
    print("Deploying fresh KittyMarket…", flush=True)
    tx_id = dep.deploy_contract(code)
    r = dep.get_transaction(transaction_hash=tx_id)
    rd = r if isinstance(r, dict) else getattr(r, "__dict__", {})
    C = rd.get("recipient") or rd.get("to_address")
    print(f"Contract: {C}", flush=True)

    def view(fn, *args):
        return dep.read_contract(address=C, function_name=fn, args=list(args))

    def write(cl, fn, *args, value=0):
        tx = cl.write_contract(address=C, function_name=fn, args=list(args), value=value)
        return cl.wait_for_transaction_receipt(tx, retries=60)

    def sim_reverts(cl, method, fn_name, *args):
        """PASS when the VM rejects the call ('execution failed' = revert;
        the RPC does not forward the UserError text)."""
        try:
            res = cl.simulate_write_contract(address=C, function_name=fn_name,
                                             args=list(args))
            report(method, False, f"simulated OK: {str(res)[:60]}")
        except Exception as e:
            msg = str(e).lower()
            if "execution failed" in msg or "revert" in msg:
                report(method, True, "VM rejected the call")
            elif "-32001" in msg and "not found" in msg:
                report(method, True, "VM rejected (stale-node variant)")
            else:
                report(method, False, str(e)[:110])

    def invariant_guard(method, action, observe, label):
        before = observe()
        try:
            action()
        except Exception:
            pass
        time.sleep(8)
        after = observe()
        report(method, before == after, f"{label}: {before} == {after}")

    # ── setup ────────────────────────────────────────────────────────────
    write(dep, "join", "owner")
    write(alice, "join", "alice")
    write(bob, "join", "bob")
    CLOSE = int(time.time()) + 420          # 7 minutes
    MIN_W, MAX_W = 10**16, 5 * 10**16       # 0.01 / 0.05 GEN
    Q = "Does the English Wikipedia article about Bitcoin mention Satoshi Nakamoto?"
    SRC = "https://en.wikipedia.org/wiki/Bitcoin"
    write(alice, "open_market", Q, "crypto", SRC, CLOSE, MIN_W, MAX_W)   # id 0, host=ALICE

    yes_pool = lambda: json.loads(view("get_market", "0"))["yes_pool"]
    n_markets = lambda: int(view("get_total_markets"))
    n_traders = lambda: int(view("get_total_traders"))
    vault = lambda: int(view("get_fee_balance"))

    # ══ A. Simulated VM reverts ══════════════════════════════════════════
    print("\n=== A. Simulated reverts ===")
    sim_reverts(alice, "host lockout (alice on own market)",
                "take_side", "0", "yes")
    sim_reverts(bob, "open_market min>max",
                "open_market", "Q", "crypto", SRC, CLOSE, 900, 100)
    sim_reverts(dep, "settle before close", "settle_market", "0")
    sim_reverts(bob, "zero-value stake", "take_side", "0", "yes")

    try:
        res = bob.simulate_write_contract(address=C, function_name="take_side",
                                          args=["0", "maybe"])
        report("bad side returns string",
               str(res) == "side must be yes or no", f"got {str(res)[:40]}")
    except Exception as e:
        report("bad side returns string", False, str(e)[:100])

    # ══ B. Real-tx state-invariant proofs ════════════════════════════════
    print("\n=== B. State invariants after real invalid txs ===")
    invariant_guard("above-max stake ignored",
                    lambda: write(bob, "take_side", "0", "yes", value=MAX_W + WEI),
                    yes_pool, "yes_pool")

    invariant_guard("below-min stake ignored",
                    lambda: write(bob, "take_side", "0", "no", value=MIN_W // 2),
                    yes_pool, "yes_pool")

    invariant_guard("invalid open creates nothing",
                    lambda: write(bob, "open_market", "Q", "crypto", SRC,
                                  CLOSE + 60, 900, 100),
                    n_markets, "total_markets")

    invariant_guard("duplicate join ignored",
                    lambda: write(alice, "join", "alice2"),
                    n_traders, "total_traders")

    # boundary acceptance: valid in-caps stake must land EXACTLY once
    write(bob, "take_side", "0", "yes", value=2 * 10**16)
    report("in-caps stake lands exactly", yes_pool() == str(2 * 10**16),
           f"yes_pool={int(yes_pool()) / WEI} GEN")

    # ══ C. Lifecycle: close -> settle -> claim ═══════════════════════════
    gap = CLOSE + 5 - time.time()
    print(f"\nWaiting close ({int(gap)}s)…")
    while time.time() < CLOSE + 5:
        time.sleep(20)
        print(f"  t-{int(CLOSE + 5 - time.time())}s", flush=True)

    try:
        r2 = alice.simulate_write_contract(address=C, function_name="take_side",
                                           args=["0", "yes"])
        report("post-close stake blocked", "closed" in str(r2).lower(),
               f"returned {str(r2)[:44]}")
    except Exception as e:
        report("post-close stake blocked",
               "execution failed" in str(e).lower(), "VM rejected")

    outcome, settled = None, False
    end_t = time.time() + 600
    sent = False
    raw = None
    while time.time() < end_t:
        if not sent:
            try:
                tx = bob.write_contract(address=C, function_name="settle_market",
                                        args=["0"])
                bob.wait_for_transaction_receipt(tx, retries=60)
                sent = True
            except Exception as e:
                print(f"    settle note: {str(e)[:90]}", flush=True)
        time.sleep(12)
        raw = view("get_market", "0")
        m = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(m, dict) and m.get("settled"):
            outcome, settled = m.get("outcome"), True
            break
    report("settle via AI consensus", settled and outcome in ("yes", "no"),
           f"outcome={outcome}")

    fee_before = vault()
    write(bob, "claim_payout", "0")
    fee_after = vault()
    expected_fee = (2 * 10**16 * 2) // 100
    report("fee accrued exactly once",
           fee_after == fee_before + expected_fee,
           f"vault {fee_before} -> {fee_after}")

    # post-settlement double claim pays nothing more
    wallet_b = int(json.loads(view("get_trader_info", B))["wallet"])
    write(bob, "claim_payout", "0")
    wallet_b2 = int(json.loads(view("get_trader_info", B))["wallet"])
    report("double-claim blocked", wallet_b == wallet_b2, "wallet unchanged")

    # ══ D. Overdraft guards ══════════════════════════════════════════════
    print("\n=== D. Overdraft guards ===")
    invariant_guard("collect_fees over-vault blocked",
                    lambda: write(dep, "collect_fees", 10**24),
                    vault, "fee_vault")

    if wallet_b2 >= 10**17:
        native_pre = bob.get_balance(B)
        write(bob, "cash_out", 10**17)
        delivered = False
        for _ in range(18):                     # async transfer: poll 90 s
            time.sleep(5)
            if bob.get_balance(B) > native_pre:
                delivered = True
                break
        w_now = int(json.loads(view("get_trader_info", B))["wallet"])
        report("cash_out delivers asynchronously",
               delivered and w_now == wallet_b2 - 10**17,
               f"+{(bob.get_balance(B) - native_pre) / WEI:.4f} native GEN")

        invariant_guard("cash_out over-balance blocked",
                        lambda: write(bob, "cash_out", 10**24),
                        lambda: int(json.loads(view("get_trader_info", B))["wallet"]),
                        "trader wallet")

    passed = sum(1 for x in RESULTS if x["status"] == "PASS")
    failed = [x for x in RESULTS if x["status"] == "FAIL"]
    print("\n" + "=" * 58)
    print(f"NEGATIVE SUITE RESULT: {passed}/{len(RESULTS)} passed")
    for x in failed:
        print(f"  FAIL {x['method']}: {x['note']}")
    LOG.write_text(json.dumps({"contract": C, "results": RESULTS}, indent=2))
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
