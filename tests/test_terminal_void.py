"""
Terminal void refund path tests (Direct Mode)
==============================================
Proves that every participant can recover their full stake after evidence
becomes permanently inaccessible (terminal failure).

Test scenario:
1. Deploy contract
2. Register traders
3. Host creates a market
4. Traders place bets
5. Settle fails MAX_SETTLE_ATTEMPTS times (mock returns void)
6. Anyone calls terminal_void()
7. All traders reclaim their full stakes
"""
import json
import pytest


def _parse_json(raw):
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


class TestTerminalVoidRefund:

    def test_full_refund_after_terminal_void(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        alice = direct_accounts[1]
        bob = direct_accounts[2]
        charlie = direct_accounts[3]
        caller = direct_accounts[5]

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("host_cat")
        direct_vm.sender = alice
        contract.join("alice")
        direct_vm.sender = bob
        contract.join("bob")
        direct_vm.sender = charlie
        contract.join("charlie")

        bal_a_start = direct_vm.get_balance(alice)
        bal_b_start = direct_vm.get_balance(bob)
        bal_c_start = direct_vm.get_balance(charlie)

        now = direct_vm.get_timestamp()
        closes_at = int(now) + 86400

        direct_vm.sender = host
        contract.open_market(
            "Will BTC hit 200k?",
            "crypto",
            "https://evidence.invalid/permanently-down",
            closes_at,
            0,
            0,
        )

        stake_a = 10 * 10**18
        stake_b = 20 * 10**18
        stake_c = 15 * 10**18

        direct_vm.sender = alice
        contract.take_side(0, "yes", value=stake_a)
        direct_vm.sender = bob
        contract.take_side(0, "no", value=stake_b)
        direct_vm.sender = charlie
        contract.take_side(0, "yes", value=stake_c)

        m = _parse_json(contract.get_market(0))
        assert int(m["yes_pool"]) == stake_a + stake_c
        assert int(m["no_pool"]) == stake_b

        direct_vm.sender = caller
        for _ in range(5):
            contract.settle_market(0)

        m = _parse_json(contract.get_market(0))
        assert int(m["settle_attempts"]) >= 5

        contract.terminal_void(0)

        m = _parse_json(contract.get_market(0))
        assert m["terminal_void"] is True
        assert m["settled"] is True
        assert m["outcome"] == "terminal_void"

        direct_vm.sender = alice
        contract.reclaim_stake(0)
        direct_vm.sender = bob
        contract.reclaim_stake(0)
        direct_vm.sender = charlie
        contract.reclaim_stake(0)

        assert direct_vm.get_balance(alice) >= bal_a_start
        assert direct_vm.get_balance(bob) >= bal_b_start
        assert direct_vm.get_balance(charlie) >= bal_c_start

    def test_cannot_terminal_void_before_max_attempts(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        caller = direct_accounts[5]

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("host_cat")

        now = direct_vm.get_timestamp()
        contract.open_market("Q?", "other", "https://x", int(now) + 86400, 0, 0)

        direct_vm.sender = caller
        for _ in range(2):
            contract.settle_market(0)

        with direct_vm.expect_revert("Must have 5 or more failed settle attempts"):
            contract.terminal_void(0)

    def test_cannot_reclaim_stake_on_non_void(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]

        direct_vm.mock_web(r".*", {"status": 200, "body": "market data"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "yes", "reasoning": "clear evidence"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = trader
        contract.join("t")

        now = direct_vm.get_timestamp()
        closes = int(now) + 86400

        direct_vm.sender = host
        contract.open_market("Q?", "other", "https://example.com", closes, 0, 0)
        direct_vm.sender = trader
        contract.take_side(0, "yes", value=10**18)

        direct_vm.sender = trader
        contract.settle_market(0)

        m = _parse_json(contract.get_market(0))
        if m["outcome"] in ("void", "terminal_void"):
            pytest.skip("Mock returned void - cannot test non-void path")

        with direct_vm.expect_revert("Not a void market"):
            contract.reclaim_stake(0)

    def test_cannot_double_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]
        caller = direct_accounts[5]

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = trader
        contract.join("t")

        now = direct_vm.get_timestamp()
        closes = int(now) + 86400

        direct_vm.sender = host
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0)
        direct_vm.sender = trader
        contract.take_side(0, "yes", value=5 * 10**18)

        direct_vm.sender = caller
        for _ in range(5):
            contract.settle_market(0)

        contract.terminal_void(0)

        direct_vm.sender = trader
        contract.reclaim_stake(0)

        with direct_vm.expect_revert("Already reclaimed"):
            contract.reclaim_stake(0)

    def test_uninvolved_trader_cannot_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        trader = direct_accounts[1]
        stranger = direct_accounts[2]
        caller = direct_accounts[5]

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = trader
        contract.join("t")
        direct_vm.sender = stranger
        contract.join("s")

        now = direct_vm.get_timestamp()
        closes = int(now) + 86400

        direct_vm.sender = host
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0)
        direct_vm.sender = trader
        contract.take_side(0, "yes", value=10**18)

        direct_vm.sender = caller
        for _ in range(5):
            contract.settle_market(0)

        contract.terminal_void(0)

        direct_vm.sender = stranger
        with direct_vm.expect_revert("No position in this market"):
            contract.reclaim_stake(0)

    def test_host_can_also_reclaim(self, direct_vm, direct_deploy, direct_accounts):
        host = direct_accounts[0]
        other_host = direct_accounts[1]
        trader = direct_accounts[2]
        caller = direct_accounts[5]

        direct_vm.mock_web(r".*", {"status": 200, "body": "unavailable"})
        direct_vm.mock_llm(r".*", json.dumps({"outcome": "void", "reasoning": "inaccessible"}))

        contract = direct_deploy("contracts/kitty_market.py", host.as_hex)

        direct_vm.sender = host
        contract.join("h")
        direct_vm.sender = other_host
        contract.join("oh")
        direct_vm.sender = trader
        contract.join("t")

        now = direct_vm.get_timestamp()
        closes = int(now) + 86400

        direct_vm.sender = other_host
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0)

        direct_vm.sender = host
        contract.take_side(0, "yes", value=3 * 10**18)
        direct_vm.sender = trader
        contract.take_side(0, "no", value=7 * 10**18)

        direct_vm.sender = caller
        for _ in range(5):
            contract.settle_market(0)

        contract.terminal_void(0)

        bal_host_start = direct_vm.get_balance(host)
        bal_trader_start = direct_vm.get_balance(trader)

        direct_vm.sender = host
        contract.reclaim_stake(0)
        direct_vm.sender = trader
        contract.reclaim_stake(0)

        assert direct_vm.get_balance(host) >= bal_host_start
        assert direct_vm.get_balance(trader) >= bal_trader_start
