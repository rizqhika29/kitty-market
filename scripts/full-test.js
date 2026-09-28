const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "contract-address.json"), "utf-8"));
const CONTRACT = cfg.address;
const OWNER_PK = cfg.privateKey;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTx(label, c, fn, args, value) {
  try {
    const h = await c.writeContract({ address: CONTRACT, functionName: fn, args, value: value || BigInt(0) });
    for (let i = 0; i < 100; i++) {
      await sleep(3000);
      try {
        const tx = await c.getTransaction({ hash: h });
        if (tx?.statusName === "FINALIZED") {
          const lr = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
          if (lr?.execution_result === "ERROR") {
            const stderr = lr.genvm_result?.stderr || "";
            const lines = stderr.split("\n").filter(l => l.trim());
            const last = lines.slice(-3).join(" | ");
            console.log(`  ${label} ERROR: ${last}`);
            return { pass: false, error: last };
          }
          console.log(`  ${label} OK`);
          return { pass: true, hash: h };
        }
        if (tx?.statusName === "REJECTED") { console.log(`  ${label} REJECTED`); return { pass: false, error: "rejected" }; }
      } catch (e) {}
    }
    console.log(`  ${label} TIMEOUT`);
    return { pass: false, error: "timeout" };
  } catch (e) {
    console.log(`  ${label} ERR: ${String(e.shortMessage || e.message).slice(0, 200)}`);
    return { pass: false, error: String(e.shortMessage || e.message).slice(0, 200) };
  }
}

async function main() {
  const owner = createAccount(OWNER_PK);
  const client = createClient({ chain: studionet, account: owner });

  const mk = async (label) => {
    const a = createAccount(generatePrivateKey());
    await client.request({ method: "sim_fundAccount", params: [a.address, 1000] });
    console.log(`${label}: ${a.address}`);
    return { a, c: createClient({ chain: studionet, account: a }) };
  };

  console.log("Contract:", CONTRACT);
  console.log("Owner:", owner.address);

  const creator = await mk("Creator");
  const winner = await mk("Winner");
  const loser = await mk("Loser");

  let pass = 0, fail = 0;
  const failures = [];
  const ok = (n) => { pass++; console.log(`  PASS ${n}`); };
  const nok = (n, e) => { fail++; failures.push(`${n}: ${e}`); console.log(`  FAIL ${n}: ${e}`); };
  const step = async (n, c, fn, args, value, expectFail) => {
    const r = await sendTx(n, c, fn, args, value);
    if (expectFail) { r.pass ? nok(n, "expected failure") : ok(n); }
    else { r.pass ? ok(n) : nok(n, r.error); }
    return r;
  };

  // fresh market id
  const startId = Number(await client.readContract({ address: CONTRACT, functionName: "get_total_markets", args: [] }));
  console.log("start market id:", startId);

  console.log("\n=== JOIN ===");
  await step("join owner", client, "join", ["Owner"]);
  await step("join creator", creator.c, "join", ["Creator"]);
  await step("join winner", winner.c, "join", ["Winner"]);
  await step("join loser", loser.c, "join", ["Loser"]);
  await step("join creator twice", creator.c, "join", ["Creator2"], BigInt(0), true);

  console.log("\n=== OPEN MARKET ===");
  const now = Math.floor(Date.now() / 1000);
  await step("open_market", creator.c, "open_market", [
    "Is the sky blue?", "science", "https://en.wikipedia.org/wiki/Sky", BigInt(now + 86400), BigInt(0), BigInt(0),
  ]);
  const mid = BigInt(startId);

  console.log("\n=== TAKE SIDES ===");
  await step("winner YES 2 GEN", winner.c, "take_side", [mid, "yes"], BigInt(2000000000000000000));
  await step("winner YES again (stack)", winner.c, "take_side", [mid, "yes"], BigInt(1000000000000000000));
  await step("loser NO 1 GEN", loser.c, "take_side", [mid, "no"], BigInt(1000000000000000000));
  await step("winner NO (opposite side)", winner.c, "take_side", [mid, "no"], BigInt(1), true);
  await step("host bets own market", creator.c, "take_side", [mid, "yes"], BigInt(1), true);
  await step("zero wager", loser.c, "take_side", [mid, "yes"], BigInt(0), true);

  console.log("\n=== VIEWS ===");
  try {
    const m = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [mid] }));
    console.log("  market:", m.yes_pool, m.no_pool, m.settled, m.outcome);
    if (m.yes_pool === "3000000000000000000" && m.no_pool === "1000000000000000000") ok("pools correct");
    else nok("pools correct", `${m.yes_pool}/${m.no_pool}`);
  } catch (e) { nok("get_market", e); }
  for (const [label, fn, args] of [
    ["get_total_markets", "get_total_markets", []],
    ["get_total_wagers", "get_total_wagers", []],
    ["get_total_traders", "get_total_traders", []],
    ["get_owner", "get_owner", []],
    ["get_fee_balance", "get_fee_balance", []],
    ["get_top_cats", "get_top_cats", []],
  ]) {
    try { await client.readContract({ address: CONTRACT, functionName: fn, args }); ok(label); }
    catch (e) { nok(label, String(e.shortMessage || e.message).slice(0, 150)); }
  }
  try {
    const ti = await client.readContract({ address: CONTRACT, functionName: "get_trader_info", args: [winner.a.address] });
    if (String(ti).includes("Winner")) ok("get_trader_info (checksum addr)");
    else nok("get_trader_info", ti);
  } catch (e) { nok("get_trader_info", e); }
  try {
    const tp = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_trader_positions", args: [winner.a.address] }));
    if (tp.length >= 1) ok("get_trader_positions");
    else nok("get_trader_positions", "empty");
  } catch (e) { nok("get_trader_positions", e); }

  console.log("\n=== SETTLE (yes/no) ===");
  await step("settle_market", client, "settle_market", [mid]);
  let m = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [mid] }));
  console.log(`  outcome="${m.outcome}" settled=${m.settled} attempts=${m.settle_attempts}`);
  if (m.settled && (m.outcome === "yes" || m.outcome === "no")) ok("settled yes/no");
  else nok("settled yes/no", `outcome=${m.outcome} settled=${m.settled}`);

  console.log("\n=== CLAIM ===");
  await step("settle again (already resolved)", client, "settle_market", [mid], BigInt(0), true);
  const winningSide = m.outcome;
  const winnerClient = winningSide === "yes" ? winner.c : loser.c;
  const loserClient = winningSide === "yes" ? loser.c : winner.c;
  await step("claim winner", winnerClient, "claim_payout", [mid]);
  await step("claim winner twice", winnerClient, "claim_payout", [mid], BigInt(0), true);
  await step("claim loser", loserClient, "claim_payout", [mid], BigInt(0), true);

  console.log("\n=== FEES ===");
  const fb = await client.readContract({ address: CONTRACT, functionName: "get_fee_balance", args: [] });
  console.log("  fee_balance:", fb.toString());
  if (BigInt(fb) > BigInt(0)) ok("fee_balance > 0"); else nok("fee_balance > 0", String(fb));
  await step("collect_fees non-owner", winner.c, "collect_fees", [BigInt(1)], BigInt(0), true);
  await step("collect_fees owner", client, "collect_fees", [BigInt(fb)]);
  const fb2 = await client.readContract({ address: CONTRACT, functionName: "get_fee_balance", args: [] });
  if (BigInt(fb2) === BigInt(0)) ok("fee_balance drained"); else nok("fee_balance drained", String(fb2));
  await step("collect_fees over balance", client, "collect_fees", [BigInt(1)], BigInt(0), true);

  console.log("\n=== RECLAIM GUARDS ===");
  await step("reclaim on non-void", winner.c, "reclaim_stake", [mid], BigInt(0), true);
  await step("terminal_void too early", client, "terminal_void", [mid], BigInt(0), true);
  await step("cash_out(0)", client, "cash_out", [BigInt(0)], BigInt(0), true);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:"); failures.forEach(f => console.log("  -", f)); }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
