const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Fund
  try { await client.request({ method: "sim_fundAccount", params: [account.address, 1000] }); } catch(e) {}

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
  const hash = await client.deployContract({ code: simpleCode, args: [], value: BigInt(0) });
  console.log("Hash:", hash);

  console.log("Waiting 180s for full finalization...");
  await new Promise(r => setTimeout(r, 180000));

  // Try GenLayer-specific receipt
  console.log("\n=== gen_getTransactionReceipt ===");
  try {
    const receipt = await client.request({ method: "gen_getTransactionReceipt", params: [hash] });
    console.log(JSON.stringify(receipt, (k, v) => typeof v === "bigint" ? v.toString() : v, 2)?.substring(0, 3000));
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Try gen_getTransactionStatus
  console.log("\n=== gen_getTransactionStatus ===");
  try {
    const status = await client.request({ method: "gen_getTransactionStatus", params: [hash] });
    console.log(JSON.stringify(status, (k, v) => typeof v === "bigint" ? v.toString() : v, 2)?.substring(0, 2000));
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Try getting status of earlier deploy that showed FINALIZED
  console.log("\n=== Earlier deploy tx status ===");
  const earlierHashes = [
    "0xe09c531f32eebc5f87413e083c911d0c94b8a73b07d349a0ef988780bfc7d492",
    "0x22e68275cabb48d72e29b5dee04397cc0012c2e944e69887b7f6bcc522cd5343",
    "0x4429d16d247bd6d25bdf013028319f3aa1008e0c5907939d1fd9004be3bfa3b4",
    "0x0f98900a7974877469daff01f95da808b7a3701223ca771d17595e8df40e0f39",
  ];
  for (const h of earlierHashes) {
    try {
      const status = await client.request({ method: "gen_getTransactionStatus", params: [h] });
      console.log(`${h.substring(0,20)}... ->`, JSON.stringify(status, (k, v) => typeof v === "bigint" ? v.toString() : v, 2)?.substring(0, 500));
    } catch (e) {
      console.log(`${h.substring(0,20)}... -> Error: ${e.shortMessage?.substring(0, 100)}`);
    }
  }
}

main().catch(console.error);
