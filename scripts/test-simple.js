const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Simple test contract
  const simpleCode = `
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
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
        return self.value
`;

  console.log("Deploying minimal test contract...");
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
  console.log("Status:", receipt.statusName);
  console.log("Execution:", receipt.txExecutionResultName);
  console.log("To:", receipt.to_address || receipt.recipient);

  if (receipt.last_round) {
    console.log("Round result:", receipt.last_round.result);
    console.log("Votes:", receipt.last_round.validator_votes_name);
  }

  const addr = receipt.to_address || receipt.recipient;
  if (addr) {
    console.log("\nWaiting 60s...");
    await new Promise(r => setTimeout(r, 60000));

    try {
      const val = await client.readContract({
        address: addr,
        functionName: "get_value",
        args: [],
      });
      console.log("READ SUCCESS:", val);
    } catch (e) {
      console.log("Read failed:", e.shortMessage?.substring(0, 100));
    }
  }
}

main().catch(console.error);
