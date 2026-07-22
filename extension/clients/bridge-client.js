(() => {
  "use strict";
  const namespace = globalThis.MortalCoach ||= {};

  class BridgeClient {
    constructor({ onContextLost = () => {} } = {}) { this.onContextLost = onContextLost; }

    alive() {
      try { return !!chrome.runtime?.id; } catch { return false; }
    }

    async call(run, fallback = null) {
      if (!this.alive()) { this.onContextLost(); return fallback; }
      try { return await run(); }
      catch (error) {
        if (/Extension context invalidated|Receiving end does not exist/i.test(String(error?.message || error))) {
          this.onContextLost(); return fallback;
        }
        throw error;
      }
    }

    health() { return this.call(() => chrome.runtime.sendMessage({ type: "mortal-codex-health" })); }
    storageStatus() { return this.call(() => chrome.runtime.sendMessage({ type: "mortal-codex-storage-status" })); }
    saveRecords(records) {
      return this.call(() => chrome.runtime.sendMessage({ type: "mortal-codex-save-records", payload: { scenes: records } }));
    }
    cacheGet(key) {
      return this.call(async () => {
        const object = await chrome.storage.local.get(`mcl:${key}`);
        return object[`mcl:${key}`] || null;
      });
    }
    cacheSet(key, value) { return this.call(() => chrome.storage.local.set({ [`mcl:${key}`]: value })); }
    openStream() {
      if (!this.alive()) { this.onContextLost(); return null; }
      try { return chrome.runtime.connect({ name: "mortal-codex-stream" }); }
      catch { this.onContextLost(); return null; }
    }
  }

  namespace.BridgeClient = BridgeClient;
})();
