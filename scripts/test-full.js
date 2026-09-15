const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

async function main() {
  const pk = "0xeb844ebb5c069eb1ef68243563db1406bc83cd6c90af7fc6478cb013348ca5f5";
  const account = createAccount(pk);
  const client = createClient({ chain: studionet, account });

  const CONTRACT = "0x870a1E9e9D29507d5b40476460f6FD530a5FB4e8";
  console.log("Contract:", CONTRACT);
  console.log("Account:", account.address);

  const read = (fn, args = []) => client.readContract({ address: CONTRACT, functionName: fn, args, transactionHashVariant: "latest-final" });
  const readNF = (fn, args = []) => client.readContract({ address: CONTRACT, functionName: fn, args, transactionHashVariant: "latest-nonfinal" });

  const writeAndWait = async (name, fn, args) => {
    try {
      const txHash = await client.writeContract({ address: CONTRACT, functionName: fn, args });
      console.log(`📝 ${name}: ${txHash}`);
      
      // Get receipt to check execution
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const tx = await client.getTransaction({ hash: txHash });
          if (tx && tx.statusName === "FINALIZED") {
            const leader = Array.isArray(tx.consensus_data?.leader_receipt)
              ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
            console.log(`   FINALIZED, execution: ${leader?.execution_result}`);
            if (leader?.genvm_result?.stderr) {
              console.log(`   stderr: ${leader.genvm_result.stderr.substring(0, 300)}`);
            }
            if (leader?.calldata?.readable) {
              console.log(`   result: ${leader.calldata.readable.substring(0, 200)}`);
            }
            break;
          }
          if (i % 5 === 0) process.stdout.write(".");
        } catch (e) {
          if (i % 5 === 0) process.stdout.write(".");
        }
      }
      console.log();
      
      // Extra wait for state propagation
      await new Promise(r => setTimeout(r, 15000));
      return txHash;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 150)}`);
      return null;
    }
  };

  const readTest = async (name, fn, args = []) => {
    try {
      const result = await read(fn, args);
      const str = typeof result === "object" ? JSON.stringify(result) : String(result);
      console.log(`✅ ${name}: ${str.substring(0, 300)}`);
      return result;
    } catch (e) {
      console.log(`❌ ${name}: ${e.shortMessage?.substring(0, 100)}`);
      return null;
    }
  };

  // Check existing state
  console.log("\n=== CURRENT STATE ===");
  await readTest("get_owner");
  await readTest("get_total_markets");
  await readTest("get_total_traders");
  await readTest("get_total_wagers");
  await readTest("get_fee_balance");
  await readTest("get_top_cats");

  // Check if join/open_market from earlier actually succeeded
  const joinHash = "0xfd82951efcfc2c5add70764c2fd8e6b44bcca6228e065c22dc657ab0e56f1b08";
  const openHash = "0x587296630d488fe79444e12a5d39576b50b26b004985abb0436732186c3edebc";

  console.log("\n=== CHECKING EARLIER TXs ===");
  for (const h of [joinHash, openHash]) {
    try {
      const tx = await client.getTransaction({ hash: h });
      const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
        ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
      console.log(`${h.substring(0,20)}... status=${tx?.statusName} exec=${leader?.execution_result}`);
      if (leader?.genvm_result?.stderr) {
        console.log(`  stderr: ${leader.genvm_result.stderr.substring(0, 300)}`);
      }
      if (leader?.calldata?.readable) {
        console.log(`  result: ${leader.calldata.readable.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`${h.substring(0,20)}... error: ${e.shortMessage?.substring(0, 80)}`);
    }
  }

  // Re-join with a new account
  console.log("\n=== RE-JOINING ===");
  const pk2 = generatePrivateKey();
  const account2 = createAccount(pk2);
  await client.request({ method: "sim_fundAccount", params: [account2.address, 1000] });
  
  // Use second account for join
  const client2 = createClient({ chain: studionet, account: account2 });
  
  console.log("Account2:", account2.address);
  await writeAndWait("join(TestCat2)", async () => {
    return await client2.writeContract({ address: CONTRACT, functionName: "join", args: ["TestCat2"] });
  });

  await readTest("get_total_traders (after rejoin)");
  await readTest("get_top_cats (after rejoin)");
  await readTest("get_trader_info(account2)", "get_trader_info", [account2.address]);

  // Open market from account2 (so creator can bet from account)
  console.log("\n=== OPEN MARKET (from account2) ===");
  const closesAt = Math.floor(Date.now() / 1000) + 3600;
  await writeAndWait("open_market", async () => {
    return await client2.writeContract({
      address: CONTRACT, functionName: "open_market",
      args: ["Will GenLayer succeed?", "crypto", "https://example.com/genlayer", BigInt(closesAt), BigInt(0), BigInt(0)]
    });
  });

  await readTest("get_total_markets");
  
  // Try get_market with different param formats
  console.log("\n=== GET MARKET ===");
  await readTest("get_market(0n)", "get_market", [0n]);
  await readTest("get_market(BigInt(0))", "get_market", [BigInt(0)]);

  // Take a side from account (not the creator)
  console.log("\n=== TAKE SIDE ===");
  await writeAndWait("take_side(0, yes, 10 GEN)", async () => {
    return await client.writeContract({
      address: CONTRACT, functionName: "take_side",
      args: [0n, "yes"],
      value: BigInt(10_000_000_000_000_000_00n), // 10 GEN
    });
  });

  await readTest("get_market(0n) after bet", "get_market", [0n]);
  await readTest("get_total_wagers after bet");

  // Get trader positions
  await readTest("get_trader_positions(account)", "get_trader_positions", [account.address]);

  console.log("\n\n========== ALL DONE ==========");
}

main().catch(console.error);
