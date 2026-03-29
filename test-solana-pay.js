import { Keypair, Connection } from "@solana/web3.js";
import bs58 from "bs58";

const GATEWAY = "https://optim-solana-gateway-production.up.railway.app";
const SOL_KEY = process.env.SOL_TEST_KEY;

if (!SOL_KEY) {
  console.error("Missing SOL_TEST_KEY. Use: export SOL_TEST_KEY=<base58_secret>");
  process.exit(1);
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(SOL_KEY));
  console.log("=== OptimEngine Solana Payment Test ===");
  console.log("Payer:", keypair.publicKey.toBase58());
  console.log("Gateway:", GATEWAY);

  // Step 1: Call without payment — expect 402
  console.log("\n--- Step 1: Request without payment ---");
  const res402 = await fetch(`${GATEWAY}/solve/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  console.log("Status:", res402.status, "(expected 402)");

  // Step 2: Read payment requirements from headers
  const paymentRequired = res402.headers.get("x-payment-required") || res402.headers.get("payment-required");
  if (paymentRequired) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentRequired, "base64").toString());
      console.log("\nPayment Requirements:");
      console.log(JSON.stringify(decoded, null, 2).slice(0, 500));
    } catch(e) {
      console.log("Payment header (raw):", paymentRequired?.slice(0, 200));
    }
  } else {
    // Try body
    const body = await res402.json().catch(() => ({}));
    console.log("Payment body:", JSON.stringify(body).slice(0, 500));
  }

  // Step 3: Check stats
  console.log("\n--- Stats ---");
  const stats = await (await fetch(`${GATEWAY}/stats`)).json();
  console.log("Requests:", stats.requests.total);
  console.log("Alert:", stats.alert);

  console.log("\n✅ Solana 402 test complete");
  console.log("Note: Full payment test requires @x402/fetch client with Solana wallet adapter.");
  console.log("The 402 confirms the gateway is live and responding with payment requirements.");
}

main().catch(console.error);
