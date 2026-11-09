# Idea: attention scheduler for limited local compute

Raised by the owner 2026-11-08. Not in scope for this repo; belongs in the geldar repo's `docs/ideas.md` (owned by another session), so it is parked here.

Question: run many players at once while limiting which one holds the model's attention, for local compute that is scarcer than frontier compute. A token ring is one way.

Notes:

- The spec already has one in-flight thought per agent, admission that reserves maximum cost, a 20 s minimum between wakeups, and per-Thinker job queues (5.3, 5.7).
- Durable intents (5.3.1) mean most characters are not waiting on the model, so contention is low and a strict ring wastes turns.
- Better fit: a priority queue plus a concurrency semaphore (N=1 for a single GPU). Priority by wake reason (addressed or damaged, then scheduled, then fallback), with aging so no one starves, and batching wakeups by loaded model to avoid model swaps and cache flushes.
- Same gate serves other uses: per-agent and per-shard budgets, and a launcher that keeps one of a person's several sovereign characters active at a time inside one subscription's usage window.
- Applies to the headless tier and local-model Thinkers. Sovereign players on a vendor CLI are not compute-bound locally.
