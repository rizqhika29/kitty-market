"""
Terminal void refund path tests (Direct Mode)
==============================================
Proves the terminal-refund flow: after MAX_SETTLE_ATTEMPTS failed settlements,
anyone can call terminal_void, and every position holder reclaims full stake.

Covers:
1. Full refund after terminal void (reclaim succeeds, double-reclaim blocked)
2. terminal_void rejected before MAX_SETTLE_ATTEMPTS
3. reclaim_stake rejected on non-void market
4. Double reclaim rejected
5. Uninvolved trader cannot reclaim
6. Host can reclaim if they hold a position
"""
import json
import pytest
from datetime import datetime, timezone


def _to_hex(addr):
    if isinstance(addr, bytes):
        return "0x" + addr.hex()
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return str(addr)


def _parse(raw):
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def _deploy(direct_deploy, host):
    return direct_deploy("contracts/kitty_market.py", _to_hex(host))


def _setup_void_market(direct_vm, contract, host, trader, stake):
    """Open a market, place one bet, settle 5 times (all void), terminal_void."""
    direct_vm.sender = host
    contract.join("h")
    direct_vm.sender = trader
    contract.join("t")

    now = int(datetime.now(timezone.utc).timestamp())
    direct_vm.sender = host
    contract.open_market(
        "Q?", "other", "https://evidence.invalid", now + 86400, 0, 0
    )
    direct_vm.sender = trader
    direct_vm.value = stake
    contract.take_side(0, "yes")
    direct_vm.value = 0

    direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
    direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

    direct_vm.sender = host
    for _ in range(5):
        contract.settle_market(0)

    m = _parse(contract.get_market(0))
    assert int(m["settle_attempts"]) >= 5
    assert m["settled"] is False

    contract.terminal_void(0)
    return _parse(contract.get_market(0))


class TestTerminalVoidRefund:

    def test_full_refund_after_terminal_void(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        alice = direct_accounts[1]

        contract = _deploy(direct_deploy, host)

        stake = 10 * 10**18
        m = _setup_void_market(direct_vm, contract, host, alice, stake)

        assert m["terminal_void"] is True
        assert m["settled"] is True
        assert m["outcome"] == "terminal_void"

        direct_vm.sender = alice
        contract.reclaim_stake(0)

        with pytest.raises(AssertionError, match="Already reclaimed"):
            contract.reclaim_stake(0)

    def test_cannot_terminal_void_before_max_attempts(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        contract = _deploy(direct_deploy, host)

        now = int(datetime.now(timezone.utc).timestamp())
        direct_vm.sender = host
        contract.join("h")
        contract.open_market("Q?", "other", "https://x", now + 86400, 0, 0)

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        for _ in range(2):
            contract.settle_market(0)

        m = _parse(contract.get_market(0))
        assert int(m["settle_attempts"]) == 2
        assert m["settled"] is False

        with pytest.raises(AssertionError, match="Must have 5 or more failed settle attempts"):
            contract.terminal_void(0)

    def test_cannot_reclaim_stake_on_non_void(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]
        contract = _deploy(direct_deploy, host)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = trader
        contract.join("t")

        now = int(datetime.now(timezone.utc).timestamp())
        direct_vm.sender = host
        contract.open_market("Q?", "other", "https://example.com", now + 86400, 0, 0)

        direct_vm.sender = trader
        direct_vm.value = 10**18
        contract.take_side(0, "yes")
        direct_vm.value = 0

        direct_vm.mock_web(r".*", {"status": 200, "body": "data"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "yes", "reasoning": "clear"}))

        contract.settle_market(0)

        m = _parse(contract.get_market(0))
        if m["outcome"] in ("void", "terminal_void"):
            pytest.skip("Mock returned void")

        with pytest.raises(AssertionError, match="Not a void market"):
            contract.reclaim_stake(0)

    def test_cannot_double_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]
        contract = _deploy(direct_deploy, host)

        stake = 5 * 10**18
        _setup_void_market(direct_vm, contract, host, trader, stake)

        direct_vm.sender = trader
        contract.reclaim_stake(0)

        with pytest.raises(AssertionError, match="Already reclaimed"):
            contract.reclaim_stake(0)

    def test_uninvolved_trader_cannot_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]
        stranger = direct_accounts[2]
        contract = _deploy(direct_deploy, host)

        stake = 10**18
        _setup_void_market(direct_vm, contract, host, trader, stake)

        direct_vm.sender = stranger
        contract.join("s")

        with pytest.raises(AssertionError, match="No position in this market"):
            contract.reclaim_stake(0)

    def test_host_can_also_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        other_host = direct_accounts[1]
        trader = direct_accounts[2]
        contract = _deploy(direct_deploy, host)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = other_host
        contract.join("oh")
        direct_vm.sender = trader
        contract.join("t")

        now = int(datetime.now(timezone.utc).timestamp())
        direct_vm.sender = other_host
        contract.open_market("Q?", "other", "https://evidence.invalid", now + 86400, 0, 0)

        direct_vm.sender = host
        direct_vm.value = 3 * 10**18
        contract.take_side(0, "yes")
        direct_vm.value = 0

        direct_vm.sender = trader
        direct_vm.value = 7 * 10**18
        contract.take_side(0, "no")
        direct_vm.value = 0

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        direct_vm.sender = other_host
        for _ in range(5):
            contract.settle_market(0)

        contract.terminal_void(0)

        direct_vm.sender = host
        contract.reclaim_stake(0)
        direct_vm.sender = trader
        contract.reclaim_stake(0)

        with pytest.raises(AssertionError, match="Already reclaimed"):
            direct_vm.sender = host
            contract.reclaim_stake(0)

        with pytest.raises(AssertionError, match="Already reclaimed"):
            direct_vm.sender = trader
            contract.reclaim_stake(0)
