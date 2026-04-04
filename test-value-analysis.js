import "dotenv/config";

const ENGINE_URL = process.env.OPTIMENGINE_URL;
const ENGINE_KEY = process.env.ENGINE_API_KEY;

async function callSolver(path, body) {
  const t0 = Date.now();
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Key": ENGINE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { data, ms: Date.now() - t0 };
}

// ═══════════════════════════════════════════════════════════
// SCENARIO 2: DeFi Liquidity Routing — /route-liquidity
// An agent has $10,000 USDC to allocate across 3 DeFi pools.
// Each pool has different APY, risk, and capacity constraints.
// The agent wants to know: optimal allocation with worst-case protection.
// ═══════════════════════════════════════════════════════════

const ROUTING_REQUEST = {
  depot_id: "WALLET",
  locations: [
    { location_id: "WALLET", demand: 0, name: "Agent Wallet" },
    { location_id: "POOL-AAVE", demand: 4, name: "Aave USDC (8% APY, low risk)", time_window_start: 0, time_window_end: 100 },
    { location_id: "POOL-COMPOUND", demand: 3, name: "Compound USDC (6% APY, medium risk)", time_window_start: 0, time_window_end: 100 },
    { location_id: "POOL-PENDLE", demand: 5, name: "Pendle PT-USDC (12% APY, higher risk)", time_window_start: 0, time_window_end: 80 },
    { location_id: "POOL-MORPHO", demand: 3, name: "Morpho USDC (9% APY, medium risk)", time_window_start: 0, time_window_end: 100 },
  ],
  vehicles: [
    { vehicle_id: "TRANCHE-1", capacity: 8, name: "Conservative tranche ($8K max)" },
    { vehicle_id: "TRANCHE-2", capacity: 6, name: "Aggressive tranche ($6K max)" },
  ],
  distance_matrix: [
    { from_id: "WALLET", to_id: "POOL-AAVE", distance: 2 },
    { from_id: "WALLET", to_id: "POOL-COMPOUND", distance: 3 },
    { from_id: "WALLET", to_id: "POOL-PENDLE", distance: 5 },
    { from_id: "WALLET", to_id: "POOL-MORPHO", distance: 4 },
    { from_id: "POOL-AAVE", to_id: "WALLET", distance: 2 },
    { from_id: "POOL-AAVE", to_id: "POOL-COMPOUND", distance: 2 },
    { from_id: "POOL-AAVE", to_id: "POOL-PENDLE", distance: 4 },
    { from_id: "POOL-AAVE", to_id: "POOL-MORPHO", distance: 3 },
    { from_id: "POOL-COMPOUND", to_id: "WALLET", distance: 3 },
    { from_id: "POOL-COMPOUND", to_id: "POOL-AAVE", distance: 2 },
    { from_id: "POOL-COMPOUND", to_id: "POOL-PENDLE", distance: 3 },
    { from_id: "POOL-COMPOUND", to_id: "POOL-MORPHO", distance: 2 },
    { from_id: "POOL-PENDLE", to_id: "WALLET", distance: 5 },
    { from_id: "POOL-PENDLE", to_id: "POOL-AAVE", distance: 4 },
    { from_id: "POOL-PENDLE", to_id: "POOL-COMPOUND", distance: 3 },
    { from_id: "POOL-PENDLE", to_id: "POOL-MORPHO", distance: 3 },
    { from_id: "POOL-MORPHO", to_id: "WALLET", distance: 4 },
    { from_id: "POOL-MORPHO", to_id: "POOL-AAVE", distance: 3 },
    { from_id: "POOL-MORPHO", to_id: "POOL-COMPOUND", distance: 2 },
    { from_id: "POOL-MORPHO", to_id: "POOL-PENDLE", distance: 3 },
  ],
};

async function main() {
  const totalT0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  ROUTE-LIQUIDITY TEST — DeFi Pool Allocation                   ║");
  console.log("║  $10K USDC across 4 pools: Aave, Compound, Pendle, Morpho      ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  // Step 1: Optimal routing
  console.log("━━━ Step 1: ROUTING — Optimal allocation ━━━");
  const { data: route, ms: routeMs } = await callSolver("/optimize_routing", {
    allow_drop_visits: true, max_solve_time_seconds: 5,
    ...ROUTING_REQUEST,
  });
  console.log(`  Status: ${route.status} | Time: ${routeMs}ms`);
  if (route.routes) {
    for (const r of route.routes) {
      if (r.is_used) {
        const stops = r.stops?.map(s => s.location_id).join(" → ");
        console.log(`  ${r.vehicle_id}: ${stops} (load: ${r.total_load}, distance: ${r.total_distance})`);
      }
    }
  }
  if (route.dropped_locations?.length) console.log(`  Dropped: ${route.dropped_locations.join(', ')}`);

  // Step 2: Robust (worst-case)
  console.log("\n━━━ Step 2: ROBUST — Worst-case protection (APY uncertainty) ━━━");
  const { data: robust, ms: robustMs } = await callSolver("/optimize_robust", {
    solver_type: "routing",
    mode: "percentile_95",
    num_scenarios: 3,
    solver_request: ROUTING_REQUEST,
    uncertain_parameters: [
      { parameter_path: "locations[POOL-PENDLE].demand", min_value: 3, max_value: 8, nominal_value: 5 },
      { parameter_path: "locations[POOL-AAVE].demand", min_value: 2, max_value: 6, nominal_value: 4 },
    ],
  });
  console.log(`  Status: ${robust.status} | Time: ${robustMs}ms`);
  if (robust.scenarios) {
    const nominal = robust.scenarios.find(s => s.is_nominal);
    const worst = robust.scenarios.find(s => s.is_worst_case);
    const feasiblePct = Math.round(100 * robust.scenarios.filter(s => s.feasible).length / robust.scenarios.length);
    console.log(`  Nominal: ${nominal?.objective_value} | Worst: ${worst?.objective_value}`);
    console.log(`  Feasible: ${feasiblePct}% of scenarios`);
    console.log(`  Gap nominal→worst: ${nominal && worst ? Math.round(100*(worst.objective_value - nominal.objective_value)/nominal.objective_value) : '?'}%`);
  }
  console.log(`  Recommendation: ${robust.recommendation?.slice(0, 150)}`);

  const totalMs = Date.now() - totalT0;

  // ═══════════════════════════════════════════════════════════
  // VALUE ANALYSIS
  // ═══════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  VALUE ANALYSIS — Does the service justify the price?           ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  console.log("━━━ SCENARIO 1: Prediction Markets (previous test) ━━━");
  console.log("  Cost: $0.80 + $0.03 gas = $0.83");
  console.log("  Time: 2.9s");
  console.log("  Agent trades: 100/month on Polymarket");
  console.log("  Monthly cost: $83");
  console.log("  Value received:");
  console.log("    - CVaR 95% = 13.33 (quantified worst-case)");
  console.log("    - Critical parameter identified (SHORT-ZERO-CUTS, elasticity 1.0x)");
  console.log("    - Forecast with trend (+5.4%/period, -10.1%/period)");
  console.log("    - 3 strategies A/B/C with actions");
  console.log("  Value question: if CVaR analysis prevents 1 bad trade of $50/month,");
  console.log("    ROI = ($50 saved - $83 cost) = -$33 (breakeven at ~2 prevented bad trades)");
  console.log("  At 5% improvement in win rate on $1000 avg position:");
  console.log("    = $50/trade × 5 improved trades/month = $250 value");
  console.log("    ROI = ($250 - $83) / $83 = 201%");
  console.log("");

  console.log("━━━ SCENARIO 2: DeFi Liquidity Routing (this test) ━━━");
  console.log("  Cost: $0.35 + $0.03 gas = $0.38");
  console.log(`  Time: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);
  console.log("  Agent rebalances: 10x/month across pools");
  console.log("  Monthly cost: $3.80");
  console.log("  Value received:");
  console.log("    - Optimal routing across 4 pools with capacity constraints");
  if (robust.scenarios) {
    const nominal = robust.scenarios.find(s => s.is_nominal);
    const worst = robust.scenarios.find(s => s.is_worst_case);
    console.log(`    - Worst-case distance: ${worst?.objective_value} vs nominal: ${nominal?.objective_value}`);
    const feasiblePct = Math.round(100 * robust.scenarios.filter(s => s.feasible).length / robust.scenarios.length);
    console.log(`    - ${feasiblePct}% of uncertainty scenarios remain feasible`);
  }
  console.log("  Value question: on $10K allocation, 0.5% better APY = $50/year");
  console.log("    Monthly value of optimal routing: ~$4.17");
  console.log("    ROI = ($4.17 - $3.80) / $3.80 = 10% (marginal)");
  console.log("    At $100K allocation: $41.70/month value, ROI = 997%");
  console.log("");

  console.log("━━━ CONCLUSION ━━━");
  console.log("  Prediction Markets: STRONG value at $0.80/analysis for active traders");
  console.log("    → 100+ trades/month justifies cost if win rate improves even 2-3%");
  console.log("    → Target: agents making $500+ in monthly trades");
  console.log("");
  console.log("  DeFi Routing: MARGINAL value at $0.35 for small allocations (<$10K)");
  console.log("    → Becomes strong at $50K+ allocations where 0.5% APY improvement matters");
  console.log("    → Target: agents managing $50K+ across DeFi pools");
  console.log("");
  console.log("  Key insight: the VALUE is proportional to the CAPITAL AT RISK.");
  console.log("  $0.80 is nothing for an agent managing $10K+.");
  console.log("  $0.80 is expensive for an agent managing $100.");
  console.log("  OptimEngine's target: agents with $1K+ capital per decision.");

  console.log(`\n  Total test time: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);
  console.log("✅ Value analysis complete.");
}

main().catch(console.error);
