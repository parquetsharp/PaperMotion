"use client";

import { useState, useSyncExternalStore } from "react";
import { Link2, ShieldCheck, Unplug } from "lucide-react";

type ExtensionBridge = {
  runtime?: { sendMessage: (id: string, message: unknown, callback: (reply?: { ok?: boolean }) => void) => void; lastError?: { message?: string } };
};

const subscribe = () => () => {};

export default function PairExtension() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function manage(action: "pair" | "revoke") {
    const extensionId = new URLSearchParams(window.location.search).get("extensionId") ?? "";
    if (!/^[a-p]{32}$/.test(extensionId)) {
      setStatus("Open this page using Connect in the PaperMotion extension.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/extension/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, extensionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === "revoke") {
        setStatus("Extension access revoked.");
        return;
      }
      const bridge = (window as Window & { chrome?: ExtensionBridge }).chrome;
      if (!bridge?.runtime?.sendMessage) throw new Error("Extension messaging is unavailable. Open Connect from the installed extension in Chrome or Edge.");
      await new Promise<void>((resolve, reject) => {
        bridge.runtime!.sendMessage(extensionId, { type: "papermotion:paired", ...result }, (reply) => {
          const error = bridge.runtime?.lastError;
          if (error || !reply?.ok) reject(new Error("Connection was not accepted. Click Connect in the extension and try again."));
          else resolve();
        });
      });
      setStatus("Connected for 30 days. Return to the PaperMotion sidebar.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl overflow-y-auto px-6 py-12">
      <ShieldCheck size={32} className="mb-5 text-[var(--accent-600)]" />
      <h1 className="text-2xl font-semibold">Connect PaperMotion</h1>
      <p className="mt-5 text-sm leading-6">Allow the browser extension to import PDFs and access study documents, conversations, flashcards, quizzes, and concepts on this computer for 30 days.</p>
      <p className="mt-3 text-sm leading-6">Your AI provider key stays in the local engine. Study requests send document text to your configured provider. Only approve an extension you installed and trust.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button disabled={busy || !hydrated} onClick={() => void manage("pair")} className="flex items-center gap-2 rounded-lg bg-[var(--accent-600)] px-4 py-3 text-sm text-white disabled:opacity-50"><Link2 size={16} />Approve Connection</button>
        <button disabled={busy || !hydrated} onClick={() => void manage("revoke")} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-sm disabled:opacity-50"><Unplug size={16} />Revoke Access</button>
      </div>
      <p role="status" className="mt-5 text-sm leading-6">{busy ? "Connecting..." : status}</p>
    </main>
  );
}