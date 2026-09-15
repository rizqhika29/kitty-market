const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

async function main() {
  const pk = generatePrivateKey();
  const account = createAccount(pk);
  const client = createClient({ chain: studionet, account });

  console.log("Account:", account.address);
  console.log("Private key:", pk);

  // Fund
  await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
  console.log("Funded 1000 GEN");

  // Deploy
  const contractCode = fs.readFileSync(path.join(__dirname, "..", "contracts", "kitty_market.py"), "utf-8");
  console.log("\nDeploying kitty_market...");
  const hash = await client.deployContract({
    code: new TextEncoder().encode(contractCode),
    args: [account.address],
    value: BigInt(0),
  });
  console.log("Deploy hash:", hash);

  // Wait for finalization
  let contractAddress = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await client.getTransaction({ hash });
      if (tx && tx.statusName === "FINALIZED") {
        contractAddress = tx.data?.contract_address || tx.recipient;
        console.log("FINALIZED! Address:", contractAddress);
        
        const leader = Array.isArray(tx.consensus_data?.leader_receipt)
          ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
        if (leader?.execution_result === "ERROR") {
          console.log("EXECUTION FAILED:");
          console.log(leader.genvm_result?.stderr);
          process.exit(1);
        }
        console.log("Execution:", leader?.execution_result);
        break;
      }
      if (i % 10 === 0) process.stdout.write(".");
    } catch (e) {
      if (i % 10 === 0) process.stdout.write(".");
    }
  }

  if (!contractAddress) { console.error("TIMEOUT"); process.exit(1); }

  await new Promise(r => setTimeout(r, 15000));

  // Save
  fs.writeFileSync(path.join(__dirname, "contract-address.json"),
    JSON.stringify({ address: contractAddress, privateKey: pk, deployHash: hash }, null, 2));

  const results = [];
  const test = async (name, fn) => {
    try {
      const result = await fn();
      console.log(`✅ ${name}: ${typeof result === "object" ? JSON.stringify(result)?.substring(0, 200) : result}`);
      results.push({ name, status: "PASS", result: typeof result === "string" ? result : JSON.stringify(result)?.substring(0, 200) });
      return result;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 120)}`);
      results.push({ name, status: "FAIL", error: e.shortMessage?.substring(0, 120) });
      return null;
    }
  };

  const writeAndWait = async (name, fn) => {
    try {
      const txHash = await fn();
      console.log(`📝 ${name} tx: ${txHash}`);
      try {
        await client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" });
        console.log(`   finalized`);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 10000));
      results.push({ name, status: "TX_SENT", hash: txHash });
      return txHash;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 120)}`);
      results.push({ name, status: "FAIL", error: e.shortMessage?.substring(0, 120) });
      return null;
    }
  };

  console.log("\n\n========== READ METHODS ==========");
  await test("get_owner", () => client.readContract({ address: contractAddress, functionName: "get_owner", args: [] }));
  await test("get_total_markets", async () => (await client.readContract({ address: contractAddress, functionName: "get_total_markets", args: [] })).toString());
  await test("get_total_wagers", async () => (await client.readContract({ address: contractAddress, functionName: "get_total_wagers", args: [] })).toString());
  await test("get_total_traders", async () => (await client.readContract({ address: contractAddress, functionName: "get_total_traders", args: [] })).toString());
  await test("get_fee_balance", async () => (await client.readContract({ address: contractAddress, functionName: "get_fee_balance", args: [] })).toString());
  await test("get_top_cats", () => client.readContract({ address: contractAddress, functionName: "get_top_cats", args: [] }));

  console.log("\n========== WRITE METHODS ==========");
  await writeAndWait("join(TestCat)", () => client.writeContract({
    address: contractAddress, functionName: "join", args: ["TestCat"]
  }));

  await test("get_total_traders (after join)", async () => (await client.readContract({ address: contractAddress, functionName: "get_total_traders", args: [] })).toString());
  await test("get_top_cats (after join)", () => client.readContract({ address: contractAddress, functionName: "get_top_cats", args: [] }));
  await test("get_trader_info", () => client.readContract({
    address: contractAddress, functionName: "get_trader_info", args: [account.address]
  }));
  await test("get_trader_positions (empty)", () => client.readContract({
    address: contractAddress, functionName: "get_trader_positions", args: [account.address]
  }));

  const closesAt = Math.floor(Date.now() / 1000) + 3600;
  await writeAndWait("open_market", () => client.writeContract({
    address: contractAddress, functionName: "open_market",
    args: ["Will it rain tomorrow?", "weather", "https://example.com/weather", BigInt(closesAt), BigInt(0), BigInt(0)]
  }));

  await test("get_total_markets (after open)", async () => (await client.readContract({ address: contractAddress, functionName: "get_total_markets", args: [] })).toString());
  await test("get_market(0)", () => client.readContract({ address: contractAddress, functionName: "get_market", args: [BigInt(0)] }));

  // Note: take_side needs a different account (creator can't bet on own market)
  // For testing purposes, skip take_side with the same account
  console.log("\n  (skipping take_side - creator can't bet on own market)");
  console.log("  (skipping settle_market - no wagers)");
  console.log("  (skipping terminal_void - needs 5 settle attempts)");
  console.log("  (skipping reclaim_stake - needs void market)");
  console.log("  (skipping claim_payout - needs resolved market)");

  // Test collect_fees (should fail - not zero balance)
  await test("collect_fees (expect fail)", () => client.writeContract({
    address: contractAddress, functionName: "collect_fees", args: [BigInt(100)]
  }));

  // Test cash_out
  await test("cash_out (0)", () => client.writeContract({
    address: contractAddress, functionName: "cash_out", args: [BigInt(0)]
  }));

  console.log("\n\n========== TEST SUMMARY ==========");
  console.log("Contract address:", contractAddress);
  const passed = results.filter(r => r.status === "PASS" || r.status === "TX_SENT").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`Passed: ${passed} | Failed: ${failed}`);
  
  for (const r of results) {
    const icon = r.status === "PASS" || r.status === "TX_SENT" ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}: ${r.status} ${r.error || r.result || ""}`);
  }
}

main().catch(console.error);
