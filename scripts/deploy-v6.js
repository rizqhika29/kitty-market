const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0xbad71000f94c60a6c30b7e83621e4a4a0fc19bbac7bc29c1063c6def2b49d740";

// Contract addresses from our deployments
const ADDRS = [
  "0xEbd354C745f3d6a155F9C99b120135d8Ecff3F0B",
  "0x175D583Dc1D404A62C126E103D626c6AeF2041f0",
  "0x164AD91133f5131E05D411e1251EFD1fff66fe87",
  "0x7c8a61E872Ab3556032ee8D1B64eBBb42B31Ea80",
];

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Old working contract
  const OLD = "0x13C2bc0722780691D498A58391057eA70b37ccfF";

  // Encode get_owner calldata: keccak256("get_owner()")[:4]
  const getOwnerSig = "0xf851a440"; // get_owner()

  for (const addr of [...ADDRS, OLD]) {
    console.log(`\n=== ${addr} (${addr === OLD ? "OLD" : "NEW"}) ===`);

    // Try each state status
    for (const ss of ["latest-final", "latest-nonfinal"]) {
      try {
        const result = await client.readContract({
          address: addr,
          functionName: "get_owner",
          args: [],
          transactionHashVariant: ss,
        });
        console.log(`  ${ss}: owner=${result}`);
      } catch (e) {
        console.log(`  ${ss}: ${e.shortMessage?.substring(0, 80)}`);
      }
    }

    // Try raw gen_call with different "state" parameter
    for (const state of ["accepted", "proposed", "latest-final", "latest-nonfinal"]) {
      try {
        const result = await client.request({
          method: "gen_call",
          params: [{
            from: "0x0000000000000000000000000000000000000000",
            to: addr,
            data: getOwnerSig,
          }, state],
        });
        console.log(`  gen_call(${state}): ${result}`);
        break; // If one works, no need to try more
      } catch (e) {
        // Don't log every failure to reduce noise
      }
    }

    // Also try gen_call without state param
    try {
      const result = await client.request({
        method: "gen_call",
        params: [{
          from: "0x0000000000000000000000000000000000000000",
          to: addr,
          data: getOwnerSig,
        }],
      });
      console.log(`  gen_call(no-state): ${result}`);
    } catch (e) {
      // skip
    }
  }

  // List available RPC methods
  console.log("\n=== Trying to list available gen_ methods ===");
  for (const method of ["gen_listContracts", "gen_getContracts", "gen_getContractAddress", "gen_getState"]) {
    try {
      const result = await client.request({ method, params: [] });
      console.log(`${method}: ${JSON.stringify(result)?.substring(0, 200)}`);
    } catch (e) {
      console.log(`${method}: ${e.shortMessage?.substring(0, 80)}`);
    }
  }
}

main().catch(console.error);
