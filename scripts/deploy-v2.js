const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Fund
  try {
    await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
    console.log("Funded:", account.address);
  } catch (e) {
    console.log("Fund error:", e.message?.substring(0, 100));
  }

  // Deploy minimal test contract
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

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    fullTransaction: true,
  });

  console.log("\n=== RECEIPT (all keys) ===");
  for (const [k, v] of Object.entries(receipt)) {
    if (v !== undefined && v !== null) {
      console.log(`  ${k}:`, typeof v === "object" ? JSON.stringify(v, null, 2)?.substring(0, 200) : v);
    }
  }

  // Check ALL possible address fields
  console.log("\n=== ADDRESS CANDIDATES ===");
  console.log("receipt.to_address:", receipt.to_address);
  console.log("receipt.recipient:", receipt.recipient);
  console.log("receipt.contract_address:", receipt.contract_address);
  console.log("receipt.data:", typeof receipt.data === "object" ? JSON.stringify(receipt.data)?.substring(0, 300) : receipt.data);
  if (receipt.data && typeof receipt.data === "object") {
    console.log("receipt.data.contract_address:", receipt.data.contract_address);
  }
  if (receipt.txDataDecoded) {
    console.log("receipt.txDataDecoded.contractAddress:", receipt.txDataDecoded.contractAddress);
  }

  // Try each candidate address
  const candidates = [
    receipt.to_address,
    receipt.recipient,
    receipt.contract_address,
    receipt.data?.contract_address,
    receipt.txDataDecoded?.contractAddress,
  ].filter(Boolean);

  console.log("\n=== Trying each candidate address ===");
  for (const addr of candidates) {
    console.log(`\nTrying ${addr}...`);
    try {
      const val = await client.readContract({
        address: addr,
        functionName: "get_value",
        args: [],
      });
      console.log(`  SUCCESS! value = "${val}"`);
    } catch (e) {
      console.log(`  FAILED: ${e.shortMessage?.substring(0, 80)}`);
    }
  }
}

main().catch(console.error);
