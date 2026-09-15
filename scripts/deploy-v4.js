const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Fund
  try {
    await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
  } catch (e) {}

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

  // Wait a bit for finalization
  console.log("Waiting 120s for finalization...");
  await new Promise(r => setTimeout(r, 120000));

  // Use raw RPC to get receipt
  console.log("\n=== Raw eth_getTransactionReceipt ===");
  try {
    const rawReceipt = await client.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    console.log(JSON.stringify(rawReceipt, null, 2));
  } catch (e) {
    console.log("Raw receipt error:", e.message?.substring(0, 200));
  }

  // Use SDK receipt
  console.log("\n=== SDK getTransactionReceipt ===");
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    console.log(JSON.stringify(receipt, (k, v) => typeof v === "bigint" ? v.toString() : v, 2)?.substring(0, 2000));
  } catch (e) {
    console.log("SDK receipt error:", e.message?.substring(0, 200));
  }

  // Also try readContract on all historical addresses we've deployed to
  console.log("\n=== Trying all known deployed addresses ===");
  const knownAddresses = [
    "0xEbd354C745f3d6a155F9C99b120135d8Ecff3F0B",
    "0x175D583Dc1D404A62C126E103D626c6AeF2041f0",
    "0x164AD91133f5131E05D411e1251EFD1fff66fe87",
    "0x7c8a61E872Ab3556032ee8D1B64eBBb42B31Ea80",
  ];
  for (const addr of knownAddresses) {
    try {
      const val = await client.readContract({ address: addr, functionName: "get_value", args: [] });
      console.log(`${addr} -> "${val}" ✅`);
    } catch (e) {
      // Try kitty_market methods too
      try {
        const total = await client.readContract({ address: addr, functionName: "get_total_markets", args: [] });
        console.log(`${addr} -> total_markets=${total.toString()} ✅`);
      } catch (e2) {
        console.log(`${addr} -> ${e.shortMessage?.substring(0, 60)}`);
      }
    }
  }
}

main().catch(console.error);
