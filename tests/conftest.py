"""Shared direct-mode fixtures and helpers for Kitty Market tests."""

import json
import datetime as dt

import pytest


def to_hex(addr):
    if isinstance(addr, bytes):
        return "0x" + addr.hex()
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return str(addr)


def as_json(raw):
    return json.loads(raw) if isinstance(raw, str) else raw


def iso_utc(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat().replace("+00:00", "Z")


class Ledger:
    """Mirrors native value transfers that direct mode does not simulate."""

    def __init__(self, vm):
        self.vm = vm
        self.balance = 0

    def _sync(self):
        self.vm.deal(self.vm._contract_address, self.balance)

    def deposit(self, amount):
        self.balance += int(amount)
        self._sync()

    def withdraw(self, amount):
        amount = int(amount)
        assert amount <= self.balance, f"ledger underflow: {amount} > {self.balance}"
        self.balance -= amount
        self._sync()

    def set_balance(self, amount):
        self.balance = int(amount)
        self._sync()


class MarketEnv:
    def __init__(self, vm, deploy, accounts):
        self.vm = vm
        self.accounts = accounts
        self.host = accounts[0]
        self.alice = accounts[1]
        self.bob = accounts[2]
        self.carol = accounts[3]
        self.stranger = accounts[4]
        self.ledger = Ledger(vm)
        self.contract = deploy("contracts/kitty_market.py", to_hex(self.host))

    # ---------------------------------------------------------------- setup
    def join(self, who, alias):
        self.vm.sender = who
        self.vm.value = 0
        return self.contract.join(alias)

    def open_market(
        self,
        question="Will the test pass?",
        topic="testing",
        source_url="https://example.com/evidence",
        closes_in=3600,
        min_wager=0,
        max_wager=0,
        creator=None,
    ):
        now = int(dt.datetime.now(dt.timezone.utc).timestamp())
        self.vm.sender = creator or self.host
        self.vm.value = 0
        mid = self.contract.open_market(
            question,
            topic,
            source_url,
            now + closes_in,
            min_wager,
            max_wager,
        )
        return int(mid)

    def stake(self, who, market_id, side, amount):
        self.vm.sender = who
        self.vm.value = int(amount)
        try:
            result = self.contract.take_side(market_id, side)
        finally:
            self.vm.value = 0
        self.ledger.deposit(amount)
        return result

    # -------------------------------------------------------------- helpers
    def market(self, market_id):
        return as_json(self.contract.get_market(market_id))

    def accounting(self):
        return as_json(self.contract.get_accounting())

    def assert_solvent(self):
        a = self.accounting()
        assert a["solvent"] is True, a
        assert int(a["contract_balance"]) >= int(a["liability"]) + int(a["fee_balance"]), a
        return a

    def warp_after_close(self, market_id, extra=1):
        closes_at = int(self.market(market_id)["closes_at"])
        self.vm.warp(iso_utc(closes_at + extra))

    def settle(self, market_id, outcome="yes", reasoning="evidence is clear", sender=None):
        self.vm.clear_mocks()
        self.vm.mock_web(r".*", {"status": 200, "body": f"evidence supports {outcome}"})
        self.vm.mock_llm(
            r".*",
            json.dumps({"outcome": outcome, "reasoning": reasoning}),
        )
        self.vm.sender = sender or self.host
        self.vm.value = 0
        return as_json(self.contract.settle_market(market_id))

    def claim(self, who, market_id):
        self.vm.sender = who
        self.vm.value = 0
        result = as_json(self.contract.claim_payout(market_id))
        self.ledger.withdraw(int(result["payout"]))
        return result

    def reclaim(self, who, market_id):
        self.vm.sender = who
        self.vm.value = 0
        result = as_json(self.contract.reclaim_stake(market_id))
        self.ledger.withdraw(int(result["refunded"]))
        return result

    def collect(self, who, amount):
        self.vm.sender = who
        self.vm.value = 0
        self.contract.collect_fees(int(amount))
        self.ledger.withdraw(amount)


@pytest.fixture
def env(direct_vm, direct_deploy, direct_accounts):
    return MarketEnv(direct_vm, direct_deploy, direct_accounts)
