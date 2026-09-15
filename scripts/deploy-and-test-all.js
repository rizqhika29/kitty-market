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
  try {
    await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
    console.log("Funded 1000 GEN");
  } catch (e) {
    console.log("Fund error:", e.message?.substring(0, 100));
  }

  // Deploy kitty_market contract
  const contractPath = path.join(__dirname, "..", "contracts", "kitty_market.py");
  const contractCode = fs.readFileSync(contractPath, "utf-8");

  console.log("\nDeploying kitty_market contract...");
  const hash = await client.deployContract({
    code: new TextEncoder().encode(contractCode),
    args: [],
    value: BigInt(0),
  });
  console.log("Deploy hash:", hash);

  // Wait for finalization
  console.log("Waiting for finalization...");
  let contractAddress = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await client.getTransaction({ hash });
      if (tx && tx.statusName === "FINALIZED") {
        contractAddress = tx.data?.contract_address || tx.recipient || tx.to_address;
        console.log("FINALIZED!");
        console.log("Contract address:", contractAddress);
        console.log("Execution result:", tx.txExecutionResultName);
        break;
      }
      if (i % 10 === 0) process.stdout.write(".");
    } catch (e) {
      if (i % 10 === 0) process.stdout.write(".");
    }
  }

  if (!contractAddress) {
    console.error("Deployment failed or timed out!");
    process.exit(1);
  }

  // Save address
  fs.writeFileSync(
    path.join(__dirname, "contract-address.json"),
    JSON.stringify({ address: contractAddress, privateKey: pk, deployHash: hash }, null, 2)
  );

  // Wait a moment for state to settle
  console.log("\nWaiting 10s for state...");
  await new Promise(r => setTimeout(r, 10000));

  // === TEST ALL READ METHODS ===
  console.log("\n\n========== TESTING ALL READ METHODS ==========\n");

  // 1. get_owner
  try {
    const owner = await client.readContract({ address: contractAddress, functionName: "get_owner", args: [] });
    console.log("✅ get_owner:", owner);
  } catch (e) {
    console.log("❌ get_owner:", e.shortMessage?.substring(0, 100));
  }

  // 2. get_total_markets
  try {
    const total = await client.readContract({ address: contractAddress, functionName: "get_total_markets", args: [] });
    console.log("✅ get_total_markets:", total.toString());
  } catch (e) {
    console.log("❌ get_total_markets:", e.shortMessage?.substring(0, 100));
  }

  // 3. get_total_wagers
  try {
    const wagers = await client.readContract({ address: contractAddress, functionName: "get_total_wagers", args: [] });
    console.log("✅ get_total_wagers:", wagers.toString());
  } catch (e) {
    console.log("❌ get_total_wagers:", e.shortMessage?.substring(0, 100));
  }

  // 4. get_total_traders
  try {
    const traders = await client.readContract({ address: contractAddress, functionName: "get_total_traders", args: [] });
    console.log("✅ get_total_traders:", traders.toString());
  } catch (e) {
    console.log("❌ get_total_traders:", e.shortMessage?.substring(0, 100));
  }

  // 5. get_fee_balance
  try {
    const fee = await client.readContract({ address: contractAddress, functionName: "get_fee_balance", args: [] });
    console.log("✅ get_fee_balance:", fee.toString());
  } catch (e) {
    console.log("❌ get_fee_balance:", e.shortMessage?.substring(0, 100));
  }

  // 6. get_top_cats (empty)
  try {
    const topCats = await client.readContract({ address: contractAddress, functionName: "get_top_cats", args: [] });
    console.log("✅ get_top_cats:", topCats);
  } catch (e) {
    console.log("❌ get_top_cats:", e.shortMessage?.substring(0, 100));
  }

  // === TEST ALL WRITE METHODS ===
  console.log("\n\n========== TESTING ALL WRITE METHODS ==========\n");

  // 1. join
  let joinHash;
  try {
    joinHash = await client.writeContract({
      address: contractAddress,
      functionName: "join",
      args: ["TestCat"],
    });
    console.log("📝 join tx:", joinHash);
  } catch (e) {
    console.log("❌ join:", e.shortMessage?.substring(0, 100));
  }

  // Wait for join to finalize
  if (joinHash) {
    console.log("Waiting for join to finalize...");
    try {
      const joinReceipt = await client.waitForTransactionReceipt({ hash: joinHash, status: "ACCEPTED" });
      console.log("✅ join finalized:", joinReceipt.statusName);
    } catch (e) {
      console.log("⚠️ join receipt:", e.shortMessage?.substring(0, 100));
    }
    await new Promise(r => setTimeout(r, 10000));
  }

  // 2. get_total_traders after join
  try {
    const traders = await client.readContract({ address: contractAddress, functionName: "get_total_traders", args: [] });
    console.log("✅ get_total_traders after join:", traders.toString());
  } catch (e) {
    console.log("❌ get_total_traders:", e.shortMessage?.substring(0, 100));
  }

  // 3. get_top_cats after join
  try {
    const topCats = await client.readContract({ address: contractAddress, functionName: "get_top_cats", args: [] });
    console.log("✅ get_top_cats:", topCats);
  } catch (e) {
    console.log("❌ get_top_cats:", e.shortMessage?.substring(0, 100));
  }

  // 4. get_trader_info
  try {
    const info = await client.readContract({
      address: contractAddress,
      functionName: "get_trader_info",
      args: [account.address],
    });
    console.log("✅ get_trader_info:", info);
  } catch (e) {
    console.log("❌ get_trader_info:", e.shortMessage?.substring(0, 100));
  }

  // 5. get_trader_positions (empty)
  try {
    const positions = await client.readContract({
      address: contractAddress,
      functionName: "get_trader_positions",
      args: [account.address],
    });
    console.log("✅ get_trader_positions:", positions);
  } catch (e) {
    console.log("❌ get_trader_positions:", e.shortMessage?.substring(0, 100));
  }

  // 6. open_market
  const closesAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  let openMarketHash;
  try {
    openMarketHash = await client.writeContract({
      address: contractAddress,
      functionName: "open_market",
      args: ["Will it rain tomorrow?", "weather", "https://example.com/weather", BigInt(closesAt), BigInt(0), BigInt(0)],
    });
    console.log("📝 open_market tx:", openMarketHash);
  } catch (e) {
    console.log("❌ open_market:", e.shortMessage?.substring(0, 100));
  }

  if (openMarketHash) {
    console.log("Waiting for open_market to finalize...");
    try {
      await client.waitForTransactionReceipt({ hash: openMarketHash, status: "ACCEPTED" });
      console.log("✅ open_market finalized");
    } catch (e) {
      console.log("⚠️ open_market receipt:", e.shortMessage?.substring(0, 100));
    }
    await new Promise(r => setTimeout(r, 10000));
  }

  // 7. get_total_markets after open_market
  try {
    const total = await client.readContract({ address: contractAddress, functionName: "get_total_markets", args: [] });
    console.log("✅ get_total_markets after open:", total.toString());
  } catch (e) {
    console.log("❌ get_total_markets:", e.shortMessage?.substring(0, 100));
  }

  // 8. get_market(0)
  try {
    const market = await client.readContract({ address: contractAddress, functionName: "get_market", args: [BigInt(0)] });
    console.log("✅ get_market(0):", market);
  } catch (e) {
    console.log("❌ get_market(0):", e.shortMessage?.substring(0, 100));
  }

  // 9. collect_fees (should fail - not owner)
  try {
    const collectHash = await client.writeContract({
      address: contractAddress,
      functionName: "collect_fees",
      args: [BigInt(100)],
    });
    console.log("📝 collect_fees tx:", collectHash);
  } catch (e) {
    console.log("❌ collect_fees (expected fail):", e.shortMessage?.substring(0, 100));
  }

  console.log("\n\n========== ALL TESTS COMPLETE ==========");
  console.log("Contract address:", contractAddress);
  console.log("Saved to scripts/contract-address.json");
}

main().catch(console.error);
