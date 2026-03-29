import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const GATEWAY = "https://optim-solana-gateway-production.up.railway.app";
const SOL_KEY = process.env.SOL_TEST_KEY;

if (!SOL_KEY) {
  console.error("Missing SOL_TEST_KEY. Use: export SOL_TEST_KEY='<base58_secret>'");
  process.exit(1);
}

async function main() {
  // Create signer using @solana/kit format (required by @x402/svm)
  const secretBytes = bs58.decode(SOL_KEY);
  const signer = await createKeyPairSignerFromBytes(secretBytes);
  
  console.log("=== OptimEngine Solana END-TO-END Payment Test ===");
  console.log("Payer:", signer.address);
  console.log("Gateway:", GATEWAY);

  // Create x402 client
  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer: signer,
    rpcUrl: "https://api.mainnet-beta.solana.com"
  });

  const paidFetch = wrapFetchWithPayment(fetch, client);

  // Call solve/validate (cheapest at $0.05)
  console.log("\n--- Calling /solve/validate ($0.05 USDC) ---");
  const t0 = Date.now();
  try {
    const res = await paidFetch(`${GATEWAY}/solve/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs: [
          { job_id: "J1", tasks: [{ task_id: "T1", duration: 3, eligible_machines: ["M1"] }] }
        ],
        machines: [{ machine_id: "M1" }],
        schedule: [
          { job_id: "J1", task_id: "T1", machine_id: "M1", start: 0, end: 3, duration: 3 }
        ]
      })
    });

    const total = Date.now() - t0;
    console.log("HTTP Status:", res.status);

    if (res.ok) {
      const data = await res.json();
      console.log("Result:", JSON.stringify(data).slice(0, 300));
      console.log("TOTAL time:", total, "ms");
      console.log("\n✅ SOLANA PAYMENT END-TO-END COMPLETE!");
    } else {
      const text = await res.text();
      console.log("Response:", res.status, text.slice(0, 500));
    }
  } catch (err) {
    console.log("Error:", err.message?.slice(0, 500) || err);
  }

  // Check stats
  console.log("\n--- Stats ---");
  const stats = await (await fetch(`${GATEWAY}/stats`)).json();
  console.log("Payments verified:", stats.payments.verified);
  console.log("Alert:", stats.alert);
}

main().catch(console.error);
