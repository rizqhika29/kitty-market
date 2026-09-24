const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const results = [];

function ok(name) { results.push({ name, pass: true }); console.log(`  PASS ${name}`); }
function nok(name, e) { results.push({ name, pass: false, err: String(e).substring(0, 150) }); console.log(`  FAIL ${name}: ${e}`); }
function skip(name, reason) { results.push({ name, pass: "skip", reason }); console.log(`  SKIP ${name}: ${reason}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTx(label, c, fn, args, value) {
  try {
    const h = await c.writeContract({ address: CONTRACT, functionName: fn, args, value: value || BigInt(0) });
    console.log(`  ${label} tx: ${h}`);
    for (let i = 0; i < 80; i++) {
      await sleep(3000);
      try {
        const tx = await c.getTransaction({ hash: h });
        if (tx?.statusName === "FINALIZED") {
          const lr = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
          if (lr?.execution_result === "ERROR") {
            console.log(`  ${label} ERROR: ${lr.genvm_result?.stderr?.substring(0, 200)}`);
            return { pass: false, hash: h, error: lr.genvm_result?.stderr };
          }
          console.log(`  ${label} FINALIZED`);
          return { pass: true, hash: h };
        }
        if (tx?.statusName === "REJECTED") { console.log(`  ${label} REJECTED`); return { pass: false, hash: h }; }
      } catch (e) {}
    }
    console.log(`  ${label} TIMEOUT`);
    return { pass: false, hash: h, error: "timeout" };
  } catch (e) {
    console.log(`  ${label} ERR: ${e.shortMessage?.substring(0, 200)}`);
    return { pass: false, error: e.shortMessage };
  }
}

async function read(client, fn, args) {
  return client.readContract({ address: CONTRACT, functionName: fn, args });
}

let CONTRACT = null;

async function main() {
  const pk1 = generatePrivateKey();
  const host = createAccount(pk1);
  const client = createClient({ chain: studionet, account: host });

  const pk2 = generatePrivateKey();
  const creator = createAccount(pk2);
  await client.request({ method: "sim_fundAccount", params: [creator.address, 1000] });
  const client2 = createClient({ chain: studionet, account: creator });

  const pk3 = generatePrivateKey();
  const bettor = createAccount(pk3);
  await client.request({ method: "sim_fundAccount", params: [bettor.address, 1000] });
  const client3 = createClient({ chain: studionet, account: bettor });

  console.log("Host:", host.address);
  console.log("Creator:", creator.address);
  console.log("Bettor:", bettor.address);

  // ── DEPLOY ──
  console.log("\n=== DEPLOY ===");
  const code = fs.readFileSync(path.join(__dirname, "..", "contracts", "kitty_market.py"), "utf-8");
  const deployHash = await client.deployContract({
    code: new TextEncoder().encode(code),
    args: [creator.address],
    value: BigInt(0),
  });
  console.log("Deploy tx:", deployHash);

  let deployed = false;
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    try {
      const tx = await client.getTransaction({ hash: deployHash });
      if (tx?.statusName === "FINALIZED") {
        const lr = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
        if (lr?.execution_result === "ERROR") {
          console.log("DEPLOY FAILED:", lr.genvm_result?.stderr?.substring(0, 500));
          process.exit(1);
        }
        CONTRACT = tx.data?.contract_address || tx.recipient;
        deployed = true;
        break;
      }
    } catch (e) {}
    if (i % 10 === 0) console.log(`  waiting deploy... (${i * 3}s)`);
  }
  if (!deployed) { console.log("DEPLOY TIMEOUT"); process.exit(1); }
  console.log("Contract:", CONTRACT);
  console.log("Explorer:", `https://explorer-studio.genlayer.com/contracts/${CONTRACT}`);

  // ── READ baseline ──
  console.log("\n=== READ baseline ===");
  try {
    const owner = await read(client, "get_owner", []);
    ok("get_owner"); console.log("  owner:", owner);
  } catch (e) { nok("get_owner", e); }

  try {
    const tm = await read(client, "get_total_markets", []);
    ok("get_total_markets"); console.log("  total:", tm.toString());
  } catch (e) { nok("get_total_markets", e); }

  try {
    const tt = await read(client, "get_total_traders", []);
    ok("get_total_traders"); console.log("  total:", tt.toString());
  } catch (e) { nok("get_total_traders", e); }

  try {
    const fb = await read(client, "get_fee_balance", []);
    ok("get_fee_balance"); console.log("  fee:", fb.toString());
  } catch (e) { nok("get_fee_balance", e); }

  try {
    const tw = await read(client, "get_total_wagers", []);
    ok("get_total_wagers"); console.log("  wagers:", tw.toString());
  } catch (e) { nok("get_total_wagers", e); }

  try {
    const tc = await read(client, "get_top_cats", []);
    ok("get_top_cats");
  } catch (e) { nok("get_top_cats", e); }

  // ── JOIN ──
  console.log("\n=== JOIN ===");
  let r = await sendTx("join host", client2, "join", ["CreatorCat"]);
  r.pass ? ok("join host") : nok("join host", r.error);

  r = await sendTx("join bettor", client3, "join", ["BettorCat"]);
  r.pass ? ok("join bettor") : nok("join bettor", r.error);

  r = await sendTx("join host2", client, "join", ["HostCat"]);
  r.pass ? ok("join host2") : nok("join host2", r.error);

  // ── READ trader info ──
  console.log("\n=== READ trader info ===");
  try {
    const info = await read(client2, "get_trader_info", [creator.address]);
    ok("get_trader_info (creator)"); console.log("  ", info);
  } catch (e) { nok("get_trader_info (creator)", e); }

  try {
    const info = await read(client3, "get_trader_info", [bettor.address]);
    ok("get_trader_info (bettor)"); console.log("  ", info);
  } catch (e) { nok("get_trader_info (bettor)", e); }

  // ── OPEN MARKET (invalid URL to force void) ──
  console.log("\n=== OPEN MARKET ===");
  const now = Math.floor(Date.now() / 1000);
  r = await sendTx("open_market", client2, "open_market", [
    "Will BTC hit 200k?", "crypto", "https://invalid.evidence.test/down", BigInt(now + 3600), BigInt(0), BigInt(0),
  ]);
  r.pass ? ok("open_market") : nok("open_market", r.error);

  // ── READ market ──
  console.log("\n=== READ market ===");
  try {
    const m = JSON.parse(await read(client, "get_market", [0n]));
    ok("get_market");
    console.log("  question:", m.question);
    console.log("  settled:", m.settled, "terminal_void:", m.terminal_void, "attempts:", m.settle_attempts);
  } catch (e) { nok("get_market", e); }

  // ── TAKE SIDE ──
  console.log("\n=== TAKE SIDE ===");
  r = await sendTx("take_side host YES 1 GEN", client, "take_side", [0n, "yes"], BigInt(1000000000000000000));
  r.pass ? ok("take_side YES") : nok("take_side YES", r.error);

  r = await sendTx("take_side bettor NO 2 GEN", client3, "take_side", [0n, "no"], BigInt(2000000000000000000));
  r.pass ? ok("take_side NO") : nok("take_side NO", r.error);

  // ── READ positions ──
  console.log("\n=== READ positions ===");
  try {
    const p = JSON.parse(await read(client, "get_trader_positions", [host.address]));
    ok("get_trader_positions host"); console.log("  ", JSON.stringify(p));
  } catch (e) { nok("get_trader_positions host", e); }

  try {
    const p = JSON.parse(await read(client3, "get_trader_positions", [bettor.address]));
    ok("get_trader_positions bettor"); console.log("  ", JSON.stringify(p));
  } catch (e) { nok("get_trader_positions bettor", e); }

  // ── SETTLE 5 TIMES (void) ──
  console.log("\n=== SETTLE 5 TIMES ===");
  for (let i = 1; i <= 5; i++) {
    r = await sendTx(`settle_market #${i}`, client, "settle_market", [0n]);
    r.pass ? ok(`settle #${i}`) : nok(`settle #${i}`, r.error);

    try {
      const m = JSON.parse(await read(client, "get_market", [0n]));
      console.log(`  attempt=${m.settle_attempts} settled=${m.settled} outcome="${m.outcome}"`);
      if (m.settled === true) {
        console.log("  BUG: settled=true after void! terminal_void unreachable!");
        nok("settle_stays_unresolved", "market resolved on void");
        break;
      }
    } catch (e) { nok(`read after settle #${i}`, e); }
  }

  // Verify not resolved
  try {
    const m = JSON.parse(await read(client, "get_market", [0n]));
    if (m.settled === false && parseInt(m.settle_attempts) >= 5) {
      ok("market_unresolved_after_5_voids");
    } else {
      nok("market_unresolved_after_5_voids", `settled=${m.settled} attempts=${m.settle_attempts}`);
    }
  } catch (e) { nok("market_unresolved_after_5_voids", e); }

  // ── TERMINAL VOID ──
  console.log("\n=== TERMINAL VOID ===");
  r = await sendTx("terminal_void", client, "terminal_void", [0n]);
  r.pass ? ok("terminal_void") : nok("terminal_void", r.error);

  try {
    const m = JSON.parse(await read(client, "get_market", [0n]));
    console.log("  settled:", m.settled, "terminal_void:", m.terminal_void, "outcome:", m.outcome);
    if (m.terminal_void === true && m.settled === true && m.outcome === "terminal_void") {
      ok("terminal_void_state");
    } else {
      nok("terminal_void_state", JSON.stringify(m));
    }
  } catch (e) { nok("terminal_void_state", e); }

  // ── RECLAIM STAKE ──
  console.log("\n=== RECLAIM STAKE ===");
  r = await sendTx("reclaim host", client, "reclaim_stake", [0n]);
  r.pass ? ok("reclaim host") : nok("reclaim host", r.error);

  r = await sendTx("reclaim bettor", client3, "reclaim_stake", [0n]);
  r.pass ? ok("reclaim bettor") : nok("reclaim bettor", r.error);

  // ── CASH OUT (fee test) ──
  console.log("\n=== CASH OUT ===");
  r = await sendTx("cash_out", client, "cash_out", [BigInt(0)]);
  r.pass ? ok("cash_out") : nok("cash_out", r.error);

  // ── READ top cats ──
  console.log("\n=== READ top cats ===");
  try {
    const cats = JSON.parse(await read(client, "get_top_cats", []));
    ok("get_top_cats"); console.log("  ", JSON.stringify(cats)?.substring(0, 300));
  } catch (e) { nok("get_top_cats", e); }

  // ── SUMMARY ──
  const pass = results.filter(r => r.pass === true).length;
  const fail = results.filter(r => r.pass === false).length;
  const skipc = results.filter(r => r.pass === "skip").length;

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail} failed, ${skipc} skipped`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`Explorer: https://explorer-studio.genlayer.com/contracts/${CONTRACT}`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\nFAILED TESTS:");
    results.filter(r => r.pass === false).forEach(r => console.log(`  - ${r.name}: ${r.err}`));
  }
}

main().catch(console.error);
