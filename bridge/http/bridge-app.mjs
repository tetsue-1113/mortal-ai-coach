import { existsSync } from "node:fs";
import { API_VERSION, ROUTES, SERVER_VERSION, canonicalPath } from "../contracts/api.mjs";
import { normalizeProvider } from "../providers.mjs";

const MAX_BODY = 768 * 1024;

function headers(origin = "*") {
  const allowed = origin === "*" || origin.startsWith("chrome-extension://") || origin.startsWith("http://127.0.0.1") ? origin : "null";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-mortal-coach-api-version",
    "cache-control": "no-store", "x-content-type-options": "nosniff",
    "x-mortal-coach-api-version": API_VERSION
  };
}

function json(res, status, object, origin) {
  res.writeHead(status, { ...headers(origin), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(object));
}

async function readBody(req, res, origin) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY) {
      json(res, 413, { error: "Payload too large", code: "PAYLOAD_TOO_LARGE", apiVersion: API_VERSION }, origin);
      return null;
    }
  }
  return raw;
}

function streamResponse(req, res, providerGateway, request) {
  const origin = req.headers.origin || "*";
  res.writeHead(200, { ...headers(origin), "content-type": "application/x-ndjson; charset=utf-8", "transfer-encoding": "chunked" });
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const emit = event => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  return providerGateway.run({ ...request, emit, signal: abort.signal }).finally(() => {
    if (!res.writableEnded && !res.destroyed) res.end();
  });
}

export function createBridgeApp({ sceneService, recordService, providerGateway, schemas }) {
  async function health(req, res) {
    const origin = req.headers.origin || "*";
    if (!Object.values(schemas).every(existsSync)) {
      return json(res, 500, { error: "Schema missing", code: "SCHEMA_MISSING", apiVersion: API_VERSION }, origin);
    }
    const providers = await providerGateway.status();
    json(res, 200, {
      apiVersion: API_VERSION, serverVersion: SERVER_VERSION,
      capabilities: ["scene-analysis", "hanchan-summary", "questions", "sqlite-records", "codex-cli", "claude-cli"],
      provider: "codex", installed: providers.codex.installed, loggedIn: providers.codex.loggedIn,
      message: providers.codex.message, providers, database: recordService.status()
    }, origin);
  }

  async function analyze(req, res) {
    const origin = req.headers.origin || "*", raw = await readBody(req, res, origin); if (raw === null) return;
    try {
      const input = JSON.parse(raw), provider = normalizeProvider(input.provider), data = sceneService.normalize(input);
      return streamResponse(req, res, providerGateway, {
        provider, promptText: sceneService.analysisPrompt(data), schemaPath: schemas.analysis,
        resultExtras: { pushFold: data.pushFold, scoreSimulation: data.scoreSimulation, tacticsGuidance: data.tacticsGuidance }
      });
    } catch (error) { json(res, 400, { error: error.message, code: "INVALID_SCENE", apiVersion: API_VERSION }, origin); }
  }

  async function summarize(req, res) {
    const origin = req.headers.origin || "*", raw = await readBody(req, res, origin); if (raw === null) return;
    try {
      const input = JSON.parse(raw), provider = normalizeProvider(input.provider), data = sceneService.normalizeSummary(input);
      return streamResponse(req, res, providerGateway, { provider, promptText: sceneService.summaryPrompt(data), schemaPath: schemas.summary });
    } catch (error) { json(res, 400, { error: error.message, code: "INVALID_SUMMARY", apiVersion: API_VERSION }, origin); }
  }

  async function question(req, res) {
    const origin = req.headers.origin || "*", raw = await readBody(req, res, origin); if (raw === null) return;
    try {
      const input = JSON.parse(raw), provider = normalizeProvider(input.provider), data = sceneService.normalizeQuestion(input);
      return streamResponse(req, res, providerGateway, { provider, promptText: sceneService.questionPrompt(data), schemaPath: schemas.question });
    } catch (error) { json(res, 400, { error: error.message, code: "INVALID_QUESTION", apiVersion: API_VERSION }, origin); }
  }

  async function saveRecords(req, res) {
    const origin = req.headers.origin || "*", raw = await readBody(req, res, origin); if (raw === null) return;
    try {
      const saved = recordService.save(JSON.parse(raw));
      json(res, 200, { ok: true, saved, database: recordService.status(), apiVersion: API_VERSION }, origin);
    } catch (error) { json(res, 400, { ok: false, error: error.message, code: "INVALID_RECORD", apiVersion: API_VERSION }, origin); }
  }

  return async function bridgeApp(req, res) {
    const origin = req.headers.origin || "*";
    if (req.method === "OPTIONS") { res.writeHead(204, headers(origin)); return res.end(); }
    const url = new URL(req.url, "http://127.0.0.1");
    const path = canonicalPath(url.pathname);
    if (req.method === "GET" && path === ROUTES.health) return health(req, res);
    if (req.method === "POST" && path === ROUTES.analyzeScene) return analyze(req, res);
    if (req.method === "POST" && path === ROUTES.summarizeHanchan) return summarize(req, res);
    if (req.method === "POST" && path === ROUTES.askQuestion) return question(req, res);
    if (req.method === "POST" && path === ROUTES.saveScenes) return saveRecords(req, res);
    if (req.method === "GET" && path === ROUTES.storageStatus) return json(res, 200, { ...recordService.status(), apiVersion: API_VERSION }, origin);
    json(res, 404, { error: "Not found", code: "NOT_FOUND", apiVersion: API_VERSION }, origin);
  };
}
