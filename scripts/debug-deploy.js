const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const DEPLOY_HASH = "0xe09c531f32eebc5f87413e083c911d0c94b8a73b07d349a0ef988780bfc7d492";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Get full receipt
  const receipt = await client.waitForTransactionReceipt({
    hash: DEPLOY_HASH,
    status: "FINALIZED",
    fullTransaction: true,
  });

  console.log("=== Full Receipt ===");
  console.log(JSON.stringify(receipt, (k, v) => typeof v === "bigint" ? v.toString() : v, 2));

  // Debug trace
  console.log("\n=== Debug Trace ===");
  try {
    const trace = await client.debugTraceTransaction({ hash: DEPLOY_HASH });
    console.log("result_code:", trace.result_code);
    console.log("return_data:", trace.return_data);
    console.log("stdout:", trace.stdout?.substring(0, 500));
    console.log("stderr:", trace.stderr?.substring(0, 500));
    if (trace.genvm_log) {
      console.log("genvm_log (last 3):", JSON.stringify(trace.genvm_log.slice(-3), null, 2));
    }
  } catch (e) {
    console.log("Debug trace error:", e.message);
  }
}

main().catch(console.error);
