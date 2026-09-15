const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

async function main() {
  const account = createAccount("0xe85d76967df46f85c4ad6397405c3ebd22c03bb86782c0c712f0edab5fc90f06");
  const client = createClient({ chain: studionet, account });

  const CONTRACT = "0x84510Ce282aA685B0F27f854F9D4B9C4324253f5";

  // First check if there was a transaction receipt with execution details
  const deployHash = "0x54c38d5876cc7085f0a6dd9ec1939bf5f220d3eb44a5abc5911af6130e24e5b9";
  
  console.log("=== Checking deploy transaction details ===");
  try {
    const tx = await client.getTransaction({ hash: deployHash });
    console.log("Status:", tx.statusName);
    console.log("Result:", tx.resultName);
    console.log("Execution result:", tx.txExecutionResultName);
    
    if (tx.consensus_data?.leader_receipt) {
      const leader = Array.isArray(tx.consensus_data.leader_receipt) 
        ? tx.consensus_data.leader_receipt[0] 
        : tx.consensus_data.leader_receipt;
      console.log("\nLeader receipt:");
      console.log("  execution_result:", leader.execution_result);
      console.log("  vote:", leader.vote);
      console.log("  genvm_result:", JSON.stringify(leader.genvm_result)?.substring(0, 500));
      console.log("  result:", JSON.stringify(leader.result)?.substring(0, 500));
      if (leader.calldata) {
        console.log("  calldata:", JSON.stringify(leader.calldata)?.substring(0, 500));
      }
    }

    if (tx.consensus_data?.validators) {
      console.log("\nValidator results:");
      for (const v of tx.consensus_data.validators) {
        console.log(`  vote=${v.vote} result=${JSON.stringify(v.result)?.substring(0, 100)} genvm_result=${JSON.stringify(v.genvm_result)?.substring(0, 100)}`);
      }
    }
  } catch (e) {
    console.log("Error:", e.message?.substring(0, 200));
  }

  // Try a simplified version of kitty_market
  console.log("\n\n=== Deploying simplified kitty_market ===");
  
  const simpleMarketCode = `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class KittyMarket(gl.Contract):
    owner: Address
    total_markets: u256

    def __init__(self):
        self.owner = Address(0)
        self.total_markets = u256(0)

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_total_markets(self) -> u256:
        return self.total_markets`;

  try {
    const hash = await client.deployContract({
      code: new TextEncoder().encode(simpleMarketCode),
      args: [],
      value: BigInt(0),
    });
    console.log("Deploy hash:", hash);

    // Wait
    let addr = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const tx = await client.getTransaction({ hash });
        if (tx && tx.statusName === "FINALIZED") {
          addr = tx.data?.contract_address || tx.recipient;
          console.log("FINALIZED! Address:", addr);
          console.log("Execution:", tx.txExecutionResultName);
          
          if (tx.consensus_data?.leader_receipt) {
            const leader = Array.isArray(tx.consensus_data.leader_receipt)
              ? tx.consensus_data.leader_receipt[0]
              : tx.consensus_data.leader_receipt;
            console.log("Leader execution_result:", leader.execution_result);
            console.log("Leader genvm_result:", JSON.stringify(leader.genvm_result)?.substring(0, 300));
            console.log("Leader result:", JSON.stringify(leader.result)?.substring(0, 300));
          }
          break;
        }
        if (i % 10 === 0) process.stdout.write(".");
      } catch (e) {
        if (i % 10 === 0) process.stdout.write(".");
      }
    }

    if (addr) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const owner = await client.readContract({ address: addr, functionName: "get_owner", args: [] });
        console.log("\n✅ get_owner:", owner);
      } catch (e) {
        console.log("\n❌ get_owner:", e.shortMessage?.substring(0, 100));
      }
    }
  } catch (e) {
    console.log("Deploy error:", e.message?.substring(0, 200));
  }
}

main().catch(console.error);
