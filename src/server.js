import "dotenv/config";
import { predictStrategy } from "./predict-strategy.js";
import { routeLiquidity } from "./route-liquidity.js";
import { scheduleRobust } from "./schedule-robust.js";
import { packResources } from "./pack-resources.js";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

const PORT = process.env.PORT || 4404;
const WALLET = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const ENGINE_URL = process.env.OPTIMENGINE_URL;
const ENGINE_KEY = process.env.ENGINE_API_KEY || "";

if (!WALLET) { console.error("WALLET_ADDRESS required"); process.exit(1); }

// ── Facilitator (CDP) ──
const cdpKeyId = process.env.CDP_API_KEY_ID;
const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
const facilitatorConfig = (cdpKeyId && cdpKeySecret)
  ? createFacilitatorConfig(cdpKeyId, cdpKeySecret)
  : { url: "https://x402.org/facilitator" };
const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);

// ── Register both EVM and SVM schemes ──
const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactSvmScheme());

const app = express();
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

// ── Rate Limiting ──
app.use("/solve", rateLimit({ windowMs: 60000, max: 60, message: { status: 429, message: "Too many requests. Max 60/min." } }));
app.use("/stats", rateLimit({ windowMs: 60000, max: 10 }));
app.use("/health", rateLimit({ windowMs: 60000, max: 30 }));

// ── Pricing ──
const accept = (price) => [{ scheme: "exact", network: NETWORK, price, payTo: WALLET }];

const paidRoutes = {
  "POST /solve/schedule":    { accepts: accept("$0.15"), description: "FJSP Scheduling — OR-Tools CP-SAT", mimeType: "application/json" },
  "POST /solve/routing":     { accepts: accept("$0.20"), description: "CVRPTW Vehicle Routing", mimeType: "application/json" },
  "POST /solve/packing":     { accepts: accept("$0.10"), description: "Bin Packing — weight/volume", mimeType: "application/json" },
  "POST /solve/pareto":      { accepts: accept("$0.20"), description: "Multi-Objective Pareto Frontier", mimeType: "application/json" },
  "POST /solve/stochastic":  { accepts: accept("$0.25"), description: "Monte Carlo CVaR Stochastic", mimeType: "application/json" },
  "POST /solve/robust":      { accepts: accept("$0.20"), description: "Robust Worst-Case Optimization", mimeType: "application/json" },
  "POST /solve/sensitivity": { accepts: accept("$0.15"), description: "Parametric Sensitivity Analysis", mimeType: "application/json" },
  "POST /solve/prescriptive":{ accepts: accept("$0.30"), description: "Prescriptive Intelligence", mimeType: "application/json" },
  "POST /solve/validate":    { accepts: accept("$0.05"), description: "Schedule Validation", mimeType: "application/json" },
  "POST /predict-strategy":  { accepts: accept("$0.80"), description: "Pipeline: Stochastic + Pareto + Sensitivity + Prescriptive — Strategies A/B/C", mimeType: "application/json" },
  "POST /route-liquidity":   { accepts: accept("$0.35"), description: "Pipeline: Routing + Robust — Liquidity routing with worst-case protection", mimeType: "application/json" },
  "POST /schedule-robust":   { accepts: accept("$0.35"), description: "Pipeline: Scheduling + Stochastic — Schedule with Monte Carlo risk", mimeType: "application/json" },
  "POST /pack-resources":    { accepts: accept("$0.25"), description: "Pipeline: Packing + Pareto — Resource allocation with trade-offs", mimeType: "application/json" },
};

app.use(paymentMiddleware(paidRoutes, server));

// ── Stats ──
const stats = {
  started_at: new Date().toISOString(),
  requests: { total: 0, by_endpoint: {}, by_status: {} },
  payments: { verified: 0, total_usdc: 0, unique_payers: new Set() },
  solves: { completed: 0, total_ms: 0, avg_ms: 0 }
};

function trackSolve(endpoint, ms) {
  stats.requests.total++;
  stats.requests.by_endpoint[endpoint] = (stats.requests.by_endpoint[endpoint] || 0) + 1;
  stats.payments.verified++;
  stats.solves.completed++;
  stats.solves.total_ms += ms;
  stats.solves.avg_ms = Math.round(stats.solves.total_ms / stats.solves.completed);
}

// ── Solver Bridge ──
const SOLVER_MAP = {
  "/solve/schedule": "/optimize_schedule", "/solve/routing": "/optimize_routing",
  "/solve/packing": "/optimize_packing", "/solve/pareto": "/optimize_pareto",
  "/solve/stochastic": "/optimize_stochastic", "/solve/robust": "/optimize_robust",
  "/solve/sensitivity": "/analyze_sensitivity", "/solve/prescriptive": "/prescriptive_advise",
  "/solve/validate": "/validate_schedule",
};

for (const [path, solverPath] of Object.entries(SOLVER_MAP)) {
  app.post(path, async (req, res) => {
    try {
      const t0 = Date.now();
      const solverRes = await fetch(`${ENGINE_URL}${solverPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Engine-Key": ENGINE_KEY },
        body: JSON.stringify(solverPath === "/optimize_routing" ? { allow_drop_visits: true, ...req.body } : req.body),
      });
      const data = await solverRes.json();
      const ms = Date.now() - t0;
      trackSolve(path, ms);
      res.json({ success: true, solver: solverPath.split("/").pop(), result: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ── Free Endpoints ──
app.post("/predict-strategy", predictStrategy);
app.post("/route-liquidity", routeLiquidity);
app.post("/schedule-robust", scheduleRobust);
app.post("/pack-resources", packResources);
app.get("/health", (_req, res) => {
  res.json({
    gateway: "operational", version: "1.0.0", service: "OptimEngine Solana Gateway",
    chain: "Solana Mainnet", network: NETWORK, wallet: WALLET,
    endpoints: Object.keys(paidRoutes).length, facilitator: "CDP Coinbase",
    security: { engine_api_key: !!ENGINE_KEY, rate_limiting: true, helmet: true }
  });
});

app.get("/.well-known/x402", (_req, res) => {
  const endpoints = {};
  for (const [route, config] of Object.entries(paidRoutes)) {
    const [method, path] = route.split(" ");
    endpoints[path] = { method, price: config.accepts[0].price, network: NETWORK, payTo: WALLET };
  }
  res.json({ service: "OptimEngine", version: "solana-1.0.0", chain: "Solana Mainnet", endpoints });
});

app.get("/stats", (_req, res) => {
  res.json({
    service: "OptimEngine Solana Gateway", chain: "Solana Mainnet",
    uptime_since: stats.started_at, requests: stats.requests,
    payments: { verified: stats.payments.verified, unique_payers: stats.payments.unique_payers.size },
    solves: stats.solves,
    alert: stats.payments.verified > 0 ? `🟢 ${stats.payments.verified} payment(s)!` : "⚪ No payments yet"
  });
});

app.get("/docs/templates", (_req, res) => {
  import("fs").then(fs => {
    const templates = JSON.parse(fs.readFileSync("docs/prediction-market-templates.json", "utf8"));
    res.json(templates);
  });
});
app.get("/docs/templates/prediction-markets", (_req, res) => {
  import("fs").then(fs => {
    const templates = JSON.parse(fs.readFileSync("docs/prediction-market-templates.json", "utf8"));
    res.json(templates);
  });
});
app.get("/docs", (_req, res) => {
  res.json({
    service: "OptimEngine Solana Gateway", chain: "Solana Mainnet (solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)",
    facilitator: "CDP Coinbase", wallet: WALLET,
    endpoints: Object.entries(paidRoutes).map(([r, c]) => {
      const [method, path] = r.split(" ");
      return { method, path, price: c.accepts[0].price, description: c.description };
    })
  });
});

app.listen(PORT, () => {
  console.log(`[SOLANA GATEWAY] Port ${PORT} | ${NETWORK} | Wallet ${WALLET}`);
  console.log(`[SOLANA GATEWAY] ${Object.keys(paidRoutes).length} paid endpoints | CDP facilitator`);
  console.log(`[SOLANA GATEWAY] Security: ENGINE_KEY=${!!ENGINE_KEY} | Helmet | RateLimit`);
});
