export const CONCURRENCY_LIMITS = {
  detectionConcurrency: { default: 3, max: 8 },
  vizConcurrency: { default: 4, max: 16 },
} as const;

export type ConcurrencyField = keyof typeof CONCURRENCY_LIMITS;

export function normalizeConcurrency(value: unknown, field: ConcurrencyField): number {
  const limits = CONCURRENCY_LIMITS[field];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(limits.max, Math.max(1, Math.floor(value)))
    : limits.default;
}