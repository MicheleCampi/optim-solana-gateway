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
  const ms = Date.now() - t0;
  return { data, ms };
}

// === SCENARIO: 3 Prediction Market Positions ===
// POS-FED:  "Fed cuts rates June"     — agent estimates 60% prob, market $0.55 — duration models conviction strength
// POS-BTC:  "BTC above 100K Q2"       — agent estimates 45% prob, market $0.50 — high uncertainty
// POS-AI:   "Anthropic best AI April"  — agent estimates 80% prob, market $0.75 — high confidence

const BASE_REQUEST = {
  jobs: [
    { job_id: "POS-FED", name: "Fed rate cut June", priority: 8, due_date: 15,
      tasks: [{ task_id: "trade", duration: 6, eligible_machines: ["DESK-1", "DESK-2"] }] },
    { job_id: "POS-BTC", name: "BTC above 100K Q2", priority: 5, due_date: 20,
      tasks: [{ task_id: "trade", duration: 8, eligible_machines: ["DESK-1", "DESK-2", "DESK-3"] }] },
    { job_id: "POS-AI", name: "Anthropic best AI April", priority: 9, due_date: 10,
      tasks: [{ task_id: "trade", duration: 3, eligible_machines: ["DESK-2", "DESK-3"] }] },
  ],
  machines: [
    { machine_id: "DESK-1", name: "Trading Desk 1" },
    { machine_id: "DESK-2", name: "Trading Desk 2" },
    { machine_id: "DESK-3", name: "Trading Desk 3" },
  ],
};

async function main() {
  const totalT0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  PREDICT-STRATEGY PIPELINE TEST — Prediction Market        ║");
  console.log("║  3 Positions: Fed Rate, BTC 100K, AI Model Winner          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Stochastic CVaR ──
  console.log("━━━ Step 1: Stochastic — Monte Carlo CVaR 95% (30 scenarios) ━━━");
  const { data: stoch, ms: stochMs } = await callSolver("/optimize_stochastic", {
    solver_type: "scheduling",
    num_scenarios: 30,
    optimize_for: "cvar_95",
    seed: 42,
    solver_request: BASE_REQUEST,
    stochastic_parameters: [
      { parameter_path: "jobs[POS-FED].tasks[trade].duration", distribution: "normal", mean: 6, std_dev: 2 },
      { parameter_path: "jobs[POS-BTC].tasks[trade].duration", distribution: "log_normal", mean: 8, std_dev: 3 },
      { parameter_path: "jobs[POS-AI].tasks[trade].duration", distribution: "triangular", min_value: 1, mode_value: 3, max_value: 7 },
    ],
  });
  console.log(`  Status: ${stoch.status} | Time: ${stochMs}ms`);
  console.log(`  CVaR 95% objective: ${stoch.recommended_objective}`);
  console.log(`  Distribution: mean=${stoch.distribution?.mean}, median=${stoch.distribution?.median}, max=${stoch.distribution?.max_value}`);
  console.log(`  Risk premium: ${stoch.risk?.risk_premium_pct}%`);
  console.log(`  Recommendation: ${stoch.recommendation?.slice(0, 120)}...`);

  // ── Step 2: Pareto ──
  console.log("\n━━━ Step 2: Pareto — Risk/Return Trade-off (6 points) ━━━");
  const { data: pareto, ms: paretoMs } = await callSolver("/optimize_pareto", {
    solver_type: "scheduling",
    num_points: 6,
    objectives: [
      { name: "minimize_makespan", weight: 1 },
      { name: "minimize_total_tardiness", weight: 1 },
    ],
    solver_request: BASE_REQUEST,
  });
  console.log(`  Status: ${pareto.status} | Time: ${paretoMs}ms`);
  console.log(`  Frontier points: ${pareto.frontier?.length}`);
  if (pareto.frontier) {
    const balanced = pareto.frontier.find(p => p.is_balanced) || pareto.frontier[Math.floor(pareto.frontier.length / 2)];
    console.log(`  Balanced point: ${JSON.stringify(balanced?.objectives)}`);
  }
  if (pareto.trade_offs?.[0]) {
    console.log(`  Trade-off: ${pareto.trade_offs[0].relationship} (correlation: ${pareto.trade_offs[0].correlation})`);
  }
  console.log(`  Recommendation: ${pareto.recommendation?.slice(0, 120)}...`);

  // ── Step 3: Sensitivity ──
  console.log("\n━━━ Step 3: Sensitivity — Fragility Check ━━━");
  const { data: sens, ms: sensMs } = await callSolver("/analyze_sensitivity", {
    solver_type: "scheduling",
    solver_request: BASE_REQUEST,
    parameters: [
      { parameter_path: "jobs[POS-FED].tasks[trade].duration", perturbations: [-30, -20, -10, 10, 20, 30] },
      { parameter_path: "jobs[POS-BTC].tasks[trade].duration", perturbations: [-50, -25, 25, 50] },
      { parameter_path: "jobs[POS-AI].tasks[trade].duration", perturbations: [-30, -15, 15, 30] },
    ],
  });
  console.log(`  Status: ${sens.status} | Time: ${sensMs}ms`);
  console.log(`  Risk ranking: ${sens.risk_ranking?.join(" > ")}`);
  if (sens.parameters) {
    for (const p of sens.parameters) {
      console.log(`  ${p.parameter_name}: score=${p.sensitivity_score}, elasticity=${p.elasticity}, critical=${p.critical}, direction=${p.direction}`);
    }
  }

  // ── Step 4: Prescriptive ──
  console.log("\n━━━ Step 4: Prescriptive — Forecast + Strategy ━━━");
  const { data: presc, ms: prescMs } = await callSolver("/prescriptive_advise", {
    solver_type: "scheduling",
    risk_appetite: "moderate",
    solver_request: BASE_REQUEST,
    forecast_parameters: [
      { parameter_path: "jobs[POS-FED].tasks[trade].duration",
        historical_data: [{ period: 0, value: 4 }, { period: 1, value: 5 }, { period: 2, value: 6 }, { period: 3, value: 5 }, { period: 4, value: 7 }, { period: 5, value: 6 }],
        forecast_method: "exponential_smoothing" },
      { parameter_path: "jobs[POS-BTC].tasks[trade].duration",
        historical_data: [{ period: 0, value: 10 }, { period: 1, value: 9 }, { period: 2, value: 8 }, { period: 3, value: 7 }, { period: 4, value: 9 }, { period: 5, value: 8 }],
        forecast_method: "linear_trend" },
    ],
  });
  console.log(`  Status: ${presc.status} | Time: ${prescMs}ms`);
  if (presc.forecasts) {
    for (const f of presc.forecasts) {
      console.log(`  Forecast ${f.parameter_path}: value=${f.forecast_value}, trend=${f.trend}, bounds=[${f.lower_bound}, ${f.upper_bound}]`);
    }
  }
  if (presc.actions) {
    console.log(`  Top actions:`);
    for (const a of presc.actions.slice(0, 3)) {
      console.log(`    #${a.priority}: ${a.action} — ${a.reason}`);
    }
  }
  console.log(`  Recommendation: ${presc.recommendation?.slice(0, 120)}...`);

  // ── AGGREGATION: Strategies A/B/C ──
  const totalMs = Date.now() - totalT0;
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  STRATEGIES A/B/C — Aggregated Results                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n🔴 Strategy A — AGGRESSIVE (Max Edge)");
  console.log(`  Expected makespan: ${stoch.distribution?.mean}`);
  console.log(`  Best Pareto point: ${JSON.stringify(pareto.frontier?.[0]?.objectives)}`);
  const criticals = sens.parameters?.filter(p => p.critical) || [];
  console.log(`  Fragility: ${criticals.length} critical parameter(s)`);
  console.log(`  Risk: HIGH — works if estimates are correct`);

  console.log("\n🟡 Strategy B — BALANCED (Risk-Adjusted)");
  console.log(`  CVaR 95% objective: ${stoch.recommended_objective}`);
  const balancedPt = pareto.frontier?.find(p => p.is_balanced) || pareto.frontier?.[Math.floor((pareto.frontier?.length || 2) / 2)];
  console.log(`  Balanced Pareto: ${JSON.stringify(balancedPt?.objectives)}`);
  console.log(`  Risk premium: ${stoch.risk?.risk_premium_pct}%`);
  console.log(`  Recommendation: ${presc.recommendation?.slice(0, 100)}`);

  console.log("\n🟢 Strategy C — DEFENSIVE (Min Downside)");
  console.log(`  Worst case: ${stoch.distribution?.max_value}`);
  console.log(`  CVaR 99: ${stoch.risk?.cvar_99 || stoch.distribution?.percentile_99}`);
  console.log(`  Top risk: ${sens.risk_ranking?.[0]}`);
  console.log(`  Risk: LOW — sacrifices upside for protection`);

  console.log("\n━━━ TIMING ━━━");
  console.log(`  Stochastic: ${stochMs}ms`);
  console.log(`  Pareto:     ${paretoMs}ms`);
  console.log(`  Sensitivity: ${sensMs}ms`);
  console.log(`  Prescriptive: ${prescMs}ms`);
  console.log(`  TOTAL:      ${totalMs}ms`);
  console.log(`\n✅ Pipeline test complete. Total: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);
}

main().catch(console.error);
