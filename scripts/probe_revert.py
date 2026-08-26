"""Probe: how does a reverted intelligent-contract call surface in receipts?"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
import genlayer_py  # noqa: E402
from genlayer_py import create_account, create_client  # noqa: E402

key = json.loads((ROOT / ".deploy-key.json").read_text())["alice"]["private_key"]
acct = create_account(key)
client = create_client(chain=genlayer_py.studionet, account=acct)

CONTRACT = "0xc3686fB2995A25D9ee81B0322f4f46789b3482B0"
A = acct.address

print("TransactionStatus values:", [s for s in dir(genlayer_py.types.TransactionStatus) if not s.startswith("_")])

# alice is host of market 0 -> take_side must revert on-chain
tx = client.write_contract(
    address=CONTRACT, function_name="take_side", args=["0", "yes"], value=10**16
)
print("submitted:", tx)

for status_name in ("ACCEPTED", "FINALIZED"):
    try:
        st = genlayer_py.types.TransactionStatus[status_name]
        r = client.wait_for_transaction_receipt(tx, status=st, retries=40)
        d = r if isinstance(r, dict) else getattr(r, "__dict__", {})
        print(f"\n--- receipt @ {status_name} ---")
        for k in ("status", "result", "error", "eq_outputs", "output", "ret"):
            if k in d:
                v = d[k]
                print(f"{k:12} {str(v)[:200]}")
    except Exception as e:
        print(f"{status_name}: {str(e)[:200]}")

# Full dump of finalized tx
full = client.get_transaction(transaction_hash=tx)
fd = full if isinstance(full, dict) else getattr(full, "__dict__", {})
print("\n--- full tx fields ---")
for k, v in fd.items():
    s = json.dumps(v) if isinstance(v, (dict, list)) else str(v)
    if s and s != "None":
        print(f"{k:30} {s[:160]}")
