"""Quick Studionet smoke test for the corroboration-required contract."""
import json, time, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
import genlayer_py
from genlayer_py import create_client

WEI = 10**18

def make_client(role):
    raw = json.loads((ROOT / ".deploy-key.json").read_text())
    w = raw[role]
    acct = genlayer_py.create_account(
        w["private_key"] if w["private_key"].startswith("0x") else "0x" + w["private_key"]
    )
    return create_client(chain=genlayer_py.studionet, account=acct)

dep = make_client("deployer")
alice = make_client("alice")
bob = make_client("bob")
D, A, B = dep.local_account.address, alice.local_account.address, bob.local_account.address

CONTRACT = "0x81B8e53509366F378311D5905D6BA574Ea7F0D1b"
print(f"Contract: {CONTRACT}")

def view(fn, *args):
    return dep.read_contract(address=CONTRACT, function_name=fn, args=list(args))

def write(client, fn, *args, value=0):
    tx = client.write_contract(address=CONTRACT, function_name=fn, args=list(args), value=value)
    return client.wait_for_transaction_receipt(tx, retries=60)

passed = 0
total = 0

def check(name, ok, note=""):
    global passed, total
    total += 1
    if ok:
        passed += 1
        print(f"  [PASS] {name}  {note}")
    else:
        print(f"  [FAIL] {name}  {note}")

# 1. join
print("\n=== join ===")
write(dep, "join", "owner")
write(alice, "join", "alice")
write(bob, "join", "bob")
check("join x3", int(view("get_total_traders")) >= 3)

# 2. open_market with 2 sources
print("\n=== open_market (2 sources) ===")
now = int(time.time())
write(alice, "open_market",
      "Does Wikipedia Bitcoin mention Satoshi?",
      "crypto",
      "https://en.wikipedia.org/wiki/Bitcoin, https://en.wikipedia.org/wiki/Satoshi_Nakamoto",
      now + 300, 0, 0)
m0 = json.loads(view("get_market", "0"))
check("market created", m0["host"].lower() == A.lower())
check("source_urls stored", "Bitcoin" in m0["source_urls"] and "Satoshi" in m0["source_urls"])

# 3. single source rejected
print("\n=== single source rejected ===")
try:
    write(bob, "open_market", "Q", "tech", "https://en.wikipedia.org/wiki/Ethereum", now + 300, 0, 0)
    check("single source rejected", False, "should have reverted")
except Exception as e:
    check("single source rejected", "corroboration" in str(e).lower() or "2-5" in str(e), str(e)[:80])

# 4. same domain rejected
print("\n=== same domain rejected ===")
try:
    write(bob, "open_market", "Q", "tech", "https://a.com/x, https://a.com/y", now + 300, 0, 0)
    check("same domain rejected", False, "should have reverted")
except Exception as e:
    check("same domain rejected", "distinct domains" in str(e).lower(), str(e)[:80])

# 5. www vs non-www same domain rejected
print("\n=== www vs non-www rejected ===")
try:
    write(bob, "open_market", "Q", "tech",
          "https://www.coingecko.com/x, https://coingecko.com/y",
          now + 300, 0, 0)
    check("www/non-www rejected", False, "should have reverted")
except Exception as e:
    check("www/non-www rejected", "distinct domains" in str(e).lower(), str(e)[:80])

# 6. cross-bet and settle
print("\n=== cross-bet + settle ===")
write(bob, "take_side", "0", "yes", value=int(0.1 * WEI))
write(alice, "take_side", "0", "no", value=int(0.1 * WEI))  # alice is host, should fail
# Actually alice IS host, so let's use bob only
# Let me create another market for settlement test
write(dep, "open_market",
      "Does Wikipedia Ethereum mention Vitalik?",
      "tech",
      "https://en.wikipedia.org/wiki/Ethereum, https://en.wikipedia.org/wiki/Vitalik_Buterin",
      now + 300, 0, 0)
write(alice, "take_side", "1", "yes", value=int(0.1 * WEI))
write(bob, "take_side", "1", "no", value=int(0.1 * WEI))

# Wait for close
print("  Waiting for market to close...")
while time.time() < now + 310:
    time.sleep(10)

# Settle
print("  Settling...")
try:
    tx = alice.write_contract(address=CONTRACT, function_name="settle_market", args=["1"])
    alice.wait_for_transaction_receipt(tx, retries=60)
except Exception as e:
    print(f"  settle tx: {str(e)[:100]}")

# Poll for settlement
for _ in range(30):
    time.sleep(15)
    m1 = json.loads(view("get_market", "1"))
    if m1.get("settled"):
        break

check("market settled", m1.get("settled"), f"outcome={m1.get('outcome')}")
check("verdict_note present", len(m1.get("verdict_note", "")) > 0, m1.get("verdict_note", "")[:60])

print(f"\n{'='*40}")
print(f"RESULT: {passed}/{total} passed")
print(f"Contract: {CONTRACT}")
