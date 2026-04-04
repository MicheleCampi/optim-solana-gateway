import "dotenv/config";

const ENGINE_URL = process.env.OPTIMENGINE_URL;
const ENGINE_KEY = process.env.ENGINE_API_KEY;

async function callSolver(path, body) {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Key": ENGINE_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

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
    { machine_id: "DESK-1" },
    { machine_id: "DESK-2" },
    { machine_id: "DESK-3" },
  ],
};

async function main() {
  console.log("=== DEBUG: Raw solver responses ===\n");

  // Stochastic
  console.log("--- STOCHASTIC ---");
  const stoch = await callSolver("/optimize_stochastic", {
    solver_type: "scheduling",
    num_scenarios: 10,
    optimize_for: "cvar_95",
    seed: 42,
    solver_request: BASE_REQUEST,
    stochastic_parameters: [
      { parameter_path: "jobs[POS-FED].tasks[trade].duration", distribution: "normal", mean: 6, std_dev: 2 },
    ],
  });
  console.log(JSON.stringify(stoch, null, 2).slice(0, 800));

  // Sensitivity
  console.log("\n--- SENSITIVITY ---");
  const sens = await callSolver("/analyze_sensitivity", {
    solver_type: "scheduling",
    solver_request: BASE_REQUEST,
    parameters: [
      { parameter_path: "jobs[POS-FED].tasks[trade].duration", perturbations: [-20, 20] },
    ],
  });
  console.log(JSON.stringify(sens, null, 2).slice(0, 800));
}

main().catch(console.error);
