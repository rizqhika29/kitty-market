# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json


@allow_storage
@dataclass
class Market:
    creator: Address
    question: str
    resolution_url: str
    topic: str
    deadline: u64
    min_wager: u256
    max_wager: u256
    yes_pool: u256
    no_pool: u256
    resolved: bool
    outcome: str  # "yes", "no", "void", "terminal_void"
    reasoning: str
    settle_attempts: u64
    terminal_void: bool


@allow_storage
@dataclass
class Position:
    market_id: u256
    side: str
    size: u256
    closed: bool


@allow_storage
@dataclass
class Trader:
    alias: str
    joined_at: u64
    earnings: u256
    correct_calls: u64
    total_calls: u64


MAX_SETTLE_ATTEMPTS: u64 = 5


class KittyMarket(gl.Contract):
    markets: DynArray[Market]
    positions: TreeMap[str, Position]
    traders: TreeMap[str, Trader]
    owner: str
    total_wagers: u256
    fee_balance: u256
    fee_rate: u256

    def __init__(self, owner: str):
        self.owner = owner
        self.total_wagers = u256(0)
        self.fee_balance = u256(0)
        self.fee_rate = u256(100)  # 1% fee (basis points / 100)

    @gl.public.write
    def join(self, alias: str) -> str:
        sender = gl.message.sender_address
        key = sender.as_hex
        if key in self.traders:
            return json.dumps({"error": "already joined"})
        self.traders[key] = Trader(
            alias=alias,
            joined_at=u64(int(datetime.now(timezone.utc).timestamp())),
            earnings=u256(0),
            correct_calls=u64(0),
            total_calls=u64(0),
        )
        return json.dumps({"alias": alias, "address": sender.as_hex})

    @gl.public.write.payable
    def open_market(
        self,
        question: str,
        topic: str,
        source_url: str,
        closes_at: u256,
        min_wager: u256,
        max_wager: u256,
    ) -> u256:
        sender = gl.message.sender_address
        now = u64(int(datetime.now(timezone.utc).timestamp()))

        assert len(question) > 0, "Question is required"
        assert len(question) <= 200, "Question must be 200 chars or less"
        assert len(source_url) > 0, "Evidence URL is required"
        assert u64(closes_at) > now, "Close date must be in the future"
        assert u64(closes_at) < now + u64(365 * 24 * 3600), "Close date too far in future"
        if min_wager > 0 and max_wager > 0:
            assert min_wager <= max_wager, "Min wager cannot exceed max wager"

        market_id = u256(len(self.markets))
        self.markets.append(
            Market(
                creator=sender,
                question=question,
                resolution_url=source_url,
                topic=topic,
                deadline=u64(closes_at),
                min_wager=min_wager,
                max_wager=max_wager,
                yes_pool=u256(0),
                no_pool=u256(0),
                resolved=False,
                outcome="",
                reasoning="",
                settle_attempts=u64(0),
                terminal_void=False,
            )
        )
        return market_id

    @gl.public.write.payable
    def take_side(self, market_id: u256, side: str) -> str:
        sender = gl.message.sender_address
        amount = gl.message.value
        idx = int(market_id)

        assert idx < len(self.markets), "Market does not exist"
        market = self.markets[idx]
        assert not market.resolved, "Market already resolved"
        assert not market.terminal_void, "Market is terminal void"
        assert side in ("yes", "no"), "Side must be 'yes' or 'no'"

        now = u64(int(datetime.now(timezone.utc).timestamp()))
        assert now < market.deadline, "Market is closed"

        assert sender != market.creator, "Host cannot bet on own market"

        if market.max_wager > 0:
            assert amount >= market.min_wager, "Below minimum wager"
            assert amount <= market.max_wager, "Above maximum wager"
        elif market.min_wager > 0:
            assert amount >= market.min_wager, "Below minimum wager"

        assert amount > u256(0), "Must wager something"

        pos_key = f"{hex(int(market_id))}:{sender.as_hex}"
        if pos_key in self.positions:
            existing = self.positions[pos_key]
            assert existing.side == side, "Already on the other side"
            existing.size = existing.size + amount
        else:
            self.positions[pos_key] = Position(
                market_id=market_id,
                side=side,
                size=amount,
                closed=False,
            )

        if side == "yes":
            self.markets[idx].yes_pool = market.yes_pool + amount
        else:
            self.markets[idx].no_pool = market.no_pool + amount

        self.total_wagers = self.total_wagers + amount
        return "ok"

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        idx = int(market_id)
        assert idx < len(self.markets), "Market does not exist"
        market = self.markets[idx]
        assert not market.resolved, "Already resolved"
        assert not market.terminal_void, "Market is terminal void"

        self.markets[idx].settle_attempts = market.settle_attempts + u64(1)

        def leader_fn():
            try:
                web = gl.nondet.web.get(market.resolution_url)
                content = web.body.decode("utf-8", errors="ignore")[:8000]
            except Exception:
                return {"outcome": "void", "reasoning": "Evidence URL inaccessible"}

            prompt = (
                f"You are resolving a prediction market.\n\n"
                f"Question: {market.question}\n\n"
                f"Evidence:\n{content}\n\n"
                f"Determine the answer. Reply with JSON: "
                f'{{"outcome": "yes" or "no", "reasoning": "brief explanation"}}\n'
                f"If the evidence is insufficient, unclear, or the URL is inaccessible, "
                f'reply with {{"outcome": "void", "reasoning": "explanation"}}'
            )

            try:
                resp = gl.nondet.exec_prompt(prompt, response_format="json")
                return resp
            except Exception:
                return {"outcome": "void", "reasoning": "LLM call failed"}

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                mine = leader_fn()
                return leader_result.calldata["outcome"] == mine["outcome"]
            except Exception:
                return False

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        if isinstance(result, gl.vm.Return):
            outcome = result.calldata.get("outcome", "void")
            reasoning = result.calldata.get("reasoning", "")
        else:
            outcome = "void"
            reasoning = "Settlement failed or timed out"

        if outcome in ("yes", "no"):
            self.markets[idx].resolved = True
        self.markets[idx].outcome = outcome
        self.markets[idx].reasoning = reasoning

        return json.dumps({"outcome": outcome, "reasoning": reasoning})

    @gl.public.write
    def terminal_void(self, market_id: u256) -> str:
        idx = int(market_id)
        assert idx < len(self.markets), "Market does not exist"
        market = self.markets[idx]
        assert not market.resolved, "Already resolved"
        assert not market.terminal_void, "Already terminal void"
        assert market.settle_attempts >= MAX_SETTLE_ATTEMPTS, (
            f"Must have {MAX_SETTLE_ATTEMPTS} or more failed settle attempts"
        )

        self.markets[idx].terminal_void = True
        self.markets[idx].resolved = True
        self.markets[idx].outcome = "terminal_void"
        self.markets[idx].reasoning = (
            f"Evidence permanently inaccessible or undecodable after "
            f"{market.settle_attempts} settlement attempts. "
            f"All stakes refunded."
        )

        return "terminal_void"

    @gl.public.write
    def reclaim_stake(self, market_id: u256) -> str:
        idx = int(market_id)
        assert idx < len(self.markets), "Market does not exist"
        market = self.markets[idx]
        assert market.resolved, "Market not resolved yet"
        assert market.outcome in ("void", "terminal_void"), "Not a void market"

        sender = gl.message.sender_address
        pos_key = f"{hex(int(market_id))}:{sender.as_hex}"
        assert pos_key in self.positions, "No position in this market"

        pos = self.positions[pos_key]
        assert not pos.closed, "Already reclaimed"
        assert pos.size > u256(0), "Nothing to reclaim"

        refund = pos.size
        pos.closed = True
        self.positions[pos_key] = pos

        receiver = gl.get_contract_at(sender)
        receiver.emit_transfer(value=refund, on='accepted')

        return json.dumps({"refunded": str(refund)})

    @gl.public.write
    def claim_payout(self, market_id: u256) -> str:
        idx = int(market_id)
        assert idx < len(self.markets), "Market does not exist"
        market = self.markets[idx]
        assert market.resolved, "Market not resolved"
        assert market.outcome not in ("void", "terminal_void"), "Void market"

        sender = gl.message.sender_address
        pos_key = f"{hex(int(market_id))}:{sender.as_hex}"
        assert pos_key in self.positions, "No position"

        pos = self.positions[pos_key]
        assert not pos.closed, "Already claimed"
        assert pos.side == market.outcome, "Wrong side"

        total_pool = market.yes_pool + market.no_pool
        fee = total_pool * self.fee_rate / u256(10000)
        distributable = total_pool - fee
        self.fee_balance = self.fee_balance + fee

        if pos.side == "yes":
            share = pos.size * distributable // market.yes_pool if market.yes_pool > u256(0) else u256(0)
        else:
            share = pos.size * distributable // market.no_pool if market.no_pool > u256(0) else u256(0)

        pos.closed = True
        self.positions[pos_key] = pos

        trader_key = sender.as_hex
        if trader_key in self.traders:
            trader = self.traders[trader_key]
            trader.earnings = trader.earnings + share
            trader.correct_calls = trader.correct_calls + u64(1)
            trader.total_calls = trader.total_calls + u64(1)
            self.traders[trader_key] = trader

        receiver = gl.get_contract_at(sender)
        receiver.emit_transfer(value=share, on='accepted')

        return json.dumps({"payout": str(share)})

    @gl.public.write
    def cash_out(self, amount: u256):
        assert amount > u256(0), "Amount must be greater than 0"
        sender = gl.message.sender_address
        assert self.balance >= amount, "Insufficient balance"
        receiver = gl.get_contract_at(sender)
        receiver.emit_transfer(value=amount, on='accepted')

    @gl.public.write
    def collect_fees(self, amount: u256):
        assert gl.message.sender_address.as_hex == self.owner, "Only owner"
        assert self.fee_balance >= amount, "Insufficient fee balance"
        self.fee_balance = self.fee_balance - amount
        receiver = gl.get_contract_at(gl.message.sender_address)
        receiver.emit_transfer(value=amount, on='accepted')

    @gl.public.view
    def get_market(self, market_id: u256) -> str:
        idx = int(market_id)
        assert idx < len(self.markets), "Market does not exist"
        m = self.markets[idx]
        return json.dumps({
            "id": str(market_id),
            "question": m.question,
            "topic": m.topic,
            "source_url": m.resolution_url,
            "host": m.creator.as_hex,
            "closes_at": str(m.deadline),
            "min_wager": str(m.min_wager),
            "max_wager": str(m.max_wager),
            "pool": str(m.yes_pool + m.no_pool),
            "yes_pool": str(m.yes_pool),
            "no_pool": str(m.no_pool),
            "settled": m.resolved,
            "outcome": m.outcome,
            "verdict_note": m.reasoning,
            "settle_attempts": str(m.settle_attempts),
            "terminal_void": m.terminal_void,
        })

    @gl.public.view
    def get_total_markets(self) -> u256:
        return u256(len(self.markets))

    @gl.public.view
    def get_total_wagers(self) -> u256:
        return self.total_wagers

    @gl.public.view
    def get_total_traders(self) -> u256:
        return u256(len(self.traders))

    @gl.public.view
    def get_trader_info(self, address: str) -> str:
        if address in self.traders:
            t = self.traders[address]
            return json.dumps({
                "alias": t.alias,
                "joined_at": str(t.joined_at),
                "earnings": str(t.earnings),
                "hit_rate": str(t.correct_calls * u64(100) // t.total_calls) if t.total_calls > 0 else "0",
            })
        return "unknown trader"

    @gl.public.view
    def get_trader_positions(self, address: str) -> str:
        result = []
        for key, pos in self.positions.items():
            if address in key:
                result.append({
                    "market_id": str(pos.market_id),
                    "side": pos.side,
                    "size": str(pos.size),
                    "closed": pos.closed,
                })
        return json.dumps(result)

    @gl.public.view
    def get_top_cats(self) -> str:
        result = []
        for key, trader in self.traders.items():
            hit_rate = trader.correct_calls * u64(100) // trader.total_calls if trader.total_calls > 0 else u64(0)
            result.append({
                "name": trader.alias,
                "address": key,
                "earnings": str(trader.earnings),
                "hit_rate": str(hit_rate),
            })
        result.sort(key=lambda x: int(x["earnings"]), reverse=True)
        return json.dumps(result[:10])

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner

    @gl.public.view
    def get_fee_balance(self) -> u256:
        return self.fee_balance
