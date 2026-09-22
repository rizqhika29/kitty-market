const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const CONTRACT = "0x79e4B28A91277841aC8a3e1Da9204feb564081EF";

async function main() {
  const pk = generatePrivateKey();
  const account = createAccount(pk);
  const client = createClient({ chain: studionet, account });

  const pk2 = generatePrivateKey();
  const account2 = createAccount(pk2);
  await client.request({ method: "sim_fundAccount", params: [account2.address, 1000] });
  const client2 = createClient({ chain: studionet, account: account2 });

  const pk3 = generatePrivateKey();
  const account3 = createAccount(pk3);
  await client.request({ method: "sim_fundAccount", params: [account3.address, 1000] });
  const client3 = createClient({ chain: studionet, account: account3 });

  console.log("Owner:", account.address);
  console.log("Creator:", account2.address);
  console.log("Bettor:", account3.address);

  async function sendTx(label, c, fn, args, value) {
    try {
      const h = await c.writeContract({
        address: CONTRACT,
        functionName: fn,
        args: args,
        value: value || BigInt(0),
      });
      console.log(`  ${label} tx: ${h}`);
      const receipt = await c.waitForTransactionReceipt({ hash: h, status: "FINALIZED" });
      if (!receipt) {
        // Poll manually
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const tx = await c.getTransaction({ hash: h });
          if (tx?.statusName === "FINALIZED") {
            const lr = Array.isArray(tx.consensus_data?.leader_receipt)
              ? tx.consensus_data.leader_receipt[0]
              : tx.consensus_data?.leader_receipt;
            if (lr?.execution_result === "ERROR") {
              console.log(`  ${label} FAILED:`, lr.genvm_result?.stderr?.substring(0, 200));
              return false;
            }
            console.log(`  ${label} → FINALIZED`);
            return true;
          }
          if (tx?.statusName === "REJECTED") {
            console.log(`  ${label} → REJECTED`);
            return false;
          }
        }
        console.log(`  ${label} → TIMEOUT`);
        return false;
      }
      console.log(`  ${label} → OK`);
      return true;
    } catch (e) {
      console.log(`  ${label} ERROR:`, e.shortMessage?.substring(0, 200));
      return false;
    }
  }

  let pass = 0, fail = 0;

  // ── READ ──
  console.log("\n=== READ ===");
  for (const [fn, args] of [
    ["get_owner", []],
    ["get_total_markets", []],
    ["get_total_wagers", []],
    ["get_total_traders", []],
    ["get_fee_balance", []],
    ["get_top_cats", []],
  ]) {
    try {
      const r = await client.readContract({ address: CONTRACT, functionName: fn, args });
      console.log(`  ${fn}: ${JSON.stringify(r)?.substring(0, 150)}`);
      pass++;
    } catch (e) {
      console.log(`  ${fn} FAILED:`, e.shortMessage?.substring(0, 100));
      fail++;
    }
  }

  // ── WRITE ──
  console.log("\n=== WRITE ===");

  let ok;
  ok = await sendTx("join (owner)", client, "join", ["OwnerCat3"]);
  ok ? pass++ : fail++;

  ok = await sendTx("join (creator)", client2, "join", ["CreatorCat3"]);
  ok ? pass++ : fail++;

  ok = await sendTx("join (bettor)", client3, "join", ["BettorCat"]);
  ok ? pass++ : fail++;

  // Read trader info
  console.log("\n=== READ (after join) ===");
  for (const [label, addr] of [
    ["owner", account.address],
    ["creator", account2.address],
    ["bettor", account3.address],
  ]) {
    try {
      const r = await client.readContract({ address: CONTRACT, functionName: "get_trader_info", args: [addr] });
      console.log(`  get_trader_info (${label}): ${r}`);
      pass++;
    } catch (e) {
      console.log(`  get_trader_info (${label}) FAILED:`, e.shortMessage?.substring(0, 100));
      fail++;
    }
  }

  // open_market (by creator)
  const now = Math.floor(Date.now() / 1000);
  ok = await sendTx("open_market", client2, "open_market", [
    "Will BTC hit 200k?",
    "crypto",
    "https://example.com/btc",
    BigInt(now + 86400),
    BigInt(0),
    BigInt(0),
  ]);
  ok ? pass++ : fail++;

  // get_market
  try {
    const m = await client.readContract({ address: CONTRACT, functionName: "get_market", args: [1n] });
    console.log(`  get_market(1): ${m?.substring(0, 200)}`);
    pass++;
  } catch (e) {
    console.log(`  get_market(1) FAILED:`, e.shortMessage?.substring(0, 100));
    fail++;
  }

  // take_side (owner YES)
  ok = await sendTx("take_side (owner YES 1 GEN)", client, "take_side", [1n, "yes"], BigInt(1000000000000000000));
  ok ? pass++ : fail++;

  // take_side (bettor NO)
  ok = await sendTx("take_side (bettor NO 2 GEN)", client3, "take_side", [1n, "no"], BigInt(2000000000000000000));
  ok ? pass++ : fail++;

  // get_trader_positions
  for (const [label, c, addr] of [
    ["owner", client, account.address],
    ["bettor", client3, account3.address],
  ]) {
    try {
      const r = await c.readContract({ address: CONTRACT, functionName: "get_trader_positions", args: [addr] });
      console.log(`  get_trader_positions (${label}): ${r?.substring(0, 200)}`);
      pass++;
    } catch (e) {
      console.log(`  get_trader_positions (${label}) FAILED:`, e.shortMessage?.substring(0, 100));
      fail++;
    }
  }

  // cash_out
  ok = await sendTx("cash_out", client, "cash_out", [BigInt(0)]);
  ok ? pass++ : fail++;

  // ── Summary ──
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
}

main().catch(console.error);
