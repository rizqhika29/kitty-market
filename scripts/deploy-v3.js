const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Fund first
  try {
    await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
    console.log("Funded:", account.address);
  } catch (e) {
    console.log("Fund:", e.message?.substring(0, 100));
  }

  // Try the deploy again
  const simpleCode = `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class SimpleTest(gl.Contract):
    value: str

    def __init__(self):
        self.value = "hello"

    @gl.public.write
    def set_value(self, new_value: str):
        self.value = new_value

    @gl.public.view
    def get_value(self) -> str:
        return self.value`;

  console.log("Deploying...");
  const hash = await client.deployContract({
    code: simpleCode,
    args: [],
    value: BigInt(0),
  });
  console.log("Hash:", hash);

  // Poll manually instead of waitForTransactionReceipt
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      const status = receipt?.status;
      const statusName = ["UNKNOWN", "PENDING", "EXECUTING", "FAILED", "FINALIZED", "UNKNOWN5"][status] || `status_${status}`;
      console.log(`[${i+1}] Status: ${status} (${statusName})`);

      if (status === 3) {
        // FAILED - get full details
        console.log("  Full receipt:");
        for (const [k, v] of Object.entries(receipt)) {
          if (v !== undefined && v !== null) {
            const val = typeof v === "object" ? JSON.stringify(v, null, 2)?.substring(0, 300) : v;
            console.log(`    ${k}: ${val}`);
          }
        }
        break;
      }

      if (status === 4) {
        // FINALIZED
        console.log("  FINALIZED! Full receipt:");
        for (const [k, v] of Object.entries(receipt)) {
          if (v !== undefined && v !== null) {
            const val = typeof v === "object" ? JSON.stringify(v, null, 2)?.substring(0, 300) : v;
            console.log(`    ${k}: ${val}`);
          }
        }

        // Try all address candidates
        const candidates = [
          receipt.to_address,
          receipt.recipient,
          receipt.contract_address,
          receipt.data?.contract_address,
          receipt.txDataDecoded?.contractAddress,
        ].filter(Boolean);

        console.log("\n  Address candidates:", candidates);

        for (const addr of candidates) {
          try {
            const val = await client.readContract({ address: addr, functionName: "get_value", args: [] });
            console.log(`  ${addr} -> value="${val}" ✅`);
          } catch (e) {
            console.log(`  ${addr} -> FAILED: ${e.shortMessage?.substring(0, 80)}`);
          }
        }
        break;
      }

      if (status === undefined || status === null) {
        // Try alternate receipt method
        try {
          const altReceipt = await client.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
          });
          console.log("  Alt receipt status:", altReceipt?.status);
          if (altReceipt?.status) {
            console.log("  Full alt receipt:");
            for (const [k, v] of Object.entries(altReceipt)) {
              if (v !== undefined && v !== null) {
                const val = typeof v === "object" ? JSON.stringify(v, null, 2)?.substring(0, 300) : v;
                console.log(`    ${k}: ${val}`);
              }
            }
          }
        } catch (e2) {
          console.log("  Alt receipt error:", e2.message?.substring(0, 80));
        }
      }
    } catch (e) {
      console.log(`[${i+1}] Error: ${e.shortMessage?.substring(0, 100)}`);
    }
  }
}

main().catch(console.error);
