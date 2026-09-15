const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const CONTRACT = "0xEbd354C745f3d6a155F9C99b120135d8Ecff3F0B";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Try with stateStatus
  console.log("=== Try 1: stateStatus=accepted ===");
  try {
    const owner = await client.readContract({
      address: CONTRACT,
      functionName: "get_owner",
      args: [],
      stateStatus: "accepted",
    });
    console.log("SUCCESS:", owner);
    return;
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Try gen_call directly
  console.log("\n=== Try 2: gen_call direct ===");
  try {
    const result = await client.request({
      method: "gen_call",
      params: [{
        from: "0x0000000000000000000000000000000000000000",
        to: CONTRACT,
        data: "0x" + Buffer.from(JSON.stringify({ method: "get_owner", args: [] })).toString("hex"),
      }],
    });
    console.log("gen_call result:", result);
    return;
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Try getting contract code
  console.log("\n=== Try 3: getContractCode ===");
  try {
    const code = await client.getContractCode({ address: CONTRACT });
    console.log("Contract code length:", code?.length);
    console.log("Code:", code?.substring(0, 200));
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Try getContractSchema
  console.log("\n=== Try 4: getContractSchema ===");
  try {
    const schema = await client.getContractSchema({ address: CONTRACT });
    console.log("Schema:", JSON.stringify(schema, null, 2)?.substring(0, 500));
  } catch (e) {
    console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Re-deploy with a different approach
  console.log("\n=== Try 5: Re-deploy contract ===");
  const contractPath = path.join(__dirname, "..", "contracts", "kitty_market.py");
  const contractCode = fs.readFileSync(contractPath, "utf-8");

  const deployHash = await client.deployContract({
    code: contractCode,
    args: [],
    value: BigInt(0),
  });
  console.log("New deploy hash:", deployHash);

  const receipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "FINALIZED",
    fullTransaction: true,
  });
  console.log("Receipt status:", receipt.statusName);
  console.log("Result:", receipt.txExecutionResultName);
  console.log("To:", receipt.to_address || receipt.recipient);

  // Wait a bit for state propagation
  console.log("Waiting 60s...");
  await new Promise(r => setTimeout(r, 60000));

  const newAddr = receipt.to_address || receipt.recipient;
  if (newAddr) {
    console.log("\nTrying to read new contract:", newAddr);
    try {
      const owner = await client.readContract({
        address: newAddr,
        functionName: "get_owner",
        args: [],
      });
      console.log("SUCCESS! Owner:", owner);

      // Save address
      fs.writeFileSync(
        path.join(__dirname, "contract-address.json"),
        JSON.stringify({ address: newAddr }, null, 2)
      );
    } catch (e) {
      console.log("Error:", e.shortMessage || e.message?.substring(0, 200));
    }
  }
}

main().catch(console.error);
