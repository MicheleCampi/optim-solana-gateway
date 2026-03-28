# OptimEngine Solana Gateway

x402 payment gateway for Solana mainnet. CDP Coinbase facilitator. Production-grade security.

- **9 paid endpoints** — scheduling, routing, packing, pareto, stochastic, robust, sensitivity, prescriptive, validate
- **Solana mainnet** — USDC payments via CDP facilitator
- **Security** — ENGINE_API_KEY, rate limiting, helmet, zero PK on server
- **Monitoring** — /stats endpoint for live tracking

## Endpoints

| Endpoint | Price | Solver |
|---|---|---|
| POST /solve/schedule | $0.15 | FJSP OR-Tools CP-SAT |
| POST /solve/routing | $0.20 | CVRPTW |
| POST /solve/packing | $0.10 | Bin Packing |
| POST /solve/pareto | $0.20 | Multi-objective Pareto |
| POST /solve/stochastic | $0.25 | Monte Carlo CVaR |
| POST /solve/robust | $0.20 | Robust Worst-Case |
| POST /solve/sensitivity | $0.15 | Parametric Sensitivity |
| POST /solve/prescriptive | $0.30 | Prescriptive Intelligence |
| POST /solve/validate | $0.05 | Schedule Validation |

## Free Endpoints

- GET /health — service status + security info
- GET /.well-known/x402 — x402 discovery
- GET /docs — API documentation
- GET /stats — live monitoring
