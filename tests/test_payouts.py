import json
import pytest
from datetime import datetime, timezone


def _to_hex(addr):
    if isinstance(addr, bytes):
        return "0x" + addr.hex()
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return str(addr)


def _p(raw):
    return json.loads(raw) if isinstance(raw, str) else raw


def test_claim_payout_and_collect_fees(direct_vm, direct_deploy, direct_accounts):
    host = direct_accounts[0]
    alice = direct_accounts[1]
    bob = direct_accounts[2]

    c = direct_deploy("contracts/kitty_market.py", _to_hex(host))

    direct_vm.sender = host
    c.join("h")
    direct_vm.sender = alice
    c.join("a")
    direct_vm.sender = bob
    c.join("b")

    now = int(datetime.now(timezone.utc).timestamp())
    direct_vm.sender = host
    c.open_market("Sky blue?", "science", "https://evidence.invalid", now + 86400, 0, 0)

    direct_vm.sender = alice
    direct_vm.value = 3 * 10**18
    c.take_side(0, "yes")
    direct_vm.sender = bob
    direct_vm.value = 7 * 10**18
    c.take_side(0, "no")
    direct_vm.value = 0

    direct_vm.mock_web(r".*", {"status": 200, "body": "the sky is blue"})
    direct_vm.mock_llm(r".*", json.dumps({"outcome": "yes", "reasoning": "clear"}))

    direct_vm.sender = host
    print("SETTLE:", c.settle_market(0))
    m = _p(c.get_market(0))
    print("MARKET:", json.dumps(m, indent=2))
    assert m["settled"] is True and m["outcome"] == "yes", m

    direct_vm.sender = alice
    print("CLAIM:", c.claim_payout(0))
    print("FEE BALANCE:", _p(c.get_fee_balance()))

    with pytest.raises(AssertionError, match="Already claimed"):
        c.claim_payout(0)

    direct_vm.sender = bob
    with pytest.raises(AssertionError, match="Wrong side"):
        c.claim_payout(0)

    fb = c.get_fee_balance()
    print("FB RAW:", fb, type(fb))
    direct_vm.sender = host
    print("COLLECT:", c.collect_fees(int(fb)))
    print("DONE")
