"""Direct-mode tests for the KittyMarket contract.

Properties under test:
  1. Fee integrity — the settlement levy enters the vault exactly once per
     market, and only when a real payout happens. Spam claims never mint fees.
  2. Lifecycle enforcement — markets need a future close time; trading is
     blocked after close and settlement is blocked before it.
  3. Void path — an unusable verdict (or a verdict nobody backed) voids the
     market so every participant reclaims their full stake.
  4. Fund conservation — payouts + fee + dust <= pot in every scenario.
  5. Host lockout — whoever controls the evidence URLs cannot hold positions.
  6. Wager caps — per-market min/max bounds are enforced on every position.
  7. Multi-source corroboration — at least 2 distinct-domain sources required,
     cross-referenced by AI; conflicting sources yield inconclusive (voided).
"""

import json
from datetime import datetime, timezone

import pytest

BASE_ISO = "2025-01-01T00:00:00Z"
BASE_TS = int(datetime.fromisoformat(BASE_ISO.replace("Z", "+00:00")).timestamp())
HOUR = 3600
DAY = 24 * HOUR
CLOSE = BASE_TS + 100 * HOUR  # ~4.2 days out
AFTER_CLOSE = CLOSE + HOUR

# Two distinct domains for corroboration requirement
SRC1 = "https://coingecko.com/bitcoin"
SRC2 = "https://reuters.com/markets"
TWO_SOURCES = SRC1 + ", " + SRC2


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def to_int(v) -> int:
    return int(v)


@pytest.fixture
def vm(direct_vm):
    return direct_vm


@pytest.fixture
def accounts(direct_accounts):
    return direct_accounts


@pytest.fixture
def host(accounts):
    # Dedicated account that opens markets (never trades them).
    return accounts[3]


@pytest.fixture
def contract(vm, direct_deploy):
    vm.warp(BASE_ISO)
    return direct_deploy("contracts/kitty_market.py")


# ── helpers ──────────────────────────────────────────────────────────────

def join(vm, contract, addr, alias):
    vm.sender = addr
    vm.value = 0
    return contract.join(alias)


def open_market(
    vm,
    contract,
    host,
    closes_at=CLOSE,
    question="Will it happen?",
    source_urls=TWO_SOURCES,
    min_wager=0,
    max_wager=0,
):
    vm.sender = host
    vm.value = 0
    return contract.open_market(
        question, "crypto", source_urls, closes_at,
        min_wager, max_wager,
    )


def stake(vm, contract, addr, market_id, side, amount):
    vm.sender = addr
    vm.value = amount
    stake_id = contract.take_side(market_id, side)
    vm.value = 0
    return stake_id


def claim(vm, contract, addr, market_id):
    vm.sender = addr
    vm.value = 0
    return contract.claim_payout(market_id)


def reclaim(vm, contract, addr, market_id):
    vm.sender = addr
    vm.value = 0
    return contract.reclaim_stake(market_id)


def wallet(vm, contract, addr) -> int:
    return to_int(contract.get_trader_balance(str(addr)))


def vault(vm, contract) -> int:
    return to_int(contract.get_fee_balance())


def settle_yes(vm, contract, market_id):
    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": "<html>up</html>"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "<html>up too</html>"})
    vm.mock_llm(r".*", json.dumps({"note": "evidence says yes", "outcome": "yes"}))
    return contract.settle_market(market_id)


def settle_no(vm, contract, market_id):
    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": "<html>x</html>"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "<html>x too</html>"})
    vm.mock_llm(r".*", json.dumps({"note": "evidence says no", "outcome": "no"}))
    return contract.settle_market(market_id)


def settle_garbage(vm, contract, market_id):
    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": "<html>?</html>"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "<html>?</html>"})
    vm.mock_llm(r".*", json.dumps({"note": "unclear", "outcome": "perhaps"}))
    return contract.settle_market(market_id)


def settle_inconclusive(vm, contract, market_id):
    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": "<html>mixed</html>"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "<html>opposite</html>"})
    vm.mock_llm(r".*", json.dumps({"note": "sources conflict", "outcome": "inconclusive"}))
    return contract.settle_market(market_id)


# ════════════════════════════════════════════════════════════════════════
# 1. Fee integrity
# ════════════════════════════════════════════════════════════════════════

def test_spam_claims_never_inflate_vault(vm, contract, accounts, host):
    alice, bob, carol = accounts[0], accounts[1], accounts[2]
    for who, alias in [(host, "host"), (alice, "alice"), (bob, "bob"), (carol, "carol")]:
        join(vm, contract, who, alias)

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 40)
    stake(vm, contract, bob, mid, "yes", 60)
    stake(vm, contract, carol, mid, "no", 100)

    vm.warp(iso(AFTER_CLOSE))
    assert json.loads(settle_yes(vm, contract, mid))["outcome"] == "yes"

    for _ in range(10):
        assert "no eligible winnings" in claim(vm, contract, carol, mid)
    assert vault(vm, contract) == 0

    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == (40 * 196) // 100
    assert vault(vm, contract) == 4

    frozen = wallet(vm, contract, alice)
    for _ in range(10):
        assert "no eligible winnings" in claim(vm, contract, alice, mid)
    assert wallet(vm, contract, alice) == frozen
    assert vault(vm, contract) == 4

    res = json.loads(claim(vm, contract, bob, mid))
    assert to_int(res["paid"]) == (60 * 196) // 100
    assert vault(vm, contract) == 4

    paid = wallet(vm, contract, alice) + wallet(vm, contract, bob)
    assert paid + vault(vm, contract) == 199
    assert paid + vault(vm, contract) <= 200


def test_levy_booked_once_across_partial_claims(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 40)
    stake(vm, contract, bob, mid, "yes", 60)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    res_a = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res_a["paid"]) == (40 * 98) // 100
    assert vault(vm, contract) == 2

    res_b = json.loads(claim(vm, contract, bob, mid))
    assert to_int(res_b["paid"]) == (60 * 98) // 100
    assert vault(vm, contract) == 2

    paid = wallet(vm, contract, alice) + wallet(vm, contract, bob)
    assert paid + vault(vm, contract) == 99


# ════════════════════════════════════════════════════════════════════════
# 2. Conservation on both outcomes
# ════════════════════════════════════════════════════════════════════════

def test_yes_outcome_conservation(vm, contract, accounts, host):
    alice, bob, carol = accounts[0], accounts[1], accounts[2]
    for who, alias in [(host, "host"), (alice, "a"), (bob, "b"), (carol, "c")]:
        join(vm, contract, who, alias)

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)
    stake(vm, contract, bob, mid, "yes", 200)
    stake(vm, contract, carol, mid, "no", 300)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    res_a = json.loads(claim(vm, contract, alice, mid))
    res_b = json.loads(claim(vm, contract, bob, mid))
    assert to_int(res_a["paid"]) == (100 * 588) // 300
    assert to_int(res_b["paid"]) == (200 * 588) // 300

    paid = wallet(vm, contract, alice) + wallet(vm, contract, bob)
    assert vault(vm, contract) == 12
    assert paid == 588
    assert paid + vault(vm, contract) == 600

    assert "no eligible winnings" in claim(vm, contract, carol, mid)


def test_no_outcome_conservation(vm, contract, accounts, host):
    alice, bob, carol = accounts[0], accounts[1], accounts[2]
    for who, alias in [(host, "host"), (alice, "a"), (bob, "b"), (carol, "c")]:
        join(vm, contract, who, alias)

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)
    stake(vm, contract, bob, mid, "no", 100)
    stake(vm, contract, carol, mid, "no", 50)

    vm.warp(iso(AFTER_CLOSE))
    assert json.loads(settle_no(vm, contract, mid))["outcome"] == "no"

    res_b = json.loads(claim(vm, contract, bob, mid))
    res_c = json.loads(claim(vm, contract, carol, mid))
    assert to_int(res_b["paid"]) == (100 * 245) // 150
    assert to_int(res_c["paid"]) == (50 * 245) // 150

    paid = wallet(vm, contract, bob) + wallet(vm, contract, carol)
    assert vault(vm, contract) == 5
    assert paid == 244
    assert paid + vault(vm, contract) <= 250


# ════════════════════════════════════════════════════════════════════════
# 3. Void paths & refunds
# ════════════════════════════════════════════════════════════════════════

def test_unusable_verdict_voids_and_refunds(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 70)
    stake(vm, contract, bob, mid, "no", 30)

    vm.warp(iso(AFTER_CLOSE))
    result = json.loads(settle_garbage(vm, contract, mid))
    assert result["outcome"] == "void"

    assert "voided" in claim(vm, contract, alice, mid)

    assert json.loads(reclaim(vm, contract, alice, mid))["returned"] == "70"
    assert json.loads(reclaim(vm, contract, bob, mid))["returned"] == "30"
    assert vault(vm, contract) == 0
    assert wallet(vm, contract, alice) == 70
    assert wallet(vm, contract, bob) == 30


def test_no_fee_on_voided_markets(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 50)
    stake(vm, contract, bob, mid, "no", 50)

    vm.warp(iso(AFTER_CLOSE))
    assert json.loads(settle_garbage(vm, contract, mid))["outcome"] == "void"
    assert vault(vm, contract) == 0

    assert json.loads(reclaim(vm, contract, alice, mid))["returned"] == "50"
    assert "nothing to reclaim" in reclaim(vm, contract, alice, mid)
    assert json.loads(reclaim(vm, contract, bob, mid))["returned"] == "50"
    assert vault(vm, contract) == 0


def test_verdict_without_backers_voids_market(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "no", 100)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    market = json.loads(contract.get_market(mid))
    assert market["settled"] is True
    assert market["outcome"] == "void"

    assert json.loads(reclaim(vm, contract, alice, mid))["returned"] == "100"
    assert vault(vm, contract) == 0
    assert wallet(vm, contract, alice) == 100


# ════════════════════════════════════════════════════════════════════════
# 4. Lifecycle enforcement
# ════════════════════════════════════════════════════════════════════════

def test_open_requires_future_close(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("closes_at must be in the future"):
        open_market(vm, contract, host, closes_at=BASE_TS - 10)


def test_trading_closes_on_time(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    mid = open_market(vm, contract, host)

    vm.warp(iso(AFTER_CLOSE))
    with vm.expect_revert("trading window closed"):
        stake(vm, contract, alice, mid, "yes", 10)


def test_settlement_blocked_before_close(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 10)

    with vm.expect_revert("trading window still open"):
        vm.value = 0
        contract.settle_market(mid)


def test_settlement_requires_stakes(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    mid = open_market(vm, contract, host)

    vm.warp(iso(AFTER_CLOSE))
    with vm.expect_revert("nothing was ever staked here"):
        vm.value = 0
        contract.settle_market(mid)


def test_full_flow_then_single_winner(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)
    stake(vm, contract, bob, mid, "no", 100)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    assert vault(vm, contract) == 0
    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == 196
    assert vault(vm, contract) == 4


# ════════════════════════════════════════════════════════════════════════
# 5. Double-claim protection & host lockout
# ════════════════════════════════════════════════════════════════════════

def test_no_double_payout(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == 98

    assert "no eligible winnings" in claim(vm, contract, alice, mid)
    assert wallet(vm, contract, alice) == 98
    assert vault(vm, contract) == 2


def test_host_locked_out_of_own_market(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)

    with vm.expect_revert("host cannot hold positions in own market"):
        stake(vm, contract, host, mid, "yes", 100)

    stake(vm, contract, alice, mid, "yes", 100)
    market = json.loads(contract.get_market(mid))
    assert market["yes_pool"] == "100"

    stake_other = None
    assert stake_other is None

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)
    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == 98
    assert wallet(vm, contract, host) == 0


def test_host_lockout_blocks_cross_side_manipulation(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)

    with vm.expect_revert("host cannot hold positions in own market"):
        stake(vm, contract, host, mid, "no", 100)

    vm.warp(iso(AFTER_CLOSE))
    settle_yes(vm, contract, mid)

    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == 98
    assert wallet(vm, contract, host) == 0


# ════════════════════════════════════════════════════════════════════════
# 6. Wager caps (Kitty-specific feature)
# ════════════════════════════════════════════════════════════════════════

def test_wager_below_minimum_rejected(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host, min_wager=10, max_wager=1000)

    with vm.expect_revert("wager below market minimum"):
        stake(vm, contract, alice, mid, "yes", 9)


def test_wager_above_maximum_rejected(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host, min_wager=10, max_wager=1000)

    with vm.expect_revert("wager above market maximum"):
        stake(vm, contract, alice, mid, "yes", 1001)


def test_wager_within_bounds_accepted(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host, min_wager=10, max_wager=1000)

    stake(vm, contract, alice, mid, "yes", 500)
    market = json.loads(contract.get_market(mid))
    assert market["yes_pool"] == "500"


def test_bounds_validation_at_creation(vm, contract, accounts, host):
    join(vm, contract, host, "host")

    with vm.expect_revert("min_wager cannot exceed max_wager"):
        open_market(vm, contract, host, min_wager=200, max_wager=100)


def test_uncapped_market_accepts_any_amount(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host, min_wager=0, max_wager=0)

    stake(vm, contract, alice, mid, "no", 1)
    stake(vm, contract, alice, mid, "no", 123456789)
    market = json.loads(contract.get_market(mid))
    assert market["no_pool"] == "123456790"


def test_max_only_bound_still_enforces_floor_of_one(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host, min_wager=0, max_wager=50)

    stake(vm, contract, alice, mid, "yes", 1)
    with vm.expect_revert("wager above market maximum"):
        stake(vm, contract, alice, mid, "yes", 51)


# ════════════════════════════════════════════════════════════════════════
# 7. Input validation
# ════════════════════════════════════════════════════════════════════════

def test_join_rejects_bad_alias(vm, contract, accounts):
    alice = accounts[0]
    with vm.expect_revert("alias must be 1-32 characters"):
        vm.sender = alice
        contract.join("")
    with vm.expect_revert("alias must be 1-32 characters"):
        vm.sender = alice
        contract.join("x" * 33)


def test_open_rejects_bad_source_urls(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("source URL must be http(s)"):
        vm.sender = host
        contract.open_market("Q", "crypto", "ftp://a.com, https://b.com", CLOSE, 0, 0)
    with vm.expect_revert("source URL must be http(s)"):
        vm.sender = host
        contract.open_market("Q", "crypto", "javascript:alert(1), https://b.com", CLOSE, 0, 0)


def test_open_rejects_unknown_topic(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("unknown topic"):
        vm.sender = host
        contract.open_market("Q", "conspiracy", TWO_SOURCES, CLOSE, 0, 0)


def test_open_rejects_empty_question(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("question must be 1-200 characters"):
        vm.sender = host
        contract.open_market("", "crypto", TWO_SOURCES, CLOSE, 0, 0)


def test_open_rejects_distant_close(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("closes_at too far ahead"):
        vm.sender = host
        contract.open_market(
            "Q", "crypto", TWO_SOURCES, BASE_TS + 400 * DAY, 0, 0
        )


def test_open_rejects_empty_source_urls(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    with vm.expect_revert("source_urls required"):
        vm.sender = host
        contract.open_market("Q", "crypto", "", CLOSE, 0, 0)


def test_open_rejects_single_source(vm, contract, accounts, host):
    """Corroboration requires at least 2 sources."""
    join(vm, contract, host, "host")
    with vm.expect_revert("provide 2-5 source URLs for corroboration"):
        vm.sender = host
        contract.open_market("Q", "crypto", "https://coingecko.com/bitcoin", CLOSE, 0, 0)


def test_open_rejects_too_many_sources(vm, contract, accounts, host):
    join(vm, contract, host, "host")
    urls = ", ".join(["https://example%d.com" % i for i in range(6)])
    with vm.expect_revert("provide 2-5 source URLs for corroboration"):
        vm.sender = host
        contract.open_market("Q", "crypto", urls, CLOSE, 0, 0)


def test_open_rejects_same_domain_sources(vm, contract, accounts, host):
    """Sources must come from distinct domains."""
    join(vm, contract, host, "host")
    with vm.expect_revert("sources must come from distinct domains"):
        vm.sender = host
        contract.open_market(
            "Q", "crypto",
            "https://coingecko.com/bitcoin, https://coingecko.com/ethereum",
            CLOSE, 0, 0,
        )


def test_open_rejects_www_vs_non_www_same_domain(vm, contract, accounts, host):
    """www and non-www are the same domain."""
    join(vm, contract, host, "host")
    with vm.expect_revert("sources must come from distinct domains"):
        vm.sender = host
        contract.open_market(
            "Q", "crypto",
            "https://www.coingecko.com/bitcoin, https://coingecko.com/ethereum",
            CLOSE, 0, 0,
        )


# ════════════════════════════════════════════════════════════════════════
# 8. Transient-failure retryable path
# ════════════════════════════════════════════════════════════════════════

def test_transient_failure_returns_retryable_not_void(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 50)
    stake(vm, contract, bob, mid, "no", 50)

    vm.warp(iso(AFTER_CLOSE))
    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": b"\xff\xfe"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "ok"})
    vm.mock_llm(r".*", '{"note": "ok", "outcome": "yes"}')
    result = json.loads(contract.settle_market(mid))

    assert result.get("retryable") is True
    assert result.get("settled") is False

    market = json.loads(contract.get_market(mid))
    assert market["settled"] is False
    assert market["outcome"] == ""


def test_transient_failure_preserves_market_state(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)

    vm.warp(iso(AFTER_CLOSE))

    vm.value = 0
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": b"\xff\xfe"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": b"\xff\xfe"})
    vm.mock_llm(r".*", '{"note": "", "outcome": "yes"}')
    result = json.loads(contract.settle_market(mid))

    assert result.get("retryable") is True
    assert result.get("settled") is False

    market = json.loads(contract.get_market(mid))
    assert market["settled"] is False
    assert market["outcome"] == ""
    assert market["yes_pool"] == "100"
    assert market["pool"] == "100"

    assert vault(vm, contract) == 0
    assert wallet(vm, contract, alice) == 0

    assert "not settled" in claim(vm, contract, alice, mid)
    assert "not settled" in reclaim(vm, contract, alice, mid)


def test_permanent_failure_voids_market(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 80)

    vm.warp(iso(AFTER_CLOSE))
    result = json.loads(settle_garbage(vm, contract, mid))
    assert result["outcome"] == "void"

    market = json.loads(contract.get_market(mid))
    assert market["settled"] is True
    assert market["outcome"] == "void"

    assert json.loads(reclaim(vm, contract, alice, mid))["returned"] == "80"


# ════════════════════════════════════════════════════════════════════════
# 9. Multi-source corroboration + inconclusive
# ════════════════════════════════════════════════════════════════════════

def test_inconclusive_verdict_voids_and_refunds(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 60)
    stake(vm, contract, bob, mid, "no", 40)

    vm.warp(iso(AFTER_CLOSE))
    result = json.loads(settle_inconclusive(vm, contract, mid))
    assert result["outcome"] == "void"
    assert result["reason"] == "inconclusive"

    market = json.loads(contract.get_market(mid))
    assert market["settled"] is True
    assert market["outcome"] == "void"
    assert vault(vm, contract) == 0

    assert json.loads(reclaim(vm, contract, alice, mid))["returned"] == "60"
    assert json.loads(reclaim(vm, contract, bob, mid))["returned"] == "40"
    assert vault(vm, contract) == 0
    assert wallet(vm, contract, alice) == 60
    assert wallet(vm, contract, bob) == 40


def test_multi_source_yes_resolution(vm, contract, accounts, host):
    alice, bob = accounts[0], accounts[1]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")
    join(vm, contract, bob, "bob")

    mid = open_market(vm, contract, host)
    stake(vm, contract, alice, mid, "yes", 100)
    stake(vm, contract, bob, mid, "no", 50)

    vm.warp(iso(AFTER_CLOSE))
    vm.mock_web(r"coingecko\.com", {"status": 200, "body": "<html>up</html>"})
    vm.mock_web(r"reuters\.com", {"status": 200, "body": "<html>also up</html>"})
    vm.mock_llm(r".*", json.dumps({"note": "both sources agree yes", "outcome": "yes"}))
    result = json.loads(contract.settle_market(mid))

    assert result["outcome"] == "yes"
    assert result["settled"] is True

    # pot=150, levy=3, prize=147, winners_pot=100, alice_share=(100*147)//100=147
    res = json.loads(claim(vm, contract, alice, mid))
    assert to_int(res["paid"]) == 147
    assert vault(vm, contract) == 3


def test_source_urls_persist_in_market_data(vm, contract, accounts, host):
    join(vm, contract, host, "host")

    mid = open_market(vm, contract, host)

    market = json.loads(contract.get_market(mid))
    assert market["source_urls"] == TWO_SOURCES
    assert len(market["source_urls"].split(",")) == 2


def test_host_cannot_trade_own_multi_source_market(vm, contract, accounts, host):
    alice = accounts[0]
    join(vm, contract, host, "host")
    join(vm, contract, alice, "alice")

    mid = open_market(vm, contract, host)

    with vm.expect_revert("host cannot hold positions in own market"):
        stake(vm, contract, host, mid, "yes", 100)

    stake(vm, contract, alice, mid, "yes", 100)
    market = json.loads(contract.get_market(mid))
    assert market["yes_pool"] == "100"
