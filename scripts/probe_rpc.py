"""Probe RPC consistency: hit the same view repeatedly, count outcomes."""

import json
import time
from pathlib import Path

from genlayer_py import create_account, create_client
import genlayer_py
from genlayer_py.types import TransactionHashVariant

ROOT = Path(__file__).resolve().parent.parent
key = json.loads((ROOT / ".deploy-key.json").read_text())["deployer"]["private_key"]
acct = create_account(key)
client = create_client(chain=genlayer_py.studionet, account=acct)

TARGETS = {
    "first(0xDF5)": "0xDF53b6552f0fD6bd3B07384a1DAa68f4382EA83d",
    "second(0xc36)": "0xc3686fB2995A25D9ee81B0322f4f46789b3482B0",
}

for label, addr in TARGETS.items():
    for variant_name in ("latest-nonfinal", "latest"):
        ok, err = 0, 0
        vals = set()
        for i in range(8):
            try:
                v = client.read_contract(
                    address=addr,
                    function_name="get_total_markets",
                    args=[],
                    transaction_hash_variant=TransactionHashVariant(variant_name),
                )
                ok += 1
                vals.add(str(v))
            except Exception as e:
                err += 1
                last = str(e)[:70]
            time.sleep(1)
        print(f"{label} [{variant_name:15}] ok={ok} err={err} values={vals or '-'} "
              f"last_err={last if err else ''}")
