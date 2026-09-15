"""
Focused test: Terminal void refund path
========================================
Proves that every participant can recover their full stake after evidence
becomes permanently inaccessible or undecodable (terminal failure).

Test scenario:
1. Deploy contract
2. Register 3 traders
3. Host creates a market with an evidence URL
4. All 3 traders place bets (different sides, different amounts)
5. Settle fails MAX_SETTLE_ATTEMPTS times (simulating inaccessible evidence)
6. Anyone calls terminal_void()
7. All 3 traders reclaim their full stakes
8. Verify: every participant's wallet balance >= their starting balance
"""
import json
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_json(raw):
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def deployed(contract):
    """Return (contract_instance, owner_address)."""
    return contract, contract.owner()


# ---------------------------------------------------------------------------
# Test: terminal void → full refund for every participant
# ---------------------------------------------------------------------------

class TestTerminalVoidRefund:
    """
    Terminal-void refund path
    ─────────────────────────
    When evidence is permanently inaccessible / undecodable the contract must
    allow *anyone* to call ``terminal_void`` after ``MAX_SETTLE_ATTEMPTS``
    failed settlement rounds, and every position holder must be able to
    reclaim their **full** original stake.
    """

    def test_full_refund_after_terminal_void(self, chain, accounts, deploy_contract):
        """
        Core test: 3 traders bet, settlement fails 5×, terminal_void called,
        all 3 reclaim full stake.
        """
        host = accounts[0]
        trader_a = accounts[1]
        trader_b = accounts[2]
        trader_c = accounts[3]

        # Deploy
        contract = deploy_contract(host)

        # Register traders
        contract.join("host_cat", sender=host)
        contract.join("alice", sender=trader_a)
        contract.join("bob", sender=trader_b)
        contract.join("charlie", sender=trader_c)

        # Record starting balances
        bal_a_start = chain.get_balance(trader_a)
        bal_b_start = chain.get_balance(trader_b)
        bal_c_start = chain.get_balance(trader_c)

        # Host opens a market (evidence URL is intentionally broken)
        now = chain.timestamp
        closes_at = now + 86400  # closes in 1 day

        contract.open_market(
            "Will BTC hit 200k?",
            "crypto",
            "https://evidence.invalid/permanently-down",
            closes_at,
            0,   # min_wager = 0
            0,   # max_wager = 0 (uncapped)
            sender=host,
        )

        # Traders place bets
        stake_a = chain.web3.to_wei(10, "ether")
        stake_b = chain.web3.to_wei(20, "ether")
        stake_c = chain.web3.to_wei(15, "ether")

        contract.take_side(0, "yes", value=stake_a, sender=trader_a)
        contract.take_side(0, "no", value=stake_b, sender=trader_b)
        contract.take_side(0, "yes", value=stake_c, sender=trader_c)

        # Verify pools
        m = _parse_json(contract.get_market(0))
        assert int(m["yes_pool"]) == stake_a + stake_c
        assert int(m["no_pool"]) == stake_b

        # Advance time past close
        chain.timestamp = closes_at + 1
        chain.mine()

        # Simulate MAX_SETTLE_ATTEMPTS (5) failed settlements
        # In production each settle_market call triggers AI consensus which
        # returns "void" when evidence is inaccessible. Here we call settle
        # until the contract records enough attempts.
        MAX_ATTEMPTS = 5
        for i in range(MAX_ATTEMPTS):
            # Each call increments settle_attempts; mock returns void
            contract.settle_market(0, sender=accounts[5])

        # Verify attempts recorded
        m = _parse_json(contract.get_market(0))
        assert int(m["settle_attempts"]) >= MAX_ATTEMPTS

        # ── Terminal void ──
        tx = contract.terminal_void(0, sender=accounts[5])

        m = _parse_json(contract.get_market(0))
        assert m["terminal_void"] is True
        assert m["settled"] is True
        assert m["outcome"] == "terminal_void"

        # ── Every trader reclaims full stake ──
        contract.reclaim_stake(0, sender=trader_a)
        contract.reclaim_stake(0, sender=trader_b)
        contract.reclaim_stake(0, sender=trader_c)

        bal_a_end = chain.get_balance(trader_a)
        bal_b_end = chain.get_balance(trader_b)
        bal_c_end = chain.get_balance(trader_c)

        # Each trader must have recovered their full stake
        # (minus gas, so >= is the correct assertion)
        assert bal_a_end >= bal_a_start, f"Trader A lost money: start={bal_a_start} end={bal_a_end}"
        assert bal_b_end >= bal_b_start, f"Trader B lost money: start={bal_b_start} end={bal_b_end}"
        assert bal_c_end >= bal_c_start, f"Trader C lost money: start={bal_c_start} end={bal_c_end}"

        # The positions must be marked closed
        pos_a = _parse_json(contract.get_trader_positions(trader_a.as_hex))
        pos_b = _parse_json(contract.get_trader_positions(trader_b.as_hex))
        pos_c = _parse_json(contract.get_trader_positions(trader_c.as_hex))

        for positions in [pos_a, pos_b, pos_c]:
            for p in positions:
                assert p["closed"] is True

    def test_cannot_terminal_void_before_max_attempts(self, chain, accounts, deploy_contract):
        """terminal_void must revert when settle_attempts < MAX_SETTLE_ATTEMPTS."""
        host = accounts[0]
        caller = accounts[5]
        contract = deploy_contract(host)

        contract.join("host_cat", sender=host)

        now = chain.timestamp
        contract.open_market("Q?", "other", "https://x", now + 86400, 0, 0, sender=host)

        # Only 2 attempts – should fail
        for _ in range(2):
            contract.settle_market(0, sender=caller)

        with pytest.raises(Exception):
            contract.terminal_void(0, sender=caller)

    def test_cannot_reclaim_stake_on_non_void(self, chain, accounts, deploy_contract):
        """reclaim_stake must revert on a market that resolved to yes/no."""
        host = accounts[0]
        trader = accounts[1]
        contract = deploy_contract(host)

        contract.join("h", sender=host)
        contract.join("t", sender=trader)

        now = chain.timestamp
        closes = now + 86400
        contract.open_market("Q?", "other", "https://example.com", closes, 0, 0, sender=host)

        contract.take_side(0, "yes", value=chain.web3.to_wei(1, "ether"), sender=trader)

        chain.timestamp = closes + 1
        chain.mine()

        # Settlement returns a definitive outcome (mocked as "yes")
        contract.settle_market(0, sender=accounts[5])

        m = _parse_json(contract.get_market(0))
        if m["outcome"] in ("void", "terminal_void"):
            pytest.skip("Mock returned void – cannot test non-void path")

        with pytest.raises(Exception):
            contract.reclaim_stake(0, sender=trader)

    def test_cannot_double_reclaim(self, chain, accounts, deploy_contract):
        """Calling reclaim_stake twice must revert the second time."""
        host = accounts[0]
        trader = accounts[1]
        contract = deploy_contract(host)

        contract.join("h", sender=host)
        contract.join("t", sender=trader)

        now = chain.timestamp
        closes = now + 86400
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0, sender=host)
        contract.take_side(0, "yes", value=chain.web3.to_wei(5, "ether"), sender=trader)

        chain.timestamp = closes + 1
        chain.mine()

        for _ in range(5):
            contract.settle_market(0, sender=accounts[5])

        contract.terminal_void(0, sender=accounts[5])
        contract.reclaim_stake(0, sender=trader)

        with pytest.raises(Exception):
            contract.reclaim_stake(0, sender=trader)

    def test_host_can_also_reclaim(self, chain, accounts, deploy_contract):
        """If the host also placed a position (on someone else's market), they can reclaim too."""
        host = accounts[0]
        other_host = accounts[1]
        trader = accounts[2]

        contract = deploy_contract(host)
        contract.join("h", sender=host)
        contract.join("oh", sender=other_host)
        contract.join("t", sender=trader)

        now = chain.timestamp
        closes = now + 86400

        # other_host creates market so host can bet
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0, sender=other_host)
        contract.take_side(0, "yes", value=chain.web3.to_wei(3, "ether"), sender=host)
        contract.take_side(0, "no", value=chain.web3.to_wei(7, "ether"), sender=trader)

        chain.timestamp = closes + 1
        chain.mine()

        for _ in range(5):
            contract.settle_market(0, sender=accounts[5])

        contract.terminal_void(0, sender=accounts[5])

        bal_host_start = chain.get_balance(host)
        bal_trader_start = chain.get_balance(trader)

        contract.reclaim_stake(0, sender=host)
        contract.reclaim_stake(0, sender=trader)

        assert chain.get_balance(host) >= bal_host_start
        assert chain.get_balance(trader) >= bal_trader_start

    def test_uninvolved_trader_cannot_reclaim(self, chain, accounts, deploy_contract):
        """A trader with no position must not be able to reclaim."""
        host = accounts[0]
        trader = accounts[1]
        stranger = accounts[2]
        contract = deploy_contract(host)

        contract.join("h", sender=host)
        contract.join("t", sender=trader)
        contract.join("s", sender=stranger)

        now = chain.timestamp
        closes = now + 86400
        contract.open_market("Q?", "other", "https://evidence.invalid", closes, 0, 0, sender=host)
        contract.take_side(0, "yes", value=chain.web3.to_wei(1, "ether"), sender=trader)

        chain.timestamp = closes + 1
        chain.mine()

        for _ in range(5):
            contract.settle_market(0, sender=accounts[5])

        contract.terminal_void(0, sender=accounts[5])

        with pytest.raises(Exception):
            contract.reclaim_stake(0, sender=stranger)
