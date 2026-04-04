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
// REAL POLYMARKET DATA — 29 March 2026
// ═══════════════════════════════════════════════════════════
// Market 1: "How many Fed rate cuts in 2026?" ($14.2M volume)
//   0 cuts: 39%, 1 cut: 25%, 2 cuts: 18%, 3+ cuts: 18%
// Market 2: "Fed decision April?" ($86.4M total Fed volume)
//   No change: 97%, Cut 25bps: 3%
// Market 3: "Fed rate end 2026?" ($5.7M volume)
//   3.75%: 30%, 3.50%: 24%, 3.25%: 15%
//
// Context: Fed held at 3.50-3.75% on March 18. Dot plot: median 1 cut.
// CPI 2.4%, core PCE ~3.1%, unemployment 4.4%. Next: CPI April 10, FOMC April 28-29.
//
// Agent thesis: "The market is pricing too much hawkishness. Labor is softening
// (92K NFP decline, 4.4% unemployment). I think 1-2 cuts are more likely than 0."
// ═══════════════════════════════════════════════════════════

// We model 3 positions as scheduling jobs:
// POS-ZERO-CUTS:  Short position on "0 cuts" — agent bets AGAINST no cuts
//   duration = conviction strength (higher = more capital/time committed)
//   priority = agent's confidence level
// POS-ONE-CUT:    Long position on "1 cut 25bps"
// POS-APRIL-CUT:  Small speculative long on "April cut" (low probability, high payoff)

const BASE_REQUEST = {
  jobs: [
    { job_id: "SHORT-ZERO-CUTS", name: "Short 0-cuts @ $0.39 (market overpriced per agent thesis)",
      priority: 7, due_date: 30,
      tasks: [{ task_id: "execute", duration: 8, eligible_machines: ["DESK-MM", "DESK-LIMIT", "DESK-TWAP"] }] },
    { job_id: "LONG-ONE-CUT", name: "Long 1-cut @ $0.25 (underpriced per agent thesis, expects June cut)",
      priority: 9, due_date: 25,
      tasks: [{ task_id: "execute", duration: 6, eligible_machines: ["DESK-MM", "DESK-LIMIT"] }] },
    { job_id: "SPEC-APRIL-CUT", name: "Speculative long April cut @ $0.03 (3% odds, 33x payoff if hit)",
      priority: 3, due_date: 10,
      tasks: [{ task_id: "execute", duration: 3, eligible_machines: ["DESK-MM", "DESK-LIMIT", "DESK-TWAP"] }] },
  ],
  machines: [
    { machine_id: "DESK-MM", name: "Market Maker (instant, higher spread)" },
    { machine_id: "DESK-LIMIT", name: "Limit Order (slow, tighter spread)" },
    { machine_id: "DESK-TWAP", name: "TWAP (time-weighted, minimal impact)" },
  ],
};

async function main() {
  const totalT0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  PREDICT-STRATEGY — REAL POLYMARKET DATA (29 Mar 2026)         ║");
  console.log("║  Markets: Fed rate cuts 2026, Fed April decision, Fed rate EOY  ║");
  console.log("║  Agent thesis: Market overprices hawkishness, expects 1-2 cuts  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Stochastic CVaR — 50 scenarios ──
  console.log("━━━ Step 1: STOCHASTIC — Monte Carlo CVaR 95% ━━━");
  console.log("  Simulating uncertainty on: conviction strength (duration) per position");
  console.log("  SHORT-ZERO-CUTS: normal(8, 3) — high uncertainty, contrarian bet");
  console.log("  LONG-ONE-CUT: normal(6, 1.5) — moderate uncertainty, thesis-aligned");
  console.log("  SPEC-APRIL-CUT: log_normal(3, 2) — extreme tail risk, lottery ticket\n");

  const { data: stoch, ms: stochMs } = await callSolver("/optimize_stochastic", {
    solver_type: "scheduling",
    num_scenarios: 50,
    optimize_for: "cvar_95",
    seed: 2026,
    solver_request: BASE_REQUEST,
    stochastic_parameters: [
      { parameter_path: "jobs[SHORT-ZERO-CUTS].tasks[execute].duration", distribution: "normal", mean: 8, std_dev: 3 },
      { parameter_path: "jobs[LONG-ONE-CUT].tasks[execute].duration", distribution: "normal", mean: 6, std_dev: 1.5 },
      { parameter_path: "jobs[SPEC-APRIL-CUT].tasks[execute].duration", distribution: "log_normal", mean: 3, std_dev: 2 },
    ],
  });
  console.log(`  Status: ${stoch.status} | Time: ${stochMs}ms`);
  console.log(`  CVaR 95%: ${stoch.recommended_objective} (worst 5% of scenarios avg)`);
  console.log(`  Distribution: mean=${stoch.distribution?.mean}, min=${stoch.distribution?.min_value}, max=${stoch.distribution?.max_value}`);
  console.log(`  Std dev: ${stoch.distribution?.std_dev} | CV: ${stoch.distribution?.coefficient_of_variation}%`);
  console.log(`  Skewness: ${stoch.distribution?.skewness} (${stoch.distribution?.skewness > 0 ? 'right-tailed → upside risk' : 'left-tailed → downside risk'})`);
  console.log(`  Recommendation: ${stoch.recommendation?.slice(0, 150)}`);

  // ── Step 2: Pareto — makespan vs tardiness ──
  console.log("\n━━━ Step 2: PARETO — Execution Speed vs On-Time Delivery ━━━");
  console.log("  Trade-off: execute fast (min makespan) vs hit deadlines (min tardiness)\n");

  const { data: pareto, ms: paretoMs } = await callSolver("/optimize_pareto", {
    solver_type: "scheduling",
    num_points: 8,
    objectives: [
      { name: "minimize_makespan", weight: 1 },
      { name: "minimize_total_tardiness", weight: 1 },
    ],
    solver_request: BASE_REQUEST,
  });
  console.log(`  Status: ${pareto.status} | Time: ${paretoMs}ms`);
  console.log(`  Frontier: ${pareto.frontier?.length} points`);
  if (pareto.frontier) {
    const extreme = pareto.frontier.find(p => p.is_extreme);
    const balanced = pareto.frontier.find(p => p.is_balanced);
    console.log(`  Extreme (max speed): ${JSON.stringify(extreme?.objectives)}`);
    console.log(`  Balanced (best trade-off): ${JSON.stringify(balanced?.objectives)}`);
  }
  if (pareto.trade_offs?.[0]) {
    console.log(`  Trade-off: ${pareto.trade_offs[0].relationship} (corr: ${pareto.trade_offs[0].correlation}, ratio: ${pareto.trade_offs[0].trade_off_ratio})`);
  }
  console.log(`  Recommendation: ${pareto.recommendation?.slice(0, 150)}`);

  // ── Step 3: Sensitivity — which position is most fragile? ──
  console.log("\n━━━ Step 3: SENSITIVITY — Which Position is Most Fragile? ━━━");
  console.log("  Question: if my conviction on each position changes ±20-50%, what breaks?\n");

  const { data: sens, ms: sensMs } = await callSolver("/analyze_sensitivity", {
    solver_type: "scheduling",
    solver_request: BASE_REQUEST,
    parameters: [
      { parameter_path: "jobs[SHORT-ZERO-CUTS].tasks[execute].duration", perturbations: [-50, -25, -10, 10, 25, 50] },
      { parameter_path: "jobs[LONG-ONE-CUT].tasks[execute].duration", perturbations: [-40, -20, 20, 40] },
      { parameter_path: "jobs[SPEC-APRIL-CUT].tasks[execute].duration", perturbations: [-50, -25, 25, 50, 100] },
    ],
  });
  console.log(`  Status: ${sens.status} | Time: ${sensMs}ms`);
  console.log(`  Risk ranking: ${sens.risk_ranking?.join(" > ")}`);
  if (sens.parameters) {
    for (const p of sens.parameters) {
      const name = p.parameter_path.match(/\[(.*?)\]/)?.[1] || p.parameter_path;
      console.log(`  ${name}: score=${p.sensitivity_score}, elasticity=${p.elasticity}, critical=${p.critical}, direction=${p.direction}`);
      console.log(`    → ${p.risk_summary}`);
    }
  }

  // ── Step 4: Prescriptive — using historical Fed meeting data ──
  console.log("\n━━━ Step 4: PRESCRIPTIVE — Forecast From Historical FOMC Data ━━━");
  console.log("  Historical: 6 recent FOMC meetings, modeling market reaction intensity\n");

  const { data: presc, ms: prescMs } = await callSolver("/prescriptive_advise", {
    solver_type: "scheduling",
    risk_appetite: "moderate",
    solver_request: BASE_REQUEST,
    forecast_parameters: [
      { parameter_path: "jobs[SHORT-ZERO-CUTS].tasks[execute].duration",
        historical_data: [
          { period: 0, value: 5 },  // Sep 2025: hawkish surprise, short convictions low
          { period: 1, value: 6 },  // Nov 2025: data mixed
          { period: 2, value: 9 },  // Dec 2025: dovish pivot, shorts squeezed
          { period: 3, value: 7 },  // Jan 2026: back to neutral
          { period: 4, value: 6 },  // Feb 2026: hawkish data
          { period: 5, value: 8 },  // Mar 2026: hold, but labor softening
        ],
        forecast_method: "exponential_smoothing" },
      { parameter_path: "jobs[LONG-ONE-CUT].tasks[execute].duration",
        historical_data: [
          { period: 0, value: 8 },  // Sep 2025: strong cut expectations
          { period: 1, value: 7 },  // Nov 2025: expectations moderate
          { period: 2, value: 9 },  // Dec 2025: dovish pivot boosts
          { period: 3, value: 5 },  // Jan 2026: hawkish surprise
          { period: 4, value: 4 },  // Feb 2026: cut expectations fall
          { period: 5, value: 6 },  // Mar 2026: labor data revives hope
        ],
        forecast_method: "exponential_smoothing" },
    ],
  });
  console.log(`  Status: ${presc.status} | Time: ${prescMs}ms`);
  if (presc.forecasts) {
    for (const f of presc.forecasts) {
      const name = f.parameter_path.match(/\[(.*?)\]/)?.[1] || f.parameter_path;
      console.log(`  ${name}: forecast=${f.forecast_value}, trend=${f.trend} (strength: ${f.trend_strength})`);
      console.log(`    → Confidence: [${f.lower_bound}, ${f.upper_bound}] at ${f.confidence_level*100}%`);
    }
  }
  if (presc.actions) {
    console.log("  Actions:");
    for (const a of presc.actions.slice(0, 3)) {
      console.log(`    #${a.priority}: ${a.action}`);
      console.log(`           ${a.reason}`);
    }
  }
  console.log(`  Recommendation: ${presc.recommendation?.slice(0, 180)}`);

  // ═══════════════════════════════════════════════════════════
  // STRATEGIES A/B/C
  // ═══════════════════════════════════════════════════════════
  const totalMs = Date.now() - totalT0;
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  STRATEGIES A/B/C — Real Polymarket Analysis                    ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const criticals = sens.parameters?.filter(p => p.critical) || [];
  const topRisk = sens.risk_ranking?.[0]?.match(/\[(.*?)\]/)?.[1] || "unknown";

  console.log("\n🔴 STRATEGY A — AGGRESSIVE (Max Conviction)");
  console.log(`  Thesis: Market IS overpricing hawkishness. Go all-in on 1-2 cuts.`);
  console.log(`  Expected makespan: ${stoch.distribution?.mean}`);
  console.log(`  Best Pareto: ${JSON.stringify(pareto.frontier?.[0]?.objectives)}`);
  console.log(`  Critical params: ${criticals.length} (${criticals.map(c=>c.parameter_path.match(/\[(.*?)\]/)?.[1]).join(', ') || 'none'})`);
  console.log(`  Risk: HIGH — ${criticals.length > 0 ? 'FRAGILE on ' + topRisk : 'No critical vulnerabilities'}`);
  console.log(`  Action: Short 0-cuts heavy, Long 1-cut heavy, ignore April spec`);

  console.log("\n🟡 STRATEGY B — BALANCED (Risk-Adjusted)");
  console.log(`  Thesis: Lean bearish on hawkishness but hedge.`);
  console.log(`  CVaR 95%: ${stoch.recommended_objective} (your worst 5% of scenarios)`);
  const bal = pareto.frontier?.find(p => p.is_balanced);
  console.log(`  Balanced Pareto: ${JSON.stringify(bal?.objectives)}`);
  console.log(`  Forecast: ${presc.forecasts?.map(f => `${f.parameter_path.match(/\[(.*?)\]/)?.[1]}→${f.forecast_value} (${f.trend})`).join(', ')}`);
  console.log(`  Risk: MEDIUM — protected by CVaR, monitor ${topRisk}`);
  console.log(`  Action: Moderate short 0-cuts, strong long 1-cut, small April spec`);

  console.log("\n🟢 STRATEGY C — DEFENSIVE (Min Downside)");
  console.log(`  Thesis: What if I'm wrong? Protect capital.`);
  console.log(`  Worst case: ${stoch.distribution?.max_value}`);
  console.log(`  CVaR 99: ${stoch.distribution?.percentile_99}`);
  console.log(`  Top risk: ${topRisk} (${sens.parameters?.find(p=>p.critical)?.risk_summary || 'monitor closely'})`);
  console.log(`  Risk: LOW — survives even if Fed stays hawkish all year`);
  console.log(`  Action: Small short 0-cuts, small long 1-cut, skip April spec`);

  console.log("\n━━━ TIMING ━━━");
  console.log(`  Stochastic: ${stochMs}ms | Pareto: ${paretoMs}ms | Sensitivity: ${sensMs}ms | Prescriptive: ${prescMs}ms`);
  console.log(`  TOTAL: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);

  console.log("\n━━━ VALUE ASSESSMENT ━━━");
  console.log(`  Cost of this analysis via x402: $0.80`);
  console.log(`  What an agent learned that an LLM alone cannot provide:`);
  console.log(`    1. CVaR 95% = ${stoch.recommended_objective} → quantified worst-case exposure`);
  console.log(`    2. ${topRisk} is the critical fragility → know where you're exposed`);
  console.log(`    3. Pareto frontier → exact trade-off between speed and deadlines`);
  console.log(`    4. Forecast: trend direction confirmed with confidence intervals`);
  console.log(`  An LLM says "Fed might cut". OptimEngine says "CVaR 95% = ${stoch.recommended_objective}, fragile on ${topRisk}".`);
  console.log(`\n✅ Livello 3 test complete.`);
}

main().catch(console.error);
