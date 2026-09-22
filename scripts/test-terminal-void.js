const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const CONTRACT = "0x79e4B28A91277841aC8a3e1Da9204feb564081EF";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
        address: CONTRACT, functionName: fn, args, value: value || BigInt(0),
      });
      console.log(`  ${label} tx: ${h}`);
      for (let i = 0; i < 60; i++) {
        await sleep(3000);
        const tx = await c.getTransaction({ hash: h });
        if (tx?.statusName === "FINALIZED") {
          const lr = Array.isArray(tx.consensus_data?.leader_receipt)
            ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
          if (lr?.execution_result === "ERROR") {
            console.log(`  ${label} FAILED:`, lr.genvm_result?.stderr?.substring(0, 200));
            return false;
          }
          console.log(`  ${label} → FINALIZED ✅`);
          return true;
        }
        if (tx?.statusName === "REJECTED") {
          console.log(`  ${label} → REJECTED ❌`);
          return false;
        }
      }
      console.log(`  ${label} → TIMEOUT ⏰`);
      return false;
    } catch (e) {
      console.log(`  ${label} ERROR:`, e.shortMessage?.substring(0, 200));
      return false;
    }
  }

  // Register
  console.log("\n=== Register ===");
  await sendTx("join owner", client, "join", ["VoidTest_Owner"]);
  await sendTx("join creator", client2, "join", ["VoidTest_Creator"]);
  await sendTx("join bettor", client3, "join", ["VoidTest_Bettor"]);

  // Open market
  const now = Math.floor(Date.now() / 1000);
  console.log("\n=== Open Market ===");
  await sendTx("open_market", client2, "open_market", [
    "Will ETH merge work?",
    "crypto",
    "https://invalid.url/permanently-down",
    BigInt(now + 100),
    BigInt(0),
    BigInt(0),
  ]);

  // Take sides
  console.log("\n=== Take Sides ===");
  await sendTx("owner YES 1 GEN", client, "take_side", [2n, "yes"], BigInt(1000000000000000000));
  await sendTx("bettor NO 2 GEN", client3, "take_side", [2n, "no"], BigInt(2000000000000000000));

  // Check market
  const m = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [2n] }));
  console.log("\nMarket state:", {
    question: m.question,
    yes_pool: m.yes_pool,
    no_pool: m.no_pool,
    settled: m.settled,
    outcome: m.outcome,
    settle_attempts: m.settle_attempts,
    terminal_void: m.terminal_void,
  });

  // Settle 5 times (should return void each time due to invalid URL)
  console.log("\n=== Settle 5 times ===");
  for (let i = 0; i < 5; i++) {
    await sendTx(`settle_market #${i+1}`, client, "settle_market", [2n]);
    
    const mk = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [2n] }));
    console.log(`  attempt=${mk.settle_attempts}, resolved=${mk.settled}, outcome="${mk.outcome}"`);
  }

  // Terminal void
  console.log("\n=== Terminal Void ===");
  await sendTx("terminal_void", client, "terminal_void", [2n]);

  const mv = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [2n] }));
  console.log("Market after terminal_void:", {
    settled: mv.settled,
    outcome: mv.outcome,
    terminal_void: mv.terminal_void,
    reasoning: mv.verdict_note,
  });

  // Reclaim stakes
  console.log("\n=== Reclaim Stakes ===");
  await sendTx("owner reclaim", client, "reclaim_stake", [2n]);
  await sendTx("bettor reclaim", client3, "reclaim_stake", [2n]);

  // Verify positions closed
  const posOwner = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_trader_positions", args: [account.address] }));
  const posBettor = JSON.parse(await client3.readContract({ address: CONTRACT, functionName: "get_trader_positions", args: [account3.address] }));

  console.log("\nOwner positions:", posOwner);
  console.log("Bettor positions:", posBettor);

  const allClosed = [...posOwner, ...posBettor].every(p => p.closed === true);
  console.log("\nAll positions closed:", allClosed ? "✅ YES" : "❌ NO");
}

main().catch(console.error);
