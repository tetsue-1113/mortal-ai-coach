const BRIDGE = "http://127.0.0.1:38765";
const API = "/api/v1";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["mortal-codex-health", "mortal-codex-save-records", "mortal-codex-storage-status"].includes(message?.type)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), message.type === "mortal-codex-save-records" ? 10000 : 3500);
  const route = message.type === "mortal-codex-health" ? `${API}/health`
    : message.type === "mortal-codex-storage-status" ? `${API}/records/status` : `${API}/records/scenes`;
  const options = { signal: controller.signal };
  if (message.type === "mortal-codex-save-records") {
    options.method = "POST";
    options.headers = { "content-type": "application/json", "x-mortal-coach-api-version": "1.0" };
    options.body = JSON.stringify(message.payload);
  }
  fetch(`${BRIDGE}${route}`, options)
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    })
    .then(data => sendResponse({ ok: true, ...data }))
    .catch(error => sendResponse({ ok: false, error: error.name === "AbortError" ? "timeout" : String(error) }))
    .finally(() => clearTimeout(timer));
  return true;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "mortal-codex-stream") return;
  let controller = null;

  port.onMessage.addListener(async message => {
    if (!["analyze", "summary", "question"].includes(message?.type) || controller) return;
    controller = new AbortController();
    try {
      const route = {
        analyze: `${API}/analyses/scene`,
        summary: `${API}/analyses/hanchan`,
        question: `${API}/questions`
      }[message.type];
      if (!route) {
        port.postMessage({ type: "error", message: `Unsupported request: ${message.type}` });
        return;
      }
      const response = await fetch(`${BRIDGE}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mortal-coach-api-version": "1.0" },
        body: JSON.stringify({ ...(message.payload || {}), provider: message.provider === "claude" ? "claude" : "codex" }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const detail = await response.text();
        port.postMessage({ type: "error", message: detail || `HTTP ${response.status}` });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try { port.postMessage(JSON.parse(line)); }
          catch { port.postMessage({ type: "status", message: line }); }
        }
      }
      if (buffer.trim()) {
        try { port.postMessage(JSON.parse(buffer)); }
        catch { /* Ignore an incomplete trailing line. */ }
      }
    } catch (error) {
      if (error.name !== "AbortError") port.postMessage({ type: "error", message: String(error) });
    } finally {
      controller = null;
    }
  });

  port.onDisconnect.addListener(() => controller?.abort());
});
