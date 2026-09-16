export type CopilotUsageTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  nanoAiu: number | null;
  premiumRequests: number | null;
};

export const EMPTY_COPILOT_USAGE: CopilotUsageTotals = {
  inputTokens: null, outputTokens: null, cacheReadTokens: null,
  cacheWriteTokens: null, nanoAiu: null, premiumRequests: null,
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseCopilotUsageReport(raw: unknown): CopilotUsageTotals {
  const report = object(raw);
  if (!report) return { ...EMPTY_COPILOT_USAGE };
  const metrics = object(report.modelMetrics);
  const rows = metrics ? Object.values(metrics).map(model => object(object(model)?.usage)) : [];
  const sum = (field: string) => {
    const values = rows.map(row => count(row?.[field]));
    return values.length && values.every(value => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;
  };
  return {
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"), cacheWriteTokens: sum("cacheWriteTokens"),
    nanoAiu: count(report.totalNanoAiu), premiumRequests: count(report.totalPremiumRequestCost),
  };
}

export function copilotUsageDifference(current: CopilotUsageTotals, previous: CopilotUsageTotals | undefined, newSession: boolean): CopilotUsageTotals {
  return Object.fromEntries(Object.entries(current).map(([field, value]) => {
    const baseline = previous?.[field as keyof CopilotUsageTotals] ?? (newSession ? 0 : null);
    return [field, value !== null && baseline !== null && value >= baseline ? value - baseline : null];
  })) as CopilotUsageTotals;
}

export function parseCopilotUsageOutput(stdout: string): CopilotUsageTotals {
  const totals = { ...EMPTY_COPILOT_USAGE };
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "result") totals.premiumRequests = count(event.usage?.premiumRequests);
      if (event?.type === "session.usage_checkpoint") totals.nanoAiu = count(event.data?.totalNanoAiu);
    } catch {}
  }
  return totals;
}