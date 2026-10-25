"""Market lifecycle safety tests: deadlines, attempts, caps, invariants."""

import pytest

E18 = 10**18


def test_settlement_cannot_run_before_the_close_time(env):
    mid = env.open_market(closes_in=3600)
    env.stake(env.alice, mid, "yes", E18)

    env.vm.sender = env.host
    env.vm.value = 0
    with pytest.raises(AssertionError, match="Market has not closed yet"):
        env.contract.settle_market(mid)

    market = env.market(mid)
    assert market["settled"] is False
    assert int(market["settle_attempts"]) == 0
    assert int(market["fee_accrued"]) == 0

    # A premature terminal void is also rejected and does not touch the state.
    with pytest.raises(AssertionError, match="Market has not closed yet"):
        env.contract.terminal_void(mid)
    market = env.market(mid)
    assert market["terminal_void"] is False
    assert market["settled"] is False
    assert int(market["settle_attempts"]) == 0

    a = env.assert_solvent()
    assert int(a["liability"]) == E18


def test_only_failed_attempts_are_counted_and_terminal_void_is_gated(env):
    mid = env.open_market(closes_in=3600)
    env.stake(env.alice, mid, "yes", 2 * E18)
    env.warp_after_close(mid)

    for attempt in range(1, 6):
        result = env.settle(mid, "void", "evidence unavailable")
        assert result["outcome"] == "void"
        market = env.market(mid)
        assert market["settled"] is False
        assert int(market["settle_attempts"]) == attempt
        assert int(market["fee_accrued"]) == 0
        assert int(market["payout_pool"]) == 0
        a = env.assert_solvent()
        assert int(a["liability"]) == 2 * E18
        assert int(a["fee_balance"]) == 0

        if attempt < 5:
            with pytest.raises(AssertionError, match="5 or more failed settle attempts"):
                env.contract.terminal_void(mid)

    env.vm.sender = env.stranger
    env.contract.terminal_void(mid)

    market = env.market(mid)
    assert market["terminal_void"] is True
    assert market["settled"] is True
    assert market["outcome"] == "terminal_void"
    assert int(market["settle_attempts"]) == 5

    env.reclaim(env.alice, mid)
    a = env.assert_solvent()
    assert int(a["liability"]) == 0
    assert int(a["fee_balance"]) == 0
    assert int(a["contract_balance"]) == 0


def test_successful_settlement_does_not_increment_attempts(env):
    mid = env.open_market(closes_in=3600)
    env.stake(env.alice, mid, "yes", E18)
    env.warp_after_close(mid)
    result = env.settle(mid, "yes")
    assert result["outcome"] == "yes"

    market = env.market(mid)
    assert market["settled"] is True
    assert int(market["settle_attempts"]) == 0

    env.vm.sender = env.host
    with pytest.raises(AssertionError, match="Already resolved"):
        env.contract.settle_market(mid)
    with pytest.raises(AssertionError, match="Already resolved"):
        env.contract.terminal_void(mid)

    assert int(env.market(mid)["settle_attempts"]) == 0


def test_zero_winning_result_does_not_count_as_a_failed_attempt(env):
    mid = env.open_market(closes_in=3600)
    env.stake(env.alice, mid, "yes", E18)
    env.warp_after_close(mid)
    env.settle(mid, "no", "answer is no")

    market = env.market(mid)
    assert market["settled"] is True
    assert market["outcome"] == "void"
    assert int(market["settle_attempts"]) == 0


def test_wager_cap_applies_to_cumulative_position(env):
    min_wager = E18
    max_wager = 10 * E18
    mid = env.open_market(min_wager=min_wager, max_wager=max_wager)

    env.stake(env.alice, mid, "yes", 6 * E18)
    assert int(env.market(mid)["yes_pool"]) == 6 * E18

    # A second 5 GEN top-up would push exposure to 11 GEN and must fail,
    # even though 5 GEN alone is below the advertised 10 GEN maximum.
    with pytest.raises(AssertionError, match="Above maximum wager"):
        env.stake(env.alice, mid, "yes", 5 * E18)

    market = env.market(mid)
    assert int(market["yes_pool"]) == 6 * E18
    assert int(env.accounting()["liability"]) == 6 * E18

    # Bringing the cumulative position to exactly the cap succeeds.
    env.stake(env.alice, mid, "yes", 4 * E18)
    market = env.market(mid)
    assert int(market["yes_pool"]) == max_wager

    with pytest.raises(AssertionError, match="Above maximum wager"):
        env.stake(env.alice, mid, "yes", E18)

    with pytest.raises(AssertionError, match="Below minimum wager"):
        env.stake(env.bob, mid, "no", E18 // 2)

    with pytest.raises(AssertionError, match="Above maximum wager"):
        env.stake(env.bob, mid, "no", max_wager + 1)

    # Caps are per-trader: another trader can still take up to the cap.
    env.stake(env.bob, mid, "no", max_wager)
    market = env.market(mid)
    assert int(market["yes_pool"]) == max_wager
    assert int(market["no_pool"]) == max_wager
    assert int(env.accounting()["liability"]) == 2 * max_wager
    env.assert_solvent()


def test_liabilities_are_fully_covered_through_payout_and_refund_flows(env):
    # Market 1: successful settlement, partially claimed.
    mid1 = env.open_market(question="Market one?")
    env.stake(env.alice, mid1, "yes", 3 * E18)
    env.stake(env.bob, mid1, "no", 7 * E18)
    env.warp_after_close(mid1)
    env.settle(mid1, "yes")

    a = env.assert_solvent()
    assert int(a["liability"]) == 99 * E18 // 10
    env.claim(env.alice, mid1)
    a = env.assert_solvent()
    assert int(a["liability"]) == 0

    # Market 2: void with both sides owed full refunds.
    mid2 = env.open_market(question="Market two?")
    env.stake(env.carol, mid2, "yes", 4 * E18)
    env.stake(env.bob, mid2, "no", 6 * E18)
    env.warp_after_close(mid2)
    for _ in range(5):
        env.settle(mid2, "void", "inconclusive")
    env.vm.sender = env.host
    env.contract.terminal_void(mid2)

    a = env.assert_solvent()
    assert int(a["liability"]) == 10 * E18
    assert int(a["fee_balance"]) == E18 // 10

    env.reclaim(env.carol, mid2)
    a = env.assert_solvent()
    assert int(a["liability"]) == 6 * E18
    env.reclaim(env.bob, mid2)
    a = env.assert_solvent()
    assert int(a["liability"]) == 0
    assert int(a["contract_balance"]) == E18 // 10
