"""Settlement, payout, fee and withdrawal-safety tests (Direct Mode)."""

import pytest

E18 = 10**18


def test_cash_out_is_removed(env):
    """The old balance-draining entry point must not exist."""
    assert not hasattr(env.contract, "cash_out")


def test_multiple_winners_claim_without_minting_extra_fees(env):
    mid = env.open_market()
    env.stake(env.alice, mid, "yes", 2 * E18)
    env.stake(env.carol, mid, "yes", 6 * E18)
    env.stake(env.bob, mid, "no", 2 * E18)

    env.warp_after_close(mid)
    env.settle(mid, "yes")

    market = env.market(mid)
    assert market["settled"] is True
    assert market["outcome"] == "yes"
    assert int(market["fee_accrued"]) == E18 // 10  # 1% of 10 GEN
    assert int(market["payout_pool"]) == 10 * E18 - E18 // 10

    a = env.assert_solvent()
    assert int(a["liability"]) == 99 * E18 // 10
    assert int(a["fee_balance"]) == E18 // 10

    first = env.claim(env.alice, mid)
    assert int(first["payout"]) == 2475 * E18 // 1000

    # A claim must not accrue another fee.
    after_first = env.assert_solvent()
    assert int(after_first["fee_balance"]) == E18 // 10
    assert int(after_first["liability"]) == 7425 * E18 // 1000

    second = env.claim(env.carol, mid)
    assert int(second["payout"]) == 7425 * E18 // 1000

    after_second = env.assert_solvent()
    assert int(after_second["fee_balance"]) == E18 // 10
    assert int(after_second["liability"]) == 0
    assert int(after_second["contract_balance"]) == E18 // 10

    with pytest.raises(AssertionError, match="Already claimed"):
        env.contract.claim_payout(mid)

    env.vm.sender = env.bob
    with pytest.raises(AssertionError, match="Wrong side"):
        env.contract.claim_payout(mid)

    # The owner can only take the already-reserved fee; payouts are complete.
    env.collect(env.host, E18 // 10)
    final = env.assert_solvent()
    assert int(final["fee_balance"]) == 0
    assert int(final["liability"]) == 0
    assert int(final["contract_balance"]) == 0


def test_fee_collection_never_reduces_participant_reserves(env):
    mid = env.open_market()
    env.stake(env.alice, mid, "yes", 3 * E18)
    env.stake(env.bob, mid, "no", 7 * E18)
    env.warp_after_close(mid)
    env.settle(mid, "yes")

    before = env.assert_solvent()
    assert int(before["liability"]) == 99 * E18 // 10
    assert int(before["fee_balance"]) == E18 // 10

    with pytest.raises(AssertionError, match="Only owner"):
        env.vm.sender = env.alice
        env.contract.collect_fees(E18 // 10)

    env.vm.sender = env.host
    with pytest.raises(AssertionError, match="Insufficient fee balance"):
        env.contract.collect_fees(2 * E18)

    # Defensive check: storage can claim a fee, but a withdrawal that would
    # leave the contract below participant liabilities must still be rejected.
    env.ledger.set_balance(99 * E18 // 10)
    env.vm.sender = env.host
    with pytest.raises(AssertionError, match="reduce participant reserves"):
        env.contract.collect_fees(E18 // 20)
    env.ledger.set_balance(10 * E18)

    # A normal fee withdrawal leaves exactly the winner's 9.9 GEN reserve.
    env.collect(env.host, E18 // 10)
    after_fee = env.assert_solvent()
    assert int(after_fee["liability"]) == 99 * E18 // 10
    assert int(after_fee["contract_balance"]) == 99 * E18 // 10

    env.claim(env.alice, mid)
    after_claim = env.assert_solvent()
    assert int(after_claim["liability"]) == 0
    assert int(after_claim["contract_balance"]) == 0


def test_zero_winning_positions_become_a_full_refund_void(env):
    """If nobody backed the winning side, the fund-safe policy is refunds."""
    mid = env.open_market()
    env.stake(env.alice, mid, "yes", 5 * E18)
    env.warp_after_close(mid)
    env.settle(mid, "no", "the answer was no")

    market = env.market(mid)
    assert market["settled"] is True
    assert market["outcome"] == "void"
    assert int(market["fee_accrued"]) == 0
    assert int(market["payout_pool"]) == 0
    assert int(market["winning_pool"]) == 0
    assert int(market["settle_attempts"]) == 0
    assert "No winning positions" in market["verdict_note"]

    before = env.assert_solvent()
    assert int(before["liability"]) == 5 * E18
    assert int(before["fee_balance"]) == 0

    env.vm.sender = env.alice
    with pytest.raises(AssertionError, match="Void market"):
        env.contract.claim_payout(mid)

    result = env.reclaim(env.alice, mid)
    assert int(result["refunded"]) == 5 * E18

    after = env.assert_solvent()
    assert int(after["liability"]) == 0
    assert int(after["fee_balance"]) == 0
    assert int(after["contract_balance"]) == 0

    with pytest.raises(AssertionError, match="Already reclaimed"):
        env.contract.reclaim_stake(mid)


def test_fee_is_accrued_once_per_market_not_per_claim(env):
    """Two markets collect independent fees; claims never change the vault."""
    mid = env.open_market()
    env.stake(env.alice, mid, "yes", E18)
    env.stake(env.bob, mid, "no", E18)
    env.warp_after_close(mid)
    env.settle(mid, "yes")

    fee_per_market = 2 * E18 // 100
    assert int(env.market(mid)["fee_accrued"]) == fee_per_market
    assert int(env.accounting()["fee_balance"]) == fee_per_market

    first = env.claim(env.alice, mid)
    assert int(first["payout"]) == 2 * E18 - fee_per_market
    assert int(env.accounting()["fee_balance"]) == fee_per_market

    mid2 = env.open_market(question="Second market?")
    env.stake(env.carol, mid2, "no", 3 * E18)
    env.stake(env.bob, mid2, "yes", E18)
    env.warp_after_close(mid2)
    env.settle(mid2, "no")

    # 1% of 4 GEN, added exactly once for the second market.
    expected_total = fee_per_market + 4 * E18 // 100
    assert int(env.accounting()["fee_balance"]) == expected_total
    env.assert_solvent()
