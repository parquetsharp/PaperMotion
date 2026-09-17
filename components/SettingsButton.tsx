"use client";

/**
 * Top-bar Settings button + popover.
 *
 * Three runtime knobs:
 *   1. AI Provider selector (Codex CLI, Gemini CLI, Claude Code)
 *   2. Auto-generate toggle
 *   3. Viz repair budget (max retries)
 *
 * Persisted to `/api/settings`. Stateless from the parent's POV — every
 * popover open does a fresh fetch, every change POSTs back, and a
 * `getit:settings` CustomEvent is dispatched so other components on the
 * page can react mid-session without polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2, Pencil, Check, Sun, Moon, Monitor, RotateCcw, RefreshCw } from "lucide-react";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "@/lib/config";
import { CONCURRENCY_LIMITS, normalizeConcurrency, type ConcurrencyField } from "@/lib/job-concurrency";
import { APP_VERSION } from "@/lib/version";
import type { ProviderName } from "@/lib/provider-types";
import type { CopilotModel } from "@/lib/providers/copilot-models";

export type SettingsPayload = {
  copilotModelFast?: string;
  copilotModelSmart?: string;
  autoGenerate: boolean;
  publicSourceRetrieval?: boolean;
  maxRetries: number;
  detectionConcurrency?: number;
  vizConcurrency?: number;
  provider: ProviderName;
  codexModelFast?: string;
  codexModelSmart?: string;
  codexEffortFast?: string;
  codexEffortSmart?: string;
  geminiApiKey?: string;
  geminiModelFast?: string;
  geminiModelSmart?: string;
  claudeModelFast?: string;
  claudeModelSmart?: string;
  claudeEffortFast?: string;
  claudeEffortSmart?: string;
  piUrl?: string;
  piApiKey?: string;
  hasPiApiKey?: boolean;
  hasGeminiApiKey?: boolean;
  piApiKeyManaged?: boolean;
  geminiApiKeyManaged?: boolean;
  piModelFast?: string;
  piModelSmart?: string;
  piProvider?: "ollama" | "gemini" | "openai" | "anthropic" | "custom";
  piApiType?: "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";
  theme?: "light" | "dark" | "system";
};

export const SETTINGS_EVENT = "getit:settings";

const ENGINE_LABEL: Record<ProviderName, string> = {
  copilot: "GitHub Copilot",
  codex: "OpenAI — Codex CLI",
  gemini: "Google — Gemini (API key)",
  claude: "Anthropic — Claude Code",
  pi: "Bring your own key (BYOK)",
};

function EditableModelSelect({ 
  id,
  label, 
  value, 
  onChange, 
  options 
}: { 
  id?: string;
  label: string; 
  value: string; 
  onChange: (v: string) => void; 
  options: { value: string; label: string; disabled?: boolean }[] 
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isCustom = !options.some(o => o.value === value);
  const showEdit = isEditing || isCustom;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="block text-[11.5px] font-medium text-[var(--ink-900)]">
          {label}
        </label>
        <button 
          type="button" 
          onClick={() => {
            if (isCustom) {
              onChange(options[0]?.value || "");
              setIsEditing(false);
            } else {
              setIsEditing(!showEdit);
            }
          }}
          className="text-[var(--ink-500)] hover:text-[var(--ink-900)]"
          title={showEdit ? "Select from list" : "Enter custom model"}
          aria-label={`${showEdit ? "Select from list" : "Enter custom model"}: ${label}`}
        >
          {showEdit ? <Check className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
        </button>
      </div>
      {showEdit ? (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
          placeholder="Custom model..."
        />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>();
  const [menuRight, setMenuRight] = useState(0);
  const [menuTop, setMenuTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const measureMenu = useCallback(() => {
    if (!ref.current) return;
    const trigger = ref.current.getBoundingClientRect();
    setMenuMaxHeight(Math.max(0, window.innerHeight - trigger.bottom - 16));
    const menuWidth = Math.min(22 * parseFloat(getComputedStyle(document.documentElement).fontSize), window.innerWidth - 64);
    setMenuRight(Math.min(window.innerWidth - menuWidth - 8, Math.max(8, window.innerWidth - trigger.right)));
    setMenuTop(trigger.bottom + 6);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measureMenu);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measureMenu);
    };
  }, [open, measureMenu]);

  return (
    <div ref={ref} className="relative">
      <span className="viz-tooltip-anchor relative inline-flex">
        <button
          type="button"
          onClick={() => {
            measureMenu();
            setOpen((v) => !v);
          }}
          className="tab-icon-btn"
          aria-label="Settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        {!open && (
          <span className="viz-tooltip" role="tooltip">
            Settings — provider, visualization preferences.
          </span>
        )}
      </span>
      <AnimatePresence>
        {open && (
          <motion.div
            key="settings-menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{ maxHeight: menuMaxHeight, right: menuRight, top: menuTop }}
            className="fixed z-30 max-h-[calc(100dvh-80px)] w-[22rem] max-w-[calc(100vw-64px)] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-[var(--shadow-popover)]"
          >
            <SettingsPanel refreshKey={open ? "open" : "closed"} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingsPanel({ refreshKey }: { refreshKey: string }) {
  const [provider, setProvider] = useState<ProviderName>("codex");
  const [copilotModels, setCopilotModels] = useState({ copilotModelFast: "auto", copilotModelSmart: "auto" });
  const [modelCatalog, setModelCatalog] = useState<{ models: CopilotModel[]; loading: boolean; error: string | null }>({ models: [], loading: true, error: null });
  const [modelRefresh, setModelRefresh] = useState(0);
  const copilotOptions = [
    { value: "auto", label: "Auto (Copilot chooses)", disabled: modelCatalog.models.find(model => model.id === "auto")?.enabled === false },
    ...modelCatalog.models.filter(model => model.id !== "auto").map(model => ({ value: model.id, label: model.enabled ? model.name : `${model.name} (Unavailable)`, disabled: !model.enabled })),
  ];
  const [autoGenerate, setAutoGenerate] = useState<boolean>(AUTO_GENERATE_VIZ);
  const [publicRetrieval, setPublicRetrieval] = useState({ enabled: false, loaded: false, pending: false, error: "" });
  const [maxRetries, setMaxRetries] = useState<number>(MAX_VIZ_GEN_RETRIES);
  const [concurrency, setConcurrency] = useState<Record<ConcurrencyField, number | "">>({
    detectionConcurrency: CONCURRENCY_LIMITS.detectionConcurrency.default,
    vizConcurrency: CONCURRENCY_LIMITS.vizConcurrency.default,
  });
  const savedConcurrency = useRef(concurrency);

  // Managed specific
  const [codexModelFast, setCodexModelFast] = useState<string>("gpt-5.5");
  const [codexModelSmart, setCodexModelSmart] = useState<string>("gpt-5.5");
  const [codexEffortFast, setCodexEffortFast] = useState<string>("low");
  const [codexEffortSmart, setCodexEffortSmart] = useState<string>("high");
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [geminiModelFast, setGeminiModelFast] = useState<string>("gemini-flash-latest");
  const [geminiModelSmart, setGeminiModelSmart] = useState<string>("gemini-pro-latest");
  const [claudeModelFast, setClaudeModelFast] = useState<string>("sonnet");
  const [claudeModelSmart, setClaudeModelSmart] = useState<string>("opus");
  const [claudeEffortFast, setClaudeEffortFast] = useState<string>("medium");
  const [claudeEffortSmart, setClaudeEffortSmart] = useState<string>("high");

  // PI specific
  const [piUrl, setPiUrl] = useState<string>("http://localhost:11434/v1");
  const [piApiKey, setPiApiKey] = useState<string>("");
  const [keyStatus, setKeyStatus] = useState<Partial<SettingsPayload>>({});
  const [piModelFast, setPiModelFast] = useState<string>("llama3.2");
  const [piModelSmart, setPiModelSmart] = useState<string>("llama3.2");
  const [piProvider, setPiProvider] = useState<"ollama" | "gemini" | "openai" | "anthropic" | "custom">("ollama");
  const [piApiType, setPiApiType] = useState<NonNullable<SettingsPayload["piApiType"]>>("openai-completions");

  const [theme, setTheme] = useState<"light" | "dark" | "system" | undefined>();
  const hydratedRef = useRef(false);
  const userToggledRef = useRef(false);
  const [osPrefersDark, setOsPrefersDark] = useState(false);

  useEffect(() => {
    if (provider !== "copilot" || refreshKey !== "open") return;
    const controller = new AbortController();
    fetch("/api/provider/models", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Copilot model discovery failed.");
        if (!Array.isArray(body.models) || !body.models.every((model: CopilotModel) => model && typeof model.id === "string" && typeof model.name === "string" && typeof model.enabled === "boolean")) throw new Error("Copilot returned an invalid model list.");
        if (!controller.signal.aborted) setModelCatalog({ models: body.models, loading: false, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted) setModelCatalog({ models: [], loading: false, error: error instanceof Error ? error.message : "Copilot model discovery failed." });
      });
    return () => controller.abort();
  }, [provider, refreshKey, modelRefresh]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setOsPrefersDark(mq.matches);
    const onChange = () => setOsPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The chosen appearance mode — defaults to light when nothing is stored.
  const selectedTheme = theme ?? "light";

  // Fetch fresh on every popover open
  useEffect(() => {
    if (refreshKey !== "open") return;
    hydratedRef.current = false;
    userToggledRef.current = false;
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: Partial<SettingsPayload>) => {
        if (cancelled) return;
        setKeyStatus(s);
        if (typeof s.autoGenerate === "boolean") setAutoGenerate(s.autoGenerate);
        setPublicRetrieval({ enabled: s.publicSourceRetrieval === true, loaded: true, pending: false, error: "" });
        if (typeof s.maxRetries === "number") setMaxRetries(s.maxRetries);
        const limits = {
          detectionConcurrency: normalizeConcurrency(s.detectionConcurrency, "detectionConcurrency"),
          vizConcurrency: normalizeConcurrency(s.vizConcurrency, "vizConcurrency"),
        };
        savedConcurrency.current = limits;
        setConcurrency(limits);
        if (s.provider) setProvider(s.provider);
        setCopilotModels({ copilotModelFast: s.copilotModelFast ?? "auto", copilotModelSmart: s.copilotModelSmart ?? "auto" });
        if (typeof s.codexModelFast === "string") setCodexModelFast(s.codexModelFast);
        if (typeof s.codexModelSmart === "string") setCodexModelSmart(s.codexModelSmart);
        if (typeof s.codexEffortFast === "string") setCodexEffortFast(s.codexEffortFast);
        if (typeof s.codexEffortSmart === "string") setCodexEffortSmart(s.codexEffortSmart);
        if (typeof s.geminiApiKey === "string") setGeminiApiKey(s.geminiApiKey);
        if (typeof s.geminiModelFast === "string") setGeminiModelFast(s.geminiModelFast);
        if (typeof s.geminiModelSmart === "string") setGeminiModelSmart(s.geminiModelSmart);
        if (typeof s.claudeModelFast === "string") setClaudeModelFast(s.claudeModelFast);
        if (typeof s.claudeModelSmart === "string") setClaudeModelSmart(s.claudeModelSmart);
        if (typeof s.claudeEffortFast === "string") setClaudeEffortFast(s.claudeEffortFast);
        if (typeof s.claudeEffortSmart === "string") setClaudeEffortSmart(s.claudeEffortSmart);
        if (typeof s.piUrl === "string") setPiUrl(s.piUrl);
        if (typeof s.piApiKey === "string") setPiApiKey(s.piApiKey);
        if (typeof s.piModelFast === "string") setPiModelFast(s.piModelFast);
        if (typeof s.piModelSmart === "string") setPiModelSmart(s.piModelSmart);
        if (typeof s.piProvider === "string") setPiProvider(s.piProvider);
        if (typeof s.piApiType === "string") setPiApiType(s.piApiType);
        if (!userToggledRef.current && (s.theme === "light" || s.theme === "dark" || s.theme === "system")) setTheme(s.theme);

        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) hydratedRef.current = true;
          }, 10);
        }
      })
      .catch(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const persist = useCallback((delta: Partial<SettingsPayload>, skipHydrationCheck = false) => {
    // Block non-theme writes until the fetch populates server-saved values.
    // Without this, a user who toggles autoGenerate or maxRetries before the
    // fetch resolves would persist a value derived from the build-time
    // default (AUTO_GENERATE_VIZ / MAX_VIZ_GEN_RETRIES), silently overwriting
    // whatever was previously saved on disk.
    // The theme toggle is exempted so it can work immediately on open.
    if (!skipHydrationCheck && !hydratedRef.current) return;
    void fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(delta),
      keepalive: true,
    })
      .then((r) => r.json())
      .then((next: SettingsPayload) => {
        try {
          window.dispatchEvent(
            new CustomEvent(SETTINGS_EVENT, { detail: next }),
          );
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, []);

  const onAutoGenerate = useCallback((v: boolean) => {
    setAutoGenerate(v);
    persist({ autoGenerate: v });
  }, [persist]);

  const onPublicRetrieval = async () => {
    if (!publicRetrieval.loaded || publicRetrieval.pending) return;
    setPublicRetrieval(previous => ({ ...previous, pending: true, error: "" }));
    try {
      const response = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicSourceRetrieval: !publicRetrieval.enabled }) });
      const next: SettingsPayload = await response.json();
      if (!response.ok || typeof next.publicSourceRetrieval !== "boolean") throw new Error("Could not save public retrieval preference.");
      setPublicRetrieval({ enabled: next.publicSourceRetrieval, loaded: true, pending: false, error: "" });
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: next }));
    } catch (error) { setPublicRetrieval(previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : "Could not save public retrieval preference." })); }
  };

  const onMaxRetries = useCallback((v: number) => {
    const clamped = Math.min(10, Math.max(0, Math.floor(v)));
    setMaxRetries(clamped);
    persist({ maxRetries: clamped });
  }, [persist]);

  const onConcurrency = (field: ConcurrencyField, input: string) => {
    if (!hydratedRef.current) return;
    if (input === "") {
      setConcurrency(previous => ({ ...previous, [field]: "" }));
      return;
    }
    const value = normalizeConcurrency(Number(input), field);
    savedConcurrency.current = { ...savedConcurrency.current, [field]: value };
    setConcurrency(previous => ({ ...previous, [field]: value }));
    persist({ [field]: value });
  };

  const handlePiProviderChange = useCallback((newProvider: "ollama" | "gemini" | "openai" | "anthropic" | "custom") => {
    setPiProvider(newProvider);
    let url = "";
    let apiType: NonNullable<SettingsPayload["piApiType"]> = "openai-completions";
    let modelFast = "";
    let modelSmart = "";
    
    switch (newProvider) {
      case "ollama":
        url = "http://localhost:11434/v1";
        apiType = "openai-completions";
        modelFast = "qwen2.5-coder:7b";
        modelSmart = "qwen2.5-coder:7b";
        break;
      case "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta";
        apiType = "google-generative-ai";
        modelFast = "gemini-2.5-flash";
        modelSmart = "gemini-2.5-pro";
        break;
      case "openai":
        url = "https://api.openai.com/v1";
        apiType = "openai-completions";
        modelFast = "gpt-4o-mini";
        modelSmart = "gpt-4o";
        break;
      case "anthropic":
        url = "https://api.anthropic.com";
        apiType = "anthropic-messages";
        modelFast = "claude-3-5-haiku";
        modelSmart = "claude-3-5-sonnet";
        break;
      case "custom":
        url = piUrl || "http://localhost:11434/v1";
        apiType = piApiType || "openai-completions";
        modelFast = piModelFast || "llama3.2";
        modelSmart = piModelSmart || "llama3.2";
        break;
    }
    setPiUrl(url);
    setPiApiType(apiType);
    setPiModelFast(modelFast);
    setPiModelSmart(modelSmart);
    persist({
      piProvider: newProvider,
      piUrl: url,
      piApiType: apiType,
      piModelFast: modelFast,
      piModelSmart: modelSmart
    });
  }, [piUrl, piApiType, piModelFast, piModelSmart, persist]);

  const textStateRef = useRef({ ...copilotModels, piUrl, piApiKey, piModelFast, piModelSmart, codexModelFast, codexModelSmart, codexEffortFast, codexEffortSmart, geminiApiKey, geminiModelFast, geminiModelSmart, claudeModelFast, claudeModelSmart, claudeEffortFast, claudeEffortSmart });
  useEffect(() => {
    textStateRef.current = { ...copilotModels, piUrl, piApiKey, piModelFast, piModelSmart, codexModelFast, codexModelSmart, codexEffortFast, codexEffortSmart, geminiApiKey, geminiModelFast, geminiModelSmart, claudeModelFast, claudeModelSmart, claudeEffortFast, claudeEffortSmart };
  }, [copilotModels, piUrl, piApiKey, piModelFast, piModelSmart, codexModelFast, codexModelSmart, codexEffortFast, codexEffortSmart, geminiApiKey, geminiModelFast, geminiModelSmart, claudeModelFast, claudeModelSmart, claudeEffortFast, claudeEffortSmart]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      persist({ ...copilotModels, piUrl, piApiKey, piModelFast, piModelSmart, codexModelFast, codexModelSmart, codexEffortFast, codexEffortSmart, geminiApiKey, geminiModelFast, geminiModelSmart, claudeModelFast, claudeModelSmart, claudeEffortFast, claudeEffortSmart });
    }, 500);
    return () => clearTimeout(timer);
  }, [copilotModels, piUrl, piApiKey, piModelFast, piModelSmart, codexModelFast, codexModelSmart, codexEffortFast, codexEffortSmart, geminiApiKey, geminiModelFast, geminiModelSmart, claudeModelFast, claudeModelSmart, claudeEffortFast, claudeEffortSmart, persist]);

  useEffect(() => {
    return () => {
      if (hydratedRef.current) {
        persist(textStateRef.current);
      }
    };
  }, [persist]);

  const getApiKeyPlaceholder = () => {
    switch (piProvider) {
      case "ollama": return "Optional (ignored by Ollama)";
      case "gemini": return "Enter Gemini API Key";
      case "openai": return "Enter OpenAI API Key";
      case "anthropic": return "Enter Anthropic API Key";
      default: return "Enter API Key";
    }
  };

  const onThemeSelect = useCallback(
    (next: "light" | "dark" | "system") => {
      userToggledRef.current = true;
      setTheme(next);
      persist({ theme: next }, true);
      // Apply immediately for snappy feedback; ThemeProvider also reacts to the
      // settings event this dispatches. "system" resolves to the OS preference.
      const wantDark =
        next === "dark" ||
        (next === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", wantDark);
    },
    [persist],
  );

  return (
    <>
      <div className="border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-500)]">
            Settings
          </p>
          <p
            className="text-[10.5px] font-medium tabular-nums text-[var(--ink-400)]"
            aria-label={`Get It. version ${APP_VERSION}`}
          >
            v{APP_VERSION}
          </p>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-400)]">
          Saved automatically. Your choice survives app restarts.
        </p>
      </div>

      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
        <label htmlFor="model-engine" className="block text-[12.5px] font-medium text-[var(--ink-900)] mb-2">Model Engine</label>
        <select id="model-engine" value={provider} onChange={event => {
          const next = event.target.value as ProviderName;
          setProvider(next);
          if (next === "copilot") setModelCatalog({ models: [], loading: true, error: null });
          persist({ provider: next });
        }} className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] text-[var(--ink-900)]">
          {Object.entries(ENGINE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {provider === "copilot" && (
        <div className="space-y-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2.5">
          <p className="text-[11.5px] text-[var(--ink-500)]">CLI authentication: <code>copilot login</code></p>
          <div className="flex items-center justify-between gap-2">
            <p role="status" className="text-[11.5px] text-[var(--ink-500)]">{modelCatalog.loading ? "Loading account models..." : modelCatalog.error ? "Model list unavailable" : modelCatalog.models.length ? `${modelCatalog.models.filter(model => model.enabled).length} account models` : "No account models returned"}</p>
            <button
              type="button"
              aria-label="Refresh Copilot models"
              title="Refresh account models"
              disabled={modelCatalog.loading}
              onClick={() => {
                setModelCatalog({ models: [], loading: true, error: null });
                setModelRefresh(previous => previous + 1);
              }}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ink-500)] hover:bg-[var(--surface-raised)] disabled:opacity-50"
            ><RefreshCw className={`h-3.5 w-3.5${modelCatalog.loading ? " animate-spin" : ""}`} /></button>
          </div>
          {modelCatalog.error && <p role="alert" className="break-words text-[11.5px] text-[var(--ink-700)]">{modelCatalog.error}</p>}
          {(["copilotModelFast", "copilotModelSmart"] as const).map((field, index) => (
            <EditableModelSelect
              key={field}
              id={field}
              label={index === 0 ? "Generation model" : "Conversation model"}
              value={copilotModels[field]}
              onChange={value => setCopilotModels(previous => ({ ...previous, [field]: value }))}
              options={copilotOptions}
            />
          ))}
          <a href="https://docs.github.com/en/copilot/reference/cli-command-reference#supported-models" target="_blank" rel="noopener noreferrer" title="Models are retrieved using your local Copilot CLI sign-in. Availability can change with your account, organization policy, and CLI version." className="block text-[11.5px] text-[var(--accent-700)]">Copilot model availability</a>
          <a href="https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-[var(--accent-700)]">Copilot CLI setup and account requirements</a>
        </div>
      )}

      {provider === "gemini" && (
        <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              Gemini API Key
            </label>
            <input
              type="password"
              placeholder={keyStatus.hasGeminiApiKey ? "Configured — leave blank to keep" : "AIzaSy... (Required for Gemini)"}
              disabled={keyStatus.geminiApiKeyManaged}
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EditableModelSelect
              label="Fast Model"
              value={geminiModelFast}
              onChange={setGeminiModelFast}
              options={[
                { value: "gemini-flash-lite-latest", label: "gemini-flash-lite-latest" },
                { value: "gemini-flash-latest", label: "gemini-flash-latest" },
                { value: "gemini-pro-latest", label: "gemini-pro-latest" },
                { value: "gemma-4-26b-a4b-it", label: "gemma-4-26b-a4b-it" },
                { value: "gemma-4-31b-it", label: "gemma-4-31b-it" }
              ]}
            />
            <EditableModelSelect
              label="Smart Model"
              value={geminiModelSmart}
              onChange={setGeminiModelSmart}
              options={[
                { value: "gemini-pro-latest", label: "gemini-pro-latest" },
                { value: "gemini-flash-latest", label: "gemini-flash-latest" },
                { value: "gemini-flash-lite-latest", label: "gemini-flash-lite-latest" },
                { value: "gemma-4-31b-it", label: "gemma-4-31b-it" },
                { value: "gemma-4-26b-a4b-it", label: "gemma-4-26b-a4b-it" }
              ]}
            />
          </div>
        </div>
      )}

      {provider === "claude" && (
        <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              Claude Authentication
            </label>
            <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
              Sign in with one click from the <strong>Account</strong> menu (top-right). Aliases like <code>sonnet</code> or <code>haiku</code> always map to the current model.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EditableModelSelect
              label="Fast Model"
              value={claudeModelFast}
              onChange={setClaudeModelFast}
              options={[
                { value: "sonnet", label: "sonnet (recommended)" },
                { value: "haiku", label: "haiku (fastest)" },
                { value: "opus", label: "opus (most capable)" }
              ]}
            />
            <EditableModelSelect
              label="Smart Model"
              value={claudeModelSmart}
              onChange={setClaudeModelSmart}
              options={[
                { value: "sonnet", label: "sonnet (recommended)" },
                { value: "opus", label: "opus (most capable)" },
                { value: "haiku", label: "haiku (fastest)" }
              ]}
            />
            <div>
              <label className="block text-[11px] font-medium text-[var(--ink-900)] mb-1">
                Fast Thinking Effort
              </label>
              <select
                value={claudeEffortFast}
                onChange={(e) => setClaudeEffortFast(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--ink-900)] shadow-sm focus:border-[var(--accent-500)] focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium (Default for fast)</option>
                <option value="high">High</option>
                <option value="xhigh">X-High</option>
                <option value="max">Max</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--ink-900)] mb-1">
                Smart Thinking Effort
              </label>
              <select
                value={claudeEffortSmart}
                onChange={(e) => setClaudeEffortSmart(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--ink-900)] shadow-sm focus:border-[var(--accent-500)] focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High (Default for smart)</option>
                <option value="xhigh">X-High</option>
                <option value="max">Max</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {provider === "codex" && (
        <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              Codex Authentication
            </label>
            <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
              Codex manages its own authentication via browser login.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EditableModelSelect
              label="Fast Model"
              value={codexModelFast}
              onChange={setCodexModelFast}
              options={[
                { value: "auto", label: "Auto (Let server decide)" },
                { value: "gpt-4o-mini", label: "gpt-4o-mini" },
                { value: "gpt-4o", label: "gpt-4o" },
                { value: "o1-mini", label: "o1-mini" },
                { value: "gpt-4", label: "gpt-4" },
                { value: "gpt-5.5", label: "gpt-5.5" }
              ]}
            />
            <EditableModelSelect
              label="Smart Model"
              value={codexModelSmart}
              onChange={setCodexModelSmart}
              options={[
                { value: "auto", label: "Auto (Let server decide)" },
                { value: "gpt-5.5", label: "gpt-5.5" },
                { value: "o1-preview", label: "o1-preview" },
                { value: "o1-mini", label: "o1-mini" },
                { value: "gpt-4o", label: "gpt-4o" },
                { value: "gpt-4", label: "gpt-4" }
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-[11px] font-medium text-[var(--ink-900)] mb-1">
                Fast Thinking Effort
              </label>
              <select
                value={codexEffortFast}
                onChange={(e) => setCodexEffortFast(e.target.value)}
                className="w-full h-[26px] bg-[var(--surface-default)] border border-[var(--border-subtle)] 
                         rounded text-[11.5px] px-2 text-[var(--ink-900)] outline-none 
                         focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)]/20 transition-all"
              >
                <option value="minimal">None (Fastest)</option>
                <option value="low">Low (Default for fast)</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">X-High</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--ink-900)] mb-1">
                Smart Thinking Effort
              </label>
              <select
                value={codexEffortSmart}
                onChange={(e) => setCodexEffortSmart(e.target.value)}
                className="w-full h-[26px] bg-[var(--surface-default)] border border-[var(--border-subtle)] 
                         rounded text-[11.5px] px-2 text-[var(--ink-900)] outline-none 
                         focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)]/20 transition-all"
              >
                <option value="minimal">None (Fastest)</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High (Default for smart)</option>
                <option value="xhigh">X-High</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {provider === "pi" && (
        <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              Provider
            </label>
            <select
              value={piProvider}
              onChange={(e) => handlePiProviderChange(e.target.value as NonNullable<SettingsPayload["piProvider"]>)}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="gemini">Google Gemini (AI Studio)</option>
              <option value="openai">OpenAI (ChatGPT/Codex)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              API Protocol
            </label>
            <select
              value={piApiType}
              onChange={(e) => {
                setPiApiType(e.target.value as NonNullable<SettingsPayload["piApiType"]>);
                persist({ piApiType: e.target.value as NonNullable<SettingsPayload["piApiType"]> });
              }}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            >
              <option value="openai-completions">OpenAI completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="google-generative-ai">Google Generative AI</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              API Base URL
            </label>
            <input
              type="text"
              value={piUrl}
              onChange={(e) => setPiUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
              API Key
            </label>
            <input
              type="password"
              value={piApiKey}
              onChange={(e) => setPiApiKey(e.target.value)}
              placeholder={keyStatus.piApiKeyManaged ? "Configured on server" : keyStatus.hasPiApiKey ? "Configured — leave blank to keep" : getApiKeyPlaceholder()}
              disabled={keyStatus.piApiKeyManaged}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
                Fast Model
              </label>
              <input
                type="text"
                value={piModelFast}
                onChange={(e) => setPiModelFast(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-[var(--ink-900)] mb-1">
                Smart Model
              </label>
              <input
                type="text"
                value={piModelSmart}
                onChange={(e) => setPiModelSmart(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Appearance — light / system / dark */}
      <div className="px-3 py-2.5">
        <p className="mb-2 text-[12.5px] font-medium text-[var(--ink-900)]">
          Appearance
        </p>
        <div
          role="radiogroup"
          aria-label="Appearance"
          className="grid grid-cols-3 gap-1 rounded-md bg-[var(--surface-sunken)] p-1"
        >
          {([
            { value: "light", label: "Light", Icon: Sun },
            { value: "system", label: "System", Icon: Monitor },
            { value: "dark", label: "Dark", Icon: Moon },
          ] as const).map(({ value, label, Icon }) => {
            const active = selectedTheme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onThemeSelect(value)}
                className={`inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                  active
                    ? "bg-[var(--surface-raised)] text-[var(--ink-900)] shadow-sm ring-1 ring-inset ring-[var(--border-default)]"
                    : "text-[var(--ink-500)] hover:text-[var(--ink-900)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-500)]">
          {selectedTheme === "system"
            ? `Follows your system — currently ${osPrefersDark ? "dark" : "light"}.`
            : selectedTheme === "dark"
              ? "Dark theme active."
              : "Light theme active."}
        </p>
      </div>

      {/* Auto-generate toggle */}
      <div className="flex items-start gap-2.5 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={autoGenerate}
          onClick={() => onAutoGenerate(!autoGenerate)}
          className={`mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            autoGenerate
              ? "bg-[var(--accent-600)]"
              : "bg-[var(--surface-sunken)] ring-1 ring-inset ring-[var(--border-default)]"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              autoGenerate ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-[var(--ink-900)]">
            Auto-generate visualizations
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
            {autoGenerate
              ? "Detected tags join the visualization queue automatically."
              : "Tags appear after detection but only render on click."}
          </p>
        </div>
      </div>

      <section aria-label="Source retrieval" className="space-y-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--ink-900)]">
          <input type="checkbox" role="switch" aria-label="Public paper retrieval" checked={publicRetrieval.enabled} disabled={!publicRetrieval.loaded || publicRetrieval.pending} onChange={() => void onPublicRetrieval()} className="h-4 w-4 shrink-0 accent-[var(--accent-600)]" />
          Public paper retrieval
        </label>
        <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">Sends citation titles to OpenAlex and downloads PDFs from approved scholarly repositories. PDFs are cached in Library. Document text is not sent to OpenAlex.</p>
        {publicRetrieval.error && <p role="alert" className="break-words text-xs text-[var(--feedback-wrong-text)]">{publicRetrieval.error}</p>}
      </section>

      <section aria-label="Parallel requests" className="space-y-2.5 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-[var(--ink-900)]">Parallel requests <span className="text-[11px] font-normal text-[var(--ink-500)]">per document</span></p>
          <button
            type="button"
            aria-label="Reset parallelism to defaults"
            title="Reset parallelism to defaults"
            onClick={() => {
              if (!hydratedRef.current) return;
              const defaults = { detectionConcurrency: CONCURRENCY_LIMITS.detectionConcurrency.default, vizConcurrency: CONCURRENCY_LIMITS.vizConcurrency.default };
              savedConcurrency.current = defaults;
              setConcurrency(defaults);
              persist(defaults);
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ink-500)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
          ><RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
        {([
          { field: "detectionConcurrency", label: "Detection batches", description: "Up to 5 pages per batch. Raising the limit immediately fills available slots in active queues. Running requests are not cancelled." },
          { field: "vizConcurrency", label: "Visualizations", description: "Raising the limit immediately fills available slots in active visualization queues. Does not limit chat, graph builds, or manual revisions. Running requests are not cancelled." },
        ] as const).map(({ field, label, description }) => (
          <div key={field} className="flex items-center justify-between gap-2">
            <label htmlFor={field} title={description} className="min-w-0 text-[12px] text-[var(--ink-900)]">{label}</label>
            <input
              id={field}
              type="number"
              min={1}
              max={CONCURRENCY_LIMITS[field].max}
              step={1}
              title={`${description} Range: 1-${CONCURRENCY_LIMITS[field].max}; default: ${CONCURRENCY_LIMITS[field].default}.`}
              value={concurrency[field]}
              onChange={event => onConcurrency(field, event.target.value)}
              onBlur={() => {
                if (concurrency[field] === "") setConcurrency(previous => ({ ...previous, [field]: savedConcurrency.current[field] }));
              }}
              className="h-7 w-16 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-right text-[12.5px] font-medium tabular-nums text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">Higher values may hit provider rate limits and increase memory use.</p>
      </section>

      {/* Max retries number input */}
      <div className="flex items-start gap-2.5 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-[var(--ink-900)]">
            Max viz repair attempts
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
            Extra calls after a runtime error. Total attempts per tag = 1 + this.
          </p>
        </div>
        <input
          type="number"
          min={0}
          max={10}
          step={1}
          value={maxRetries}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) onMaxRetries(n);
          }}
          className="h-7 w-14 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-right text-[12.5px] font-medium tabular-nums text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
        />
      </div>
    </>
  );
}
