"""Terminal void and refund-path tests (Direct Mode)."""

import pytest

E18 = 10**18


def test_full_refund_after_terminal_void(env):
    mid = env.open_market(source_url="https://evidence.invalid/down")
    env.stake(env.alice, mid, "yes", 10 * E18)
    env.stake(env.bob, mid, "no", 4 * E18)
    env.warp_after_close(mid)

    for _ in range(5):
        assert env.settle(mid, "void", "evidence inaccessible")["outcome"] == "void"

    market = env.market(mid)
    assert market["terminal_void"] is False
    assert market["settled"] is False
    assert int(market["settle_attempts"]) == 5

    env.vm.sender = env.stranger
    env.contract.terminal_void(mid)

    market = env.market(mid)
    assert market["terminal_void"] is True
    assert market["settled"] is True
    assert market["outcome"] == "terminal_void"
    assert int(market["fee_accrued"]) == 0
    assert int(env.accounting()["fee_balance"]) == 0

    a = env.assert_solvent()
    assert int(a["liability"]) == 14 * E18

    assert int(env.reclaim(env.alice, mid)["refunded"]) == 10 * E18
    a = env.assert_solvent()
    assert int(a["liability"]) == 4 * E18
    assert int(env.reclaim(env.bob, mid)["refunded"]) == 4 * E18

    a = env.assert_solvent()
    assert int(a["liability"]) == 0
    assert int(a["contract_balance"]) == 0

    with pytest.raises(AssertionError, match="Already reclaimed"):
        env.contract.reclaim_stake(mid)


def test_cannot_terminal_void_before_max_attempts(env):
    mid = env.open_market(source_url="https://evidence.invalid/down")
    env.warp_after_close(mid)

    for _ in range(2):
        env.settle(mid, "void", "evidence inaccessible")

    market = env.market(mid)
    assert int(market["settle_attempts"]) == 2
    assert market["settled"] is False

    env.vm.sender = env.host
    with pytest.raises(AssertionError, match="Must have 5 or more failed settle attempts"):
        env.contract.terminal_void(mid)
    assert env.market(mid)["terminal_void"] is False


def test_cannot_reclaim_stake_on_non_void(env):
    mid = env.open_market()
    env.stake(env.alice, mid, "yes", E18)
    env.stake(env.bob, mid, "no", E18)
    env.warp_after_close(mid)
    env.settle(mid, "yes")

    env.vm.sender = env.alice
    with pytest.raises(AssertionError, match="Not a void market"):
        env.contract.reclaim_stake(mid)


def test_cannot_double_reclaim(env):
    mid = env.open_market(source_url="https://evidence.invalid/down")
    env.stake(env.alice, mid, "yes", 5 * E18)
    env.warp_after_close(mid)
    for _ in range(5):
        env.settle(mid, "void", "evidence inaccessible")
    env.contract.terminal_void(mid)

    env.reclaim(env.alice, mid)
    with pytest.raises(AssertionError, match="Already reclaimed"):
        env.contract.reclaim_stake(mid)


def test_uninvolved_trader_cannot_reclaim(env):
    mid = env.open_market(source_url="https://evidence.invalid/down")
    env.stake(env.alice, mid, "yes", E18)
    env.warp_after_close(mid)
    for _ in range(5):
        env.settle(mid, "void", "evidence inaccessible")
    env.contract.terminal_void(mid)

    env.vm.sender = env.stranger
    with pytest.raises(AssertionError, match="No position in this market"):
        env.contract.reclaim_stake(mid)


def test_host_can_also_reclaim_from_another_hosts_market(env):
    # Alice hosts the market so the contract's own host (accounts[0]) may bet.
    mid = env.open_market(creator=env.alice, source_url="https://evidence.invalid/down")
    env.stake(env.host, mid, "yes", 3 * E18)
    env.stake(env.bob, mid, "no", 7 * E18)
    env.warp_after_close(mid)

    for _ in range(5):
        env.settle(mid, "void", "evidence inaccessible")
    env.contract.terminal_void(mid)

    assert int(env.reclaim(env.host, mid)["refunded"]) == 3 * E18
    assert int(env.reclaim(env.bob, mid)["refunded"]) == 7 * E18
    a = env.assert_solvent()
    assert int(a["liability"]) == 0
    assert int(a["contract_balance"]) == 0
