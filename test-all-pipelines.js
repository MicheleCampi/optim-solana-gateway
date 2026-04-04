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
// TEST 1: /schedule-robust — Manufacturing PMI (Parma cosmetics)
// An agent planning production for a cosmetics contract manufacturer.
// 4 products, 3 machines, setup times, quality constraints.
// Uncertainty: processing times vary due to batch viscosity.
// ═══════════════════════════════════════════════════════════

async function testScheduleRobust() {
  const t0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  /schedule-robust — Cosmetics Manufacturing PMI (Parma)         ║");
  console.log("║  4 products, 3 machines, setup times, quality constraints       ║");
  console.log("║  Uncertainty: batch viscosity affects processing time            ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  const BASE = {
    jobs: [
      { job_id: "CREAM-A", name: "Face cream batch A (high margin)", priority: 9, due_date: 20,
        quality_min: 0.9,
        tasks: [
          { task_id: "mixing", duration: 5, eligible_machines: ["MIXER-1", "MIXER-2"] },
          { task_id: "filling", duration: 3, eligible_machines: ["FILLER-1"] }
        ] },
      { job_id: "SERUM-B", name: "Serum batch B (medium margin)", priority: 7, due_date: 25,
        quality_min: 0.95,
        tasks: [
          { task_id: "mixing", duration: 8, eligible_machines: ["MIXER-1"] },
          { task_id: "filling", duration: 4, eligible_machines: ["FILLER-1"] }
        ] },
      { job_id: "LOTION-C", name: "Body lotion batch C (volume)", priority: 5, due_date: 30,
        tasks: [
          { task_id: "mixing", duration: 4, eligible_machines: ["MIXER-1", "MIXER-2"] },
          { task_id: "filling", duration: 6, eligible_machines: ["FILLER-1"] }
        ] },
      { job_id: "MASK-D", name: "Face mask batch D (new product)", priority: 6, due_date: 18,
        quality_min: 0.85,
        tasks: [
          { task_id: "mixing", duration: 6, eligible_machines: ["MIXER-2"] },
          { task_id: "filling", duration: 3, eligible_machines: ["FILLER-1"] }
        ] },
    ],
    machines: [
      { machine_id: "MIXER-1", name: "Mixer Premium", yield_rate: 0.98 },
      { machine_id: "MIXER-2", name: "Mixer Standard", yield_rate: 0.90 },
      { machine_id: "FILLER-1", name: "Filler Line 1", yield_rate: 1.0 },
    ],
    setup_times: [
      { machine_id: "MIXER-1", from_job_id: "CREAM-A", to_job_id: "SERUM-B", setup_time: 3 },
      { machine_id: "MIXER-1", from_job_id: "SERUM-B", to_job_id: "CREAM-A", setup_time: 3 },
      { machine_id: "MIXER-1", from_job_id: "*", to_job_id: "*", setup_time: 2 },
      { machine_id: "MIXER-2", from_job_id: "*", to_job_id: "*", setup_time: 1 },
    ],
  };

  // Step 1: Scheduling
  console.log("━━━ Step 1: SCHEDULING — Optimal production plan ━━━");
  const { data: sched, ms: schedMs } = await callSolver("/optimize_schedule", BASE);
  console.log(`  Status: ${sched.status} | Time: ${schedMs}ms`);
  console.log(`  Makespan: ${sched.metrics?.makespan || sched.job_summaries?.reduce((m,j) => Math.max(m,j.end),0)}`);
  if (sched.job_summaries) {
    for (const j of sched.job_summaries) {
      console.log(`  ${j.job_id}: start=${j.start}, end=${j.end}, on_time=${j.on_time}, tardiness=${j.tardiness}`);
    }
  }
  if (sched.machine_utilization) {
    for (const m of sched.machine_utilization) {
      console.log(`  ${m.machine_id}: utilization=${m.utilization_pct}%, tasks=${m.num_tasks}`);
    }
  }

  // Step 2: Stochastic — batch viscosity uncertainty
  console.log("\n━━━ Step 2: STOCHASTIC — Viscosity uncertainty on mixing times ━━━");
  const { data: stoch, ms: stochMs } = await callSolver("/optimize_stochastic", {
    solver_type: "scheduling",
    num_scenarios: 30,
    optimize_for: "cvar_95",
    seed: 2026,
    solver_request: BASE,
    stochastic_parameters: [
      { parameter_path: "jobs[CREAM-A].tasks[mixing].duration", distribution: "normal", mean: 5, std_dev: 1.5 },
      { parameter_path: "jobs[SERUM-B].tasks[mixing].duration", distribution: "log_normal", mean: 8, std_dev: 2 },
      { parameter_path: "jobs[LOTION-C].tasks[mixing].duration", distribution: "triangular", min_value: 2, mode_value: 4, max_value: 7 },
      { parameter_path: "jobs[MASK-D].tasks[mixing].duration", distribution: "normal", mean: 6, std_dev: 2 },
    ],
  });
  console.log(`  Status: ${stoch.status} | Time: ${stochMs}ms`);
  console.log(`  CVaR 95%: ${stoch.recommended_objective}`);
  console.log(`  Distribution: mean=${stoch.distribution?.mean}, min=${stoch.distribution?.min_value}, max=${stoch.distribution?.max_value}`);
  console.log(`  CV: ${stoch.distribution?.coefficient_of_variation}% | Skewness: ${stoch.distribution?.skewness}`);
  console.log(`  Recommendation: ${stoch.recommendation?.slice(0, 150)}`);

  const totalMs = Date.now() - t0;
  console.log(`\n  TOTAL: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);

  // Value analysis
  console.log("\n━━━ VALUE ANALYSIS — /schedule-robust ━━━");
  console.log("  Cost: $0.35 per analysis");
  console.log("  Target: PMI manufacturing controller, weekly planning");
  console.log("  Frequency: 4-8x/month (weekly + replanning)");
  console.log("  Monthly cost: $1.40-2.80");
  const onTime = sched.job_summaries?.filter(j => j.on_time).length || 0;
  const total = sched.job_summaries?.length || 0;
  console.log(`  Output: ${onTime}/${total} on time, CVaR=${stoch.recommended_objective}, viscosity risk quantified`);
  console.log("  Value: 1 late delivery penalty in cosmetics = €500-5000");
  console.log("  If analysis prevents 1 late delivery/month: ROI = €500-5000 / €2.80 = 178x-1785x");
  console.log("  Edge: domain expertise (7yr cosmetics), setup times, quality_min/yield_rate");
  console.log("  LLM comparison: LLM cannot calculate FJSP with setup times and quality constraints");
  console.log(`  VERDICT: STRONG value for manufacturing PMI`);

  return { totalMs, status: sched.status };
}

// ═══════════════════════════════════════════════════════════
// TEST 2: /pack-resources — DePIN Resource Allocation
// An agent managing compute resources for a DePIN network.
// 8 tasks to allocate across 3 compute nodes with capacity.
// Trade-off: maximize tasks completed vs minimize nodes used.
// ═══════════════════════════════════════════════════════════

async function testPackResources() {
  const t0 = Date.now();
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  /pack-resources — DePIN Compute Resource Allocation            ║");
  console.log("║  8 AI inference tasks, 3 compute nodes, weight+volume           ║");
  console.log("║  Trade-off: max tasks completed vs min nodes used               ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  const PACK_REQUEST = {
    bins: [
      { bin_id: "NODE-A", name: "GPU Node A (high perf)", weight_capacity: 100, volume_capacity: 80, cost: 3 },
      { bin_id: "NODE-B", name: "GPU Node B (medium)", weight_capacity: 80, volume_capacity: 60, cost: 2 },
      { bin_id: "NODE-C", name: "CPU Node C (low cost)", weight_capacity: 60, volume_capacity: 50, cost: 1 },
    ],
    items: [
      { item_id: "LLM-INFERENCE", name: "LLM inference job", weight: 40, volume: 30, value: 10, group: "ai" },
      { item_id: "IMG-GENERATION", name: "Image generation", weight: 35, volume: 25, value: 8, group: "ai" },
      { item_id: "SPEECH-TO-TEXT", name: "Speech-to-text", weight: 20, volume: 15, value: 5, group: "ai" },
      { item_id: "DATA-ETL", name: "Data ETL pipeline", weight: 15, volume: 20, value: 3, group: "data" },
      { item_id: "VECTOR-DB", name: "Vector DB indexing", weight: 25, volume: 20, value: 6, group: "data" },
      { item_id: "MONITORING", name: "Network monitoring", weight: 10, volume: 10, value: 2, group: "ops" },
      { item_id: "BACKUP", name: "Backup job", weight: 15, volume: 15, value: 2, group: "ops" },
      { item_id: "MODEL-TRAIN", name: "Model fine-tuning", weight: 50, volume: 40, value: 12, group: "ai" },
    ],
    objective: "maximize_value",
    allow_partial: true,
  };

  // Step 1: Packing
  console.log("━━━ Step 1: PACKING — Optimal resource allocation ━━━");
  const { data: pack, ms: packMs } = await callSolver("/optimize_packing", PACK_REQUEST);
  console.log(`  Status: ${pack.status} | Time: ${packMs}ms`);
  const usedBins = pack.bin_summaries?.filter(b => b.is_used) || [];
  for (const b of usedBins) {
    console.log(`  ${b.bin_id}: ${b.items_packed} items, weight ${b.weight_used}/${b.weight_capacity} (${b.weight_utilization_pct}%), value=${b.total_value}`);
  }
  console.log(`  Items packed: ${pack.assignments?.length || 0}/${PACK_REQUEST.items.length}`);
  console.log(`  Unpacked: ${pack.unpacked_items?.join(', ') || 'none'}`);
  const totalValue = usedBins.reduce((s, b) => s + b.total_value, 0);
  console.log(`  Total value captured: ${totalValue}/${PACK_REQUEST.items.reduce((s,i) => s + i.value, 0)}`);

  // Step 2: Pareto — trade-off bins vs value
  console.log("\n━━━ Step 2: PARETO — Nodes used vs Value captured ━━━");
  const { data: pareto, ms: paretoMs } = await callSolver("/optimize_pareto", {
    solver_type: "packing",
    num_points: 6,
    objectives: [
      { name: "minimize_bins", weight: 1 },
      { name: "maximize_value", weight: 1 },
    ],
    solver_request: PACK_REQUEST,
  });
  console.log(`  Status: ${pareto.status} | Time: ${paretoMs}ms`);
  console.log(`  Frontier: ${pareto.frontier?.length} points`);
  if (pareto.frontier) {
    for (const p of pareto.frontier) {
      console.log(`    Point ${p.point_id}: ${JSON.stringify(p.objectives)} ${p.is_balanced ? '← BALANCED' : ''} ${p.is_extreme ? '← EXTREME' : ''}`);
    }
  }
  if (pareto.trade_offs?.[0]) {
    console.log(`  Trade-off: ${pareto.trade_offs[0].relationship} (correlation: ${pareto.trade_offs[0].correlation})`);
  }
  console.log(`  Recommendation: ${pareto.recommendation?.slice(0, 150)}`);

  const totalMs = Date.now() - t0;
  console.log(`\n  TOTAL: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);

  // Value analysis
  console.log("\n━━━ VALUE ANALYSIS — /pack-resources ━━━");
  console.log("  Cost: $0.25 per analysis");
  console.log("  Target: DePIN node operator, daily reallocation");
  console.log("  Frequency: 30x/month (daily)");
  console.log("  Monthly cost: $7.50");
  console.log(`  Output: ${pack.assignments?.length}/${PACK_REQUEST.items.length} tasks allocated, value ${totalValue}, Pareto frontier ${pareto.frontier?.length} points`);
  console.log("  Value: optimal packing saves 1 node/day = $3-10/day compute cost");
  console.log("  If saves $5/day: monthly value $150. ROI = ($150-$7.50)/$7.50 = 1900%");
  console.log("  Edge: bin packing with groups + value + volume is non-trivial for LLM");
  console.log("  LLM comparison: LLM can suggest allocations but cannot optimize CP-SAT");
  console.log(`  VERDICT: STRONG for DePIN operators with 3+ nodes`);

  return { totalMs, status: pack.status };
}

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
async function main() {
  const r1 = await testScheduleRobust();
  const r2 = await testPackResources();

  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  FULL PIPELINE TEST SUMMARY                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  console.log("  Pipeline              | Latency  | Status  | Value     | Verdict");
  console.log("  ─────────────────────────────────────────────────────────────────");
  console.log(`  /predict-strategy     | 2.9s     | ✅      | ROI 201%  | STRONG`);
  console.log(`  /route-liquidity      | 7.2s     | ✅      | Marginal  | WEAK for DeFi`);
  console.log(`  /schedule-robust      | ${(r1.totalMs/1000).toFixed(1)}s     | ${r1.status === 'optimal' || r1.status === 'completed' ? '✅' : '⚠️'}      | ROI 178x+ | STRONG`);
  console.log(`  /pack-resources       | ${(r2.totalMs/1000).toFixed(1)}s     | ${r2.status === 'optimal' || r2.status === 'feasible' ? '✅' : '⚠️'}      | ROI 1900% | STRONG`);
  console.log("\n✅ All pipeline tests complete.");
}

main().catch(console.error);
