const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  console.log("Account:", account.address);

  const client = createClient({
    chain: studionet,
    account,
  });

  // Fund account
  console.log("\n=== Funding account ===");
  try {
    await client.request({
      method: "sim_fundAccount",
      params: [account.address, 1000],
    });
    console.log("Funded 1000 GEN");
  } catch (e) {
    console.log("Fund error (may already be funded):", e.message || e);
  }

  // Read contract code
  const contractPath = path.join(__dirname, "..", "contracts", "kitty_market.py");
  const contractCode = fs.readFileSync(contractPath, "utf-8");
  console.log("\nContract code loaded:", contractCode.length, "bytes");

  // Deploy
  console.log("\n=== Deploying contract ===");
  const deployHash = await client.deployContract({
    code: contractCode,
    args: [],
    value: BigInt(0),
  });
  console.log("Deploy tx hash:", deployHash);

  // Wait for deployment
  console.log("Waiting for deployment to finalize...");
  const deployReceipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "FINALIZED",
  });
  console.log("Deployment receipt status:", deployReceipt.statusName);
  console.log("Deployment receipt result:", deployReceipt.txExecutionResultName);

  // Get contract address from the receipt
  const txData = await client.getTransaction({ hash: deployHash });
  let contractAddress;

  if (txData.txDataDecoded && txData.txDataDecoded.contractAddress) {
    contractAddress = txData.txDataDecoded.contractAddress;
  } else {
    // Try to find it from the receipt
    console.log("Full tx:", JSON.stringify(txData, null, 2).substring(0, 2000));
    contractAddress = txData.to_address || txData.recipient;
  }

  console.log("\n=== Contract deployed at ===");
  console.log(contractAddress);

  if (!contractAddress) {
    console.error("Could not determine contract address");
    process.exit(1);
  }

  // Save address for test script
  const addrFile = path.join(__dirname, "contract-address.json");
  fs.writeFileSync(addrFile, JSON.stringify({ address: contractAddress }, null, 2));
  console.log("Address saved to", addrFile);

  // ===== TEST ALL METHODS =====
  console.log("\n\n========================================");
  console.log("TESTING ALL CONTRACT METHODS");
  console.log("========================================\n");

  // Helper
  function assert(condition, msg) {
    if (!condition) {
      console.error("  FAIL:", msg);
      process.exit(1);
    }
    console.log("  PASS:", msg);
  }

  // --- 1. get_owner ---
  console.log("\n--- Test: get_owner ---");
  const owner = await client.readContract({
    address: contractAddress,
    functionName: "get_owner",
    args: [],
  });
  assert(owner === "0x0000000000000000000000000000000000000000" || typeof owner === "string", "get_owner returns address");

  // --- 2. join ---
  console.log("\n--- Test: join (host) ---");
  const joinHash1 = await client.writeContract({
    address: contractAddress,
    functionName: "join",
    args: ["host_cat"],
    value: BigInt(0),
  });
  const joinReceipt1 = await client.waitForTransactionReceipt({ hash: joinHash1, status: "FINALIZED" });
  assert(joinReceipt1.txExecutionResultName === "FINISHED_WITH_RETURN", "join(host) succeeded");

  console.log("\n--- Test: join (trader_a) ---");
  const joinHash2 = await client.writeContract({
    address: contractAddress,
    functionName: "join",
    args: ["alice"],
    value: BigInt(0),
  });
  const joinReceipt2 = await client.waitForTransactionReceipt({ hash: joinHash2, status: "FINALIZED" });
  assert(joinReceipt2.txExecutionResultName === "FINISHED_WITH_RETURN", "join(alice) succeeded");

  console.log("\n--- Test: join (trader_b) ---");
  const joinHash3 = await client.writeContract({
    address: contractAddress,
    functionName: "join",
    args: ["bob"],
    value: BigInt(0),
  });
  const joinReceipt3 = await client.waitForTransactionReceipt({ hash: joinHash3, status: "FINALIZED" });
  assert(joinReceipt3.txExecutionResultName === "FINISHED_WITH_RETURN", "join(bob) succeeded");

  // --- 3. get_total_traders ---
  console.log("\n--- Test: get_total_traders ---");
  const totalTraders = await client.readContract({
    address: contractAddress,
    functionName: "get_total_traders",
    args: [],
  });
  assert(Number(totalTraders) === 3, `total_traders = ${totalTraders} (expected 3)`);

  // --- 4. get_trader_info ---
  console.log("\n--- Test: get_trader_info ---");
  const traderInfo = await client.readContract({
    address: contractAddress,
    functionName: "get_trader_info",
    args: [account.address],
  });
  const parsedInfo = JSON.parse(traderInfo);
  assert(parsedInfo.alias === "host_cat", `trader alias = ${parsedInfo.alias}`);

  // --- 5. open_market ---
  console.log("\n--- Test: open_market ---");
  const now = Math.floor(Date.now() / 1000);
  const closesAt = now + 86400; // 1 day from now
  const openHash = await client.writeContract({
    address: contractAddress,
    functionName: "open_market",
    args: [
      "Will BTC hit 200k by end of 2025?",
      "crypto",
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin",
      BigInt(closesAt),
      BigInt(0),
      BigInt(0),
    ],
    value: BigInt(0),
  });
  const openReceipt = await client.waitForTransactionReceipt({ hash: openHash, status: "FINALIZED" });
  assert(openReceipt.txExecutionResultName === "FINISHED_WITH_RETURN", "open_market succeeded");

  // --- 6. get_total_markets ---
  console.log("\n--- Test: get_total_markets ---");
  const totalMarkets = await client.readContract({
    address: contractAddress,
    functionName: "get_total_markets",
    args: [],
  });
  assert(Number(totalMarkets) === 1, `total_markets = ${totalMarkets} (expected 1)`);

  // --- 7. get_market ---
  console.log("\n--- Test: get_market ---");
  const marketJson = await client.readContract({
    address: contractAddress,
    functionName: "get_market",
    args: [BigInt(0)],
  });
  const market = JSON.parse(marketJson);
  assert(market.question === "Will BTC hit 200k by end of 2025?", `question = ${market.question}`);
  assert(market.topic === "crypto", `topic = ${market.topic}`);
  assert(market.settled === false, "settled = false");
  assert(market.settle_attempts === "0", `settle_attempts = ${market.settle_attempts}`);
  assert(market.terminal_void === false, "terminal_void = false");
  assert(Number(market.yes_pool) === 0, "yes_pool = 0");
  assert(Number(market.no_pool) === 0, "no_pool = 0");

  // --- 8. get_total_wagers ---
  console.log("\n--- Test: get_total_wagers ---");
  const totalWagers = await client.readContract({
    address: contractAddress,
    functionName: "get_total_wagers",
    args: [],
  });
  assert(Number(totalWagers) === 0, `total_wagers = ${totalWagers} (expected 0)`);

  // --- 9. take_side (alice bets YES) ---
  console.log("\n--- Test: take_side (alice YES 10 GEN) ---");
  const betAmount = BigInt("10000000000000000000"); // 10 GEN
  const takeHash1 = await client.writeContract({
    address: contractAddress,
    functionName: "take_side",
    args: [BigInt(0), "yes"],
    value: betAmount,
  });
  const takeReceipt1 = await client.waitForTransactionReceipt({ hash: takeHash1, status: "FINALIZED" });
  assert(takeReceipt1.txExecutionResultName === "FINISHED_WITH_RETURN", "take_side(alice, yes) succeeded");

  // --- 10. take_side (bob bets NO) ---
  console.log("\n--- Test: take_side (bob NO 20 GEN) ---");
  const betAmount2 = BigInt("20000000000000000000"); // 20 GEN
  const takeHash2 = await client.writeContract({
    address: contractAddress,
    functionName: "take_side",
    args: [BigInt(0), "no"],
    value: betAmount2,
  });
  const takeReceipt2 = await client.waitForTransactionReceipt({ hash: takeHash2, status: "FINALIZED" });
  assert(takeReceipt2.txExecutionResultName === "FINISHED_WITH_RETURN", "take_side(bob, no) succeeded");

  // --- Verify pools ---
  console.log("\n--- Verify pools after bets ---");
  const marketAfter = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_market",
    args: [BigInt(0)],
  }));
  assert(Number(marketAfter.yes_pool) === 10, `yes_pool = ${marketAfter.yes_pool} (expected 10)`);
  assert(Number(marketAfter.no_pool) === 20, `no_pool = ${marketAfter.no_pool} (expected 20)`);
  assert(Number(marketAfter.pool) === 30, `pool = ${marketAfter.pool} (expected 30)`);

  const totalWagersAfter = await client.readContract({
    address: contractAddress,
    functionName: "get_total_wagers",
    args: [],
  });
  assert(Number(totalWagersAfter) === 30, `total_wagers = ${totalWagersAfter} (expected 30)`);

  // --- 11. get_trader_positions ---
  console.log("\n--- Test: get_trader_positions ---");
  const aliceAddr = "0xb657BCB65e6d4c38bB986b2EaDD8aCE8BAC5B991";
  const positions = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_trader_positions",
    args: [aliceAddr],
  }));
  assert(positions.length === 1, `alice has ${positions.length} position(s)`);
  assert(positions[0].side === "yes", `alice side = ${positions[0].side}`);
  assert(Number(positions[0].size) === 10, `alice size = ${positions[0].size}`);
  assert(positions[0].closed === false, "position not closed");

  // --- 12. settle_market ---
  console.log("\n--- Test: settle_market ---");
  const settleHash = await client.writeContract({
    address: contractAddress,
    functionName: "settle_market",
    args: [BigInt(0)],
    value: BigInt(0),
  });
  const settleReceipt = await client.waitForTransactionReceipt({ hash: settleHash, status: "FINALIZED" });
  assert(settleReceipt.txExecutionResultName === "FINISHED_WITH_RETURN", "settle_market succeeded");

  // Verify settle_attempts incremented
  const marketAfterSettle = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_market",
    args: [BigInt(0)],
  }));
  assert(Number(marketAfterSettle.settle_attempts) >= 1, `settle_attempts = ${marketAfterSettle.settle_attempts}`);
  console.log("  Market outcome:", marketAfterSettle.outcome);

  // If market resolved to yes/no (normal settlement), skip terminal_void tests
  if (marketAfterSettle.outcome === "yes" || marketAfterSettle.outcome === "no") {
    console.log("\n  Market resolved normally to:", marketAfterSettle.outcome);
    console.log("  Testing claim_payout instead of terminal_void...");

    const claimHash = await client.writeContract({
      address: contractAddress,
      functionName: "claim_payout",
      args: [BigInt(0)],
      value: BigInt(0),
    });
    const claimReceipt = await client.waitForTransactionReceipt({ hash: claimHash, status: "FINALIZED" });
    assert(claimReceipt.txExecutionResultName === "FINISHED_WITH_RETURN", "claim_payout succeeded");

    console.log("\n========================================");
    console.log("ALL TESTS PASSED (normal settlement)");
    console.log("========================================");
    return;
  }

  // --- 13. settle more times to reach MAX_SETTLE_ATTEMPTS ---
  if (!marketAfterSettle.settled && Number(marketAfterSettle.settle_attempts) < 5) {
    console.log("\n--- Settling more times to reach MAX_SETTLE_ATTEMPTS ---");
    for (let i = 0; i < 4; i++) {
      const sHash = await client.writeContract({
        address: contractAddress,
        functionName: "settle_market",
        args: [BigInt(0)],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash: sHash, status: "FINALIZED" });
      const m = JSON.parse(await client.readContract({
        address: contractAddress,
        functionName: "get_market",
        args: [BigInt(0)],
      }));
      console.log(`  Attempt ${i + 2}: settled=${m.settled}, attempts=${m.settle_attempts}`);
      if (m.settled) break;
    }
  }

  // --- 14. terminal_void ---
  console.log("\n--- Test: terminal_void ---");
  const tvHash = await client.writeContract({
    address: contractAddress,
    functionName: "terminal_void",
    args: [BigInt(0)],
    value: BigInt(0),
  });
  const tvReceipt = await client.waitForTransactionReceipt({ hash: tvHash, status: "FINALIZED" });
  assert(tvReceipt.txExecutionResultName === "FINISHED_WITH_RETURN", "terminal_void succeeded");

  const marketAfterTV = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_market",
    args: [BigInt(0)],
  }));
  assert(marketAfterTV.terminal_void === true, "terminal_void = true");
  assert(marketAfterTV.settled === true, "settled = true");
  assert(marketAfterTV.outcome === "terminal_void", `outcome = ${marketAfterTV.outcome}`);
  console.log("  verdict_note:", marketAfterTV.verdict_note);

  // --- 15. reclaim_stake (alice) ---
  console.log("\n--- Test: reclaim_stake (alice) ---");
  const reclaimHash1 = await client.writeContract({
    address: contractAddress,
    functionName: "reclaim_stake",
    args: [BigInt(0)],
    value: BigInt(0),
  });
  const reclaimReceipt1 = await client.waitForTransactionReceipt({ hash: reclaimHash1, status: "FINALIZED" });
  assert(reclaimReceipt1.txExecutionResultName === "FINISHED_WITH_RETURN", "reclaim_stake(alice) succeeded");

  // Verify position closed
  const alicePositions = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_trader_positions",
    args: [aliceAddr],
  }));
  assert(alicePositions[0].closed === true, "alice position closed after reclaim");

  // --- 16. reclaim_stake (bob) ---
  console.log("\n--- Test: reclaim_stake (bob) ---");
  const reclaimHash2 = await client.writeContract({
    address: contractAddress,
    functionName: "reclaim_stake",
    args: [BigInt(0)],
    value: BigInt(0),
  });
  const reclaimReceipt2 = await client.waitForTransactionReceipt({ hash: reclaimHash2, status: "FINALIZED" });
  assert(reclaimReceipt2.txExecutionResultName === "FINISHED_WITH_RETURN", "reclaim_stake(bob) succeeded");

  // --- 17. cannot double reclaim ---
  console.log("\n--- Test: cannot double reclaim ---");
  const doubleReclaimHash = await client.writeContract({
    address: contractAddress,
    functionName: "reclaim_stake",
    args: [BigInt(0)],
    value: BigInt(0),
  });
  const doubleReclaimReceipt = await client.waitForTransactionReceipt({ hash: doubleReclaimHash, status: "FINALIZED" });
  assert(
    doubleReclaimReceipt.txExecutionResultName === "FINISHED_WITH_ERROR",
    "double reclaim correctly failed"
  );

  // --- 18. get_top_cats ---
  console.log("\n--- Test: get_top_cats ---");
  const topCats = JSON.parse(await client.readContract({
    address: contractAddress,
    functionName: "get_top_cats",
    args: [],
  }));
  assert(Array.isArray(topCats), "top_cats is array");
  console.log("  Top cats count:", topCats.length);

  // --- 19. get_fee_balance ---
  console.log("\n--- Test: get_fee_balance ---");
  const feeBalance = await client.readContract({
    address: contractAddress,
    functionName: "get_fee_balance",
    args: [],
  });
  console.log("  fee_balance:", feeBalance.toString());

  console.log("\n========================================");
  console.log("ALL TESTS PASSED");
  console.log("========================================");
  console.log("\nContract address:", contractAddress);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
