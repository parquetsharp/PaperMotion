import { engineOrigin, type Connection } from "./api";

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (message?.type !== "papermotion:paired") return false;
  void (async () => {
    try {
      const stored = await chrome.storage.session.get("pendingPair");
      const pendingPair = stored.pendingPair as { origin: string; createdAt: number } | undefined;
      const source = new URL(sender.url ?? "");
      if (!pendingPair || Date.now() - pendingPair.createdAt > 600000
        || engineOrigin(source.origin) !== pendingPair.origin
        || source.pathname !== "/extension/pair"
        || source.searchParams.get("extensionId") !== chrome.runtime.id
        || typeof message.token !== "string" || !/^[a-f0-9]{64}$/.test(message.token)
        || typeof message.expiresAt !== "number" || message.expiresAt <= Date.now()) {
        respond({ ok: false });
        return;
      }
      const connection: Connection = { origin: pendingPair.origin, extensionId: chrome.runtime.id, token: message.token, expiresAt: message.expiresAt };
      await chrome.storage.local.set({ connection });
      await chrome.storage.session.remove("pendingPair");
      respond({ ok: true });
    } catch {
      respond({ ok: false });
    }
  })();
  return true;
});