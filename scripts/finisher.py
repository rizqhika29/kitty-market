"""Finisher: remaining checks on contract 0x13C2…ccF (already settled).

Covers: claim_payout fee-once, double-claim guard, collect_fees over-vault
and partial drain, cash_out async delivery + over-balance guard.
Retries transient 502s from the shared RPC.
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import genlayer_py  # noqa: E402
from genlayer_py import create_client  # noqa: E402
from genlayer_py.exceptions import GenLayerError  # noqa: E402

WEI = 10**18
CONTRACT = "0x13C2bc0722780691D498A58391057eA70b37ccfF"
RESULTS = []


def report(method, ok, note=""):
    RESULTS.append((method, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {method:<34} {note}", flush=True)


def resilient(fn, tries=4):
    last = None
    for i in range(tries):
        try:
            return fn()
        except GenLayerError as e:
            msg = str(e)
            if "502" in msg or "invalid JSON" in msg or "Bad gateway" in msg:
                last = e
                time.sleep(6 * (i + 1))
                continue
            raise
    raise last


def main() -> int:
    raw = json.loads((ROOT / ".deploy-key.json").read_text())

    def cl(role):
        w = raw[role]
        pk = w["private_key"]
        return create_client(chain=genlayer_py.studionet,
                             account=genlayer_py.create_account(
                                 pk if pk.startswith("0x") else "0x" + pk))

    dep, bob = cl("deployer"), cl("bob")
    B = bob.local_account.address
    C = CONTRACT

    def view(fn, *args):
        return resilient(lambda: dep.read_contract(address=C, function_name=fn, args=list(args)))

    def write(client, fn, *args, value=0):
        def go():
            tx = client.write_contract(address=C, function_name=fn,
                                       args=list(args), value=value)
            return client.wait_for_transaction_receipt(tx, retries=60)
        return resilient(go)

    m = json.loads(view("get_market", "0"))
    assert m["settled"] and m["outcome"] == "yes", f"unexpected state: {m['outcome']}"

    # 1. claim_payout — sole winner bob (0.02 YES), prize = 0.0196, fee 4e14
    write(bob, "claim_payout", "0")
    info = json.loads(view("get_trader_info", B))
    wallet1 = int(info["wallet"])
    fee1 = int(view("get_fee_balance"))
    report("claim_payout winner", wallet1 == int(0.02 * WEI) - 2 * 10**16 // 50,
           f"wallet={wallet1 / WEI} GEN")
    report("fee accrued once", fee1 == 2 * 10**16 * 2 // 100,
           f"vault={fee1} wei")

    # 2. double-claim guard
    write(bob, "claim_payout", "0")
    wallet2 = int(json.loads(view("get_trader_info", B))["wallet"])
    report("double-claim blocked", wallet2 == wallet1, "wallet unchanged")

    # 3. collect_fees over-vault
    write(dep, "collect_fees", 10**24)
    fee2 = int(view("get_fee_balance"))
    report("collect_fees over-vault blocked", fee2 == fee1, f"vault still {fee2}")

    # 4. valid partial drain
    drain = fee1 // 2
    write(dep, "collect_fees", drain)
    report("collect_fees partial", int(view("get_fee_balance")) == fee1 - drain,
           f"drained {drain / WEI} GEN")

    # 5. cash_out with async delivery
    if wallet2 >= 10**16:
        native_pre = resilient(lambda: bob.get_balance(B))
        write(bob, "cash_out", 10**16)
        delivered = False
        for _ in range(20):
            time.sleep(5)
            if resilient(lambda: bob.get_balance(B)) > native_pre:
                delivered = True
                break
        w_now = int(json.loads(view("get_trader_info", B))["wallet"])
        report("cash_out delivers asynchronously",
               delivered and w_now == wallet2 - 10**16,
               f"+{(resilient(lambda: bob.get_balance(B)) - native_pre) / WEI:.4f} native")

        # 6. over-balance guard
        write(bob, "cash_out", 10**24)
        w_final = int(json.loads(view("get_trader_info", B))["wallet"])
        report("cash_out over-balance blocked", w_final == wallet2 - 10**16,
               "wallet unchanged")

    print("\nFINISHER:", sum(1 for _, ok, _ in RESULTS if ok), "/", len(RESULTS), "passed")
    for mth, ok, n in RESULTS:
        if not ok:
            print(f"  FAIL {mth}: {n}")
    return 0 if all(ok for _, ok, _ in RESULTS) else 2


if __name__ == "__main__":
    sys.exit(main())
