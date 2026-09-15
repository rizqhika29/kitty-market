const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PK = "0xeb844ebb5c069eb1ef68243563db1406bc83cd6c90af7fc6478cb013348ca5f5";
const CONTRACT = "0x870a1E9e9D29507d5b40476460f6FD530a5FB4e8";

const results = [];

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });
  console.log("Account:", account.address);

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

  const writeAndWait = async (name, clientRef, fn) => {
    try {
      const txHash = await fn();
      console.log(`📝 ${name}: tx=${txHash}`);
      // Wait for finalization
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const tx = await clientRef.getTransaction({ hash: txHash });
          if (tx && tx.statusName === "FINALIZED") {
            const leader = Array.isArray(tx.consensus_data?.leader_receipt)
              ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
            const exec = leader?.execution_result || "unknown";
            const stderr = leader?.genvm_result?.stderr;
            console.log(`   → ${exec}`);
            if (stderr) console.log(`   → stderr: ${stderr.substring(0, 200)}`);
            if (leader?.calldata?.readable) console.log(`   → result: ${leader.calldata.readable.substring(0, 200)}`);
            results.push({ name, status: exec === "SUCCESS" ? "TX_SENT" : "TX_ERROR", hash: txHash, exec });
            break;
          }
          if (i % 5 === 0) process.stdout.write(".");
        } catch (e) { if (i % 5 === 0) process.stdout.write("."); }
      }
      console.log();
      // Wait for state propagation
      await new Promise(r => setTimeout(r, 15000));
      return txHash;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 120)}`);
      results.push({ name, status: "FAIL", error: e.shortMessage?.substring(0, 120) });
      return null;
    }
  };

  // ========== READ METHODS (empty state) ==========
  console.log("\n========== READ METHODS (empty state) ==========");
  await test("get_owner", () => read("get_owner"));
  await test("get_total_markets", async () => (await read("get_total_markets")).toString());
  await test("get_total_wagers", async () => (await read("get_total_wagers")).toString());
  await test("get_total_traders", async () => (await read("get_total_traders")).toString());
  await test("get_fee_balance", async () => (await read("get_fee_balance")).toString());
  await test("get_top_cats", () => read("get_top_cats"));
  await test("get_trader_info(nonexistent)", () => read("get_trader_info", ["0x0000000000000000000000000000000000000001"]));
  await test("get_trader_positions(empty)", () => read("get_trader_positions", [account.address]));

  // ========== WRITE: JOIN ==========
  console.log("\n========== WRITE: JOIN ==========");
  const account2PK = generatePrivateKey();
  const account2 = createAccount(account2PK);
  await client.request({ method: "sim_fundAccount", params: [account2.address, 1000] });
  const client2 = createClient({ chain: studionet, account: account2 });
  console.log("Account2 (creator):", account2.address);

  await writeAndWait("join(owner)", () => client.writeContract({ address: CONTRACT, functionName: "join", args: ["OwnerCat"] }));
  await writeAndWait("join(creator)", () => client2.writeContract({ address: CONTRACT, functionName: "join", args: ["CreatorCat"] }));

  await test("get_total_traders (after 2 joins)", async () => (await read("get_total_traders")).toString());
  await test("get_top_cats (after 2 joins)", () => read("get_top_cats"));
  await test("get_trader_info(owner)", () => read("get_trader_info", [account.address]));
  await test("get_trader_info(creator)", () => read("get_trader_info", [account2.address]));

  // ========== WRITE: OPEN MARKET (from account2) ==========
  console.log("\n========== WRITE: OPEN MARKET ==========");
  const closesAt = Math.floor(Date.now() / 1000) + 7200;
  await writeAndWait("open_market", () => client2.writeContract({
    address: CONTRACT, functionName: "open_market",
    args: ["Will GenLayer succeed?", "crypto", "https://example.com", BigInt(closesAt), BigInt(0), BigInt(0)]
  }));

  await test("get_total_markets (after open)", async () => (await read("get_total_markets")).toString());
  await test("get_market(0)", () => read("get_market", [0n]));

  // ========== WRITE: TAKE SIDE (from account - not creator) ==========
  console.log("\n========== WRITE: TAKE SIDE ==========");
  await writeAndWait("take_side(yes, 10 GEN)", () => client.writeContract({
    address: CONTRACT, functionName: "take_side",
    args: [0n, "yes"],
    value: BigInt(10_000_000_000_000_000_00n),
  }));

  await test("get_market(0) after bet", () => read("get_market", [0n]));
  await test("get_total_wagers after bet", async () => (await read("get_total_wagers")).toString());
  await test("get_trader_positions(owner)", () => read("get_trader_positions", [account.address]));

  // ========== WRITE: COLLECT FEES (should fail - not owner) ==========
  console.log("\n========== WRITE: COLLECT FEES ==========");
  await writeAndWait("collect_fees (expect fail)", () => client.writeContract({
    address: CONTRACT, functionName: "collect_fees", args: [BigInt(100)]
  }));

  // ========== WRITE: CASH OUT ==========
  console.log("\n========== WRITE: CASH OUT ==========");
  await writeAndWait("cash_out(0)", () => client.writeContract({
    address: CONTRACT, functionName: "cash_out", args: [BigInt(0)]
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
