import type { ProviderUsage } from "@/lib/usage-store";
import type { CopilotUsageTotals } from "@/lib/providers/copilot-usage";
import { ExternalLink } from "lucide-react";

export default function CopilotUsageMetrics({ usage }: { usage: ProviderUsage }) {
  const details = usage.copilot;
  const attempts = details?.attempts ?? 0;
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const metric = (field: keyof CopilotUsageTotals, divisor = 1) => {
    const reported = details?.reported[field] ?? 0;
    if (!reported) return "Not reported";
    return `${format(details!.totals[field] / divisor)}${reported < attempts ? " (partial)" : ""}`;
  };
  const tokensReported = Math.min(details?.reported.inputTokens ?? 0, details?.reported.outputTokens ?? 0);
  const rows = [
    ["Total tokens", tokensReported ? `${format(usage.totalTokens)}${tokensReported < attempts ? " (partial)" : ""}` : "Not reported"],
    ["Input tokens", metric("inputTokens")],
    ["Output tokens", metric("outputTokens")],
    ["Cache reads (included)", metric("cacheReadTokens")],
    ["Cache writes (included)", metric("cacheWriteTokens")],
    ["AI units", metric("nanoAiu", 1e9)],
    ["Premium requests", metric("premiumRequests")],
    ["Credits used", "Not reported"],
    ["CLI attempts", String(attempts)],
  ];
  return <section aria-label="Copilot consumption" className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11.5px]">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
      <h3 className="font-medium text-[var(--ink-900)]">Consumption today</h3>
      <span className="text-[var(--ink-500)]">PaperMotion only</span>
    </div>
    <dl className="space-y-1.5">{rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-[var(--ink-500)]" title={label === "AI units" ? "Reported nano AI units divided by 1 billion; not a dollar amount or credit balance." : label === "Credits used" ? "The CLI does not report a credit amount. AI units and premium requests are shown separately without estimating credits." : undefined}>{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium tabular-nums text-[var(--ink-900)]">{value}</dd>
    </div>)}</dl>
    <p className="mt-2 text-[10.5px] text-[var(--ink-400)]">{attempts ? `${tokensReported}/${attempts} attempts with token totals. Includes corrections and failed attempts with reported usage.` : "No tracked attempts today. Earlier usage is not backfilled."}</p>
    <p className="mt-1 text-[10.5px] text-[var(--ink-400)]">Local-day totals, not your account-wide bill or remaining balance.</p>
    <a href="https://github.com/settings/billing" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[var(--accent-700)]"><ExternalLink size={12} />GitHub billing</a>
  </section>;
}