const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  const hashes = [
    "0xe09c531f32eebc5f87413e083c911d0c94b8a73b07d349a0ef988780bfc7d492",
    "0x22e68275cabb48d72e29b5dee04397cc0012c2e944e69887b7f6bcc522cd5343",
    "0x4429d16d247bd6d25bdf013028319f3aa1008e0c5907939d1fd9004be3bfa3b4",
    "0x0f98900a7974877469daff01f95da808b7a3701223ca771d17595e8df40e0f39",
    "0x4db78351541001dd297b8038b3bf4e0ae646dd35ae16cac05a43e528b9ca410b",
    "0x4f9ec2bd8b470c7269bc65142bc1a4a4a797ac504c4455953678be053aec43ea",
  ];

  for (const hash of hashes) {
    console.log(`\n=== ${hash.substring(0, 20)}... ===`);
    
    // Get transaction data
    try {
      const tx = await client.request({
        method: "eth_getTransactionByHash",
        params: [hash],
      });
      console.log("  to:", tx?.to);
      console.log("  from:", tx?.from);
      console.log("  input length:", tx?.input?.length);
    } catch (e) {
      console.log("  eth_getTransactionByHash error:", e.shortMessage?.substring(0, 80));
    }

    // Debug trace
    try {
      const trace = await client.debugTraceTransaction({ hash, round: 0 });
      console.log("  trace keys:", Object.keys(trace || {}));
      console.log("  stdout:", trace?.stdout?.substring(0, 200));
      console.log("  stderr:", trace?.stderr?.substring(0, 200));
      console.log("  result:", trace?.result?.substring(0, 200));
      console.log("  return:", trace?.return?.substring(0, 200));
      console.log("  genvm_log:", trace?.genvm_log?.substring(0, 300));
    } catch (e) {
      console.log("  debugTrace error:", e.shortMessage?.substring(0, 100));
    }
  }
}

main().catch(console.error);
