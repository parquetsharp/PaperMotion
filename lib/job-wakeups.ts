import type { ConcurrencyField } from "./job-concurrency";

type Wakeups = Record<ConcurrencyField, Set<() => void>>;
const shared = globalThis as typeof globalThis & { __getitJobWakeups?: Wakeups };
const wakeups = shared.__getitJobWakeups ??= {
  detectionConcurrency: new Set(),
  vizConcurrency: new Set(),
};

export function registerJobWakeup(field: ConcurrencyField, wake: () => void): () => void {
  wakeups[field].add(wake);
  return () => { wakeups[field].delete(wake); };
}

export function wakeJobQueues(field: ConcurrencyField): void {
  for (const wake of [...wakeups[field]]) wake();
}