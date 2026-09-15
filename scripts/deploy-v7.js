const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Check what the studio API endpoint returns for the old contract
  const OLD = "0x13C2bc0722780691D498A58391057eA70b37ccfF";

  // Test with the SDK's internal getTransaction using old contract's deploy tx
  // Let's just deploy a new contract and IMMEDIATELY try to read it
  
  // Fund first
  try { await client.request({ method: "sim_fundAccount", params: [account.address, 1000] }); } catch(e) {}

  const code = `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class Minimal(gl.Contract):
    val: str

    def __init__(self):
        self.val = "test"

    @gl.public.view
    def get_val(self) -> str:
        return self.val`;

  // Try passing code as Uint8Array like the docs suggest
  console.log("Deploying with Uint8Array code...");
  const hash = await client.deployContract({
    code: new TextEncoder().encode(code),
    args: [],
    value: BigInt(0),
  });
  console.log("Hash:", hash);

  // Poll with short intervals
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const tx = await client.getTransaction({ hash });
      if (tx) {
        console.log(`[${i*5}s] status=${tx.statusName} recipient=${tx.recipient}`);
        
        if (tx.statusName === "FINALIZED") {
          console.log("\nFINALIZED! Full tx data:");
          console.log(JSON.stringify(tx, (k, v) => typeof v === "bigint" ? v.toString() : v, 2)?.substring(0, 3000));
          
          // Try reading from the recipient address
          if (tx.recipient) {
            console.log(`\nTrying to read from tx.recipient: ${tx.recipient}`);
            try {
              const val = await client.readContract({
                address: tx.recipient,
                functionName: "get_val",
                args: [],
              });
              console.log(`  SUCCESS: val="${val}"`);
            } catch (e) {
              console.log(`  FAILED: ${e.shortMessage?.substring(0, 100)}`);
            }
          }

          // Also try from to_address if available
          if (tx.to_address) {
            console.log(`\nTrying to read from tx.to_address: ${tx.to_address}`);
            try {
              const val = await client.readContract({
                address: tx.to_address,
                functionName: "get_val",
                args: [],
              });
              console.log(`  SUCCESS: val="${val}"`);
            } catch (e) {
              console.log(`  FAILED: ${e.shortMessage?.substring(0, 100)}`);
            }
          }

          // Try contract_address field
          if (tx.contract_address) {
            console.log(`\nTrying to read from tx.contract_address: ${tx.contract_address}`);
            try {
              const val = await client.readContract({
                address: tx.contract_address,
                functionName: "get_val",
                args: [],
              });
              console.log(`  SUCCESS: val="${val}"`);
            } catch (e) {
              console.log(`  FAILED: ${e.shortMessage?.substring(0, 100)}`);
            }
          }

          // Try from tx.to field
          if (tx.to) {
            console.log(`\nTrying to read from tx.to: ${tx.to}`);
            try {
              const val = await client.readContract({
                address: tx.to,
                functionName: "get_val",
                args: [],
              });
              console.log(`  SUCCESS: val="${val}"`);
            } catch (e) {
              console.log(`  FAILED: ${e.shortMessage?.substring(0, 100)}`);
            }
          }

          // Try consensus_data address
          if (tx.consensus_data) {
            console.log(`\nconsensus_data keys: ${Object.keys(tx.consensus_data)}`);
          }

          break;
        }
      }
    } catch (e) {
      console.log(`[${i*5}s] Error: ${e.shortMessage?.substring(0, 60)}`);
    }
  }
}

main().catch(console.error);
