/**
 * Kitty Market - wallet client verification (frontend write path).
 *
 * Regression for the Steward report:
 *   "Unable to create market from frontend: No account set. Configure the
 *    client with an account or pass an account to this function."
 *
 * The frontend now builds a dedicated write client, exactly like this:
 *
 *   createClient({
 *     chain: studionet,
 *     account: address,        // connected wallet address
 *     provider: window.ethereum,
 *   })
 *
 * In the browser, genlayer-js routes `eth_sendTransaction` to the EIP-1193
 * provider so the wallet can sign. This script reproduces that path outside
 * the browser with a mock provider that signs `eth_sendTransaction` using the
 * recorded test key, then runs a real deploy + create-market flow on
 * Studionet. Nothing is written to the live frontend contract.
 *
 * Usage:
 *   node scripts/verify-wallet-client.js
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const { privateKeyToAccount } = require("viem/accounts");

const RPC_URL = studionet.rpcUrls.default.http[0];
const CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;
const CODE_PATH = path.join(__dirname, "..", "contracts", "kitty_market.py");

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "contract-address.json"), "utf-8")
);

const evidence = [];
const failures = [];

function record(label, hash, status) {
  evidence.push({ label, hash, status });
  console.log(`  ${label}: ${hash} (${status})`);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method} failed: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

/**
 * Minimal EIP-1193 provider. A browser wallet implements the same two methods
 * that matter here: it reports the chain and signs `eth_sendTransaction`.
 */
function createMockWallet(account) {
  return {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return CHAIN_ID_HEX;
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return [account.address];
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        const gasPrice = tx.gasPrice || (await rpc("eth_gasPrice"));
        const signed = await account.signTransaction({
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value || "0x0"),
          gas: BigInt(tx.gas),
          nonce: Number(tx.nonce),
          chainId: studionet.id,
          type: "legacy",
          gasPrice: BigInt(gasPrice),
        });
        return rpc("eth_sendRawTransaction", [signed]);
      }
      throw new Error(`mock wallet does not implement ${method}`);
    },
  };
}

async function waitFinalized(client, hash) {
  return client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    retries: 120,
    interval: 3000,
  });
}

async function main() {
  const account = privateKeyToAccount(cfg.privateKey);
  const code = new TextEncoder().encode(fs.readFileSync(CODE_PATH, "utf-8"));

  // Same construction as src/lib/session.tsx -> writeClient.
  const client = createClient({
    chain: studionet,
    account: account.address,
    provider: createMockWallet(account),
  });

  console.log("Wallet-style write client");
  console.log("  address :", account.address);
  console.log("  account :", client.account?.address);
  console.log("  chain   :", client.chain.name, `(${client.chain.id})`);

  if (client.account?.address?.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Client did not bind the wallet address (the reported bug).");
  }
  console.log("  PASS client binds the wallet account (no 'No account set')");

  console.log("\n1. Deploying a scratch KittyMarket through the wallet provider ...");
  const deployHash = await client.deployContract({
    code,
    args: [account.address],
    value: BigInt(0),
  });
  const deployReceipt = await waitFinalized(client, deployHash);
  const scratch = deployReceipt.data?.contract_address || deployReceipt.recipient;
  if (!scratch) throw new Error("Deploy receipt did not include a contract address");
  record("Scratch deploy", deployHash, "Finalized");
  console.log("  contract:", scratch);

  console.log("\n2. Creating a market through the wallet provider ...");
  const closesAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const question = `Wallet client smoke test ${new Date().toISOString()}`;
  const marketHash = await client.writeContract({
    address: scratch,
    functionName: "open_market",
    args: [question, "other", "https://example.com", closesAt, BigInt(0), BigInt(0)],
    value: BigInt(0),
  });
  await waitFinalized(client, marketHash);
  record("Create market", marketHash, "Finalized");

  console.log("\n3. Reading the created market back ...");
  const total = await client.readContract({
    address: scratch,
    functionName: "get_total_markets",
    args: [],
  });
  const market = JSON.parse(
    await client.readContract({
      address: scratch,
      functionName: "get_market",
      args: [String(Number(total) - 1)],
    })
  );
  console.log("  total markets:", String(total));
  console.log("  question     :", market.question);
  console.log("  host         :", market.host);

  if (market.question !== question || market.host?.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Created market does not match the submitted payload");
  }
  console.log("  PASS market created by the wallet account");

  const outPath = path.join(__dirname, "wallet-client-verification.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        walletClient: {
          account: account.address,
          chain: client.chain.name,
          chainId: client.chain.id,
          accountBound: client.account?.address,
        },
        scratchContract: scratch,
        transactions: evidence,
        createdMarket: { id: String(Number(total) - 1), question, host: market.host },
      },
      null,
      2
    )
  );
  console.log("  wrote", path.relative(path.join(__dirname, ".."), outPath));

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  failures.push(String(err));
  console.error("\nFAIL", err);
  process.exit(1);
});
