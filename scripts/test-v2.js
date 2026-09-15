const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const results = [];

async function main() {
  const pk = generatePrivateKey();
  const account = createAccount(pk);
  const client = createClient({ chain: studionet, account });

  const account2PK = generatePrivateKey();
  const account2 = createAccount(account2PK);
  await client.request({ method: "sim_fundAccount", params: [account2.address, 1000] });
  const client2 = createClient({ chain: studionet, account: account2 });

  console.log("Account1 (bettor):", account.address);
  console.log("Account2 (creator):", account2.address);

  // Deploy
  const contractCode = fs.readFileSync(path.join(__dirname, "..", "contracts", "kitty_market.py"), "utf-8");
  console.log("\nDeploying...");
  const deployHash = await client.deployContract({
    code: new TextEncoder().encode(contractCode),
    args: [account.address],
    value: BigInt(0),
  });

  let CONTRACT = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await client.getTransaction({ hash: deployHash });
      if (tx && tx.statusName === "FINALIZED") {
        CONTRACT = tx.data?.contract_address || tx.recipient;
        const leader = Array.isArray(tx.consensus_data?.leader_receipt)
          ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
        if (leader?.execution_result === "ERROR") {
          console.log("DEPLOY FAILED:");
          console.log(leader.genvm_result?.stderr);
          process.exit(1);
        }
        console.log("Deployed:", CONTRACT);
        break;
      }
      if (i % 10 === 0) process.stdout.write(".");
    } catch (e) { if (i % 10 === 0) process.stdout.write("."); }
  }

  if (!CONTRACT) { console.error("TIMEOUT"); process.exit(1); }
  await new Promise(r => setTimeout(r, 15000));

  fs.writeFileSync(path.join(__dirname, "contract-address.json"),
    JSON.stringify({ address: CONTRACT, privateKey: pk }, null, 2));

  const read = (fn, args = []) => client.readContract({ address: CONTRACT, functionName: fn, args });

  const test = async (name, fn) => {
    try {
      const result = await fn();
      const str = typeof result === "object" ? JSON.stringify(result) : String(result);
      console.log(`✅ ${name}: ${str.substring(0, 300)}`);
      results.push({ name, status: "PASS", result: str.substring(0, 200) });
      return result;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 120)}`);
      results.push({ name, status: "FAIL", error: e.shortMessage?.substring(0, 120) });
      return null;
    }
  };

  const writeAndWait = async (name, writeFn) => {
    try {
      const txHash = await writeFn();
      console.log(`📝 ${name}: tx=${txHash}`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const tx = await client.getTransaction({ hash: txHash });
          if (tx && tx.statusName === "FINALIZED") {
            const leader = Array.isArray(tx.consensus_data?.leader_receipt)
              ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
            const exec = leader?.execution_result || "unknown";
            console.log(`   → ${exec}`);
            if (leader?.genvm_result?.stderr) console.log(`   stderr: ${leader.genvm_result.stderr.substring(0, 300)}`);
            if (leader?.calldata?.readable) console.log(`   result: ${leader.calldata.readable.substring(0, 200)}`);
            results.push({ name, status: exec === "SUCCESS" ? "TX_SENT" : "TX_ERROR", hash: txHash, exec });
            break;
          }
          if (i % 5 === 0) process.stdout.write(".");
        } catch (e) { if (i % 5 === 0) process.stdout.write("."); }
      }
      console.log();
      await new Promise(r => setTimeout(r, 15000));
      return txHash;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 120)}`);
      results.push({ name, status: "FAIL", error: e.shortMessage?.substring(0, 120) });
      return null;
    }
  };

  // ========== READ METHODS ==========
  console.log("\n========== READ METHODS ==========");
  await test("get_owner", () => read("get_owner"));
  await test("get_total_markets", async () => (await read("get_total_markets")).toString());
  await test("get_total_wagers", async () => (await read("get_total_wagers")).toString());
  await test("get_total_traders", async () => (await read("get_total_traders")).toString());
  await test("get_fee_balance", async () => (await read("get_fee_balance")).toString());
  await test("get_top_cats", () => read("get_top_cats"));
  await test("get_trader_info(nonexistent)", () => read("get_trader_info", ["0x0000000000000000000000000000000000000001"]));

  // ========== WRITE: JOIN ==========
  console.log("\n========== WRITE: JOIN ==========");
  await writeAndWait("join(bettor)", () => client.writeContract({ address: CONTRACT, functionName: "join", args: ["BettorCat"] }));
  await writeAndWait("join(creator)", () => client2.writeContract({ address: CONTRACT, functionName: "join", args: ["CreatorCat"] }));

  await test("get_total_traders (after 2 joins)", async () => (await read("get_total_traders")).toString());
  await test("get_top_cats (after joins)", () => read("get_top_cats"));
  await test("get_trader_info(bettor)", () => read("get_trader_info", [account.address]));
  await test("get_trader_positions(bettor)", () => read("get_trader_positions", [account.address]));

  // ========== WRITE: OPEN MARKET (from creator) ==========
  console.log("\n========== WRITE: OPEN MARKET ==========");
  const closesAt = Math.floor(Date.now() / 1000) + 7200;
  await writeAndWait("open_market", () => client2.writeContract({
    address: CONTRACT, functionName: "open_market",
    args: ["Will GenLayer succeed?", "crypto", "https://example.com", BigInt(closesAt), BigInt(0), BigInt(0)]
  }));

  await test("get_total_markets", async () => (await read("get_total_markets")).toString());
  await test("get_market(0)", () => read("get_market", [0n]));

  // ========== WRITE: TAKE SIDE (from bettor, not creator) ==========
  console.log("\n========== WRITE: TAKE SIDE ==========");
  await writeAndWait("take_side(yes, 10 GEN)", () => client.writeContract({
    address: CONTRACT, functionName: "take_side",
    args: [0n, "yes"],
    value: BigInt(10_000_000_000_000_000_00n),
  }));

  await test("get_market(0) after bet", () => read("get_market", [0n]));
  await test("get_total_wagers", async () => (await read("get_total_wagers")).toString());
  await test("get_trader_positions(bettor)", () => read("get_trader_positions", [account.address]));

  // ========== WRITE: CASH OUT ==========
  console.log("\n========== WRITE: CASH OUT ==========");
  await writeAndWait("cash_out(0)", () => client.writeContract({
    address: CONTRACT, functionName: "cash_out", args: [BigInt(0)]
  }));

  // ========== WRITE: COLLECT FEES ==========
  console.log("\n========== WRITE: COLLECT FEES ==========");
  await writeAndWait("collect_fees (from creator)", () => client2.writeContract({
    address: CONTRACT, functionName: "collect_fees", args: [BigInt(100)]
  }));

  // ========== SUMMARY ==========
  console.log("\n\n========== SUMMARY ==========");
  console.log("Contract:", CONTRACT);
  const passed = results.filter(r => r.status === "PASS" || r.status === "TX_SENT").length;
  const failed = results.filter(r => r.status === "FAIL" || r.status === "TX_ERROR").length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  for (const r of results) {
    const icon = r.status === "PASS" || r.status === "TX_SENT" ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}: ${r.status}`);
    if (r.error) console.log(`     ${r.error.substring(0, 100)}`);
  }
}

main().catch(console.error);
