"""Generate the three test wallets (deployer, alice, bob)."""

import json
import pathlib

from genlayer_py import create_account

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYFILE = ROOT / ".deploy-key.json"

old_raw = json.loads(KEYFILE.read_text()) if KEYFILE.exists() else {}
# Support both the legacy flat format {address, private_key} and the
# nested per-role format used now.
if "deployer" not in old_raw and old_raw.get("private_key"):
    old = {"deployer": old_raw}
else:
    old = old_raw

w1 = create_account(old.get("deployer", {}).get("private_key"))
w2 = old.get("alice", {}).get("private_key")
w2 = create_account(w2) if w2 else create_account()
w3 = old.get("bob", {}).get("private_key")
w3 = create_account(w3) if w3 else create_account()

state = {
    "deployer": {"address": w1.address, "private_key": w1.key.hex()},
    "alice": {"address": w2.address, "private_key": w2.key.hex()},
    "bob": {"address": w3.address, "private_key": w3.key.hex()},
}
KEYFILE.write_text(json.dumps(state, indent=2))

for role, w in state.items():
    print(f"{role:9}: {w['address']}")
