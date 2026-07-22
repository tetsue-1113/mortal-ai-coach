import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { claudeArguments, normalizeProvider, parseClaudeOutput } from "../providers.mjs";

const PROVIDER_TIMEOUT_MS = 180000;
const HEARTBEAT_MS = 10000;

function command(binary, args, { input = "", timeout = 12000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(binary, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish({ code: -1, stdout, stderr: `${stderr}\nTimeout` }); }, timeout);
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.stdin.on("error", () => {});
    child.on("error", error => finish({ code: -1, stdout, stderr: String(error) }));
    child.on("close", code => finish({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

export function createCliProviderGateway({ codexBinary = process.env.CODEX_BIN || "codex", claudeBinary = process.env.CLAUDE_BIN || "claude" } = {}) {
  async function status() {
    const [codex, claude] = await Promise.all([
      command(codexBinary, ["login", "status"], { timeout: 8000 }),
      command(claudeBinary, ["auth", "status"], { timeout: 8000 })
    ]);
    const codexMessage = `${codex.stdout}\n${codex.stderr}`.trim();
    return {
      codex: { installed: codex.code !== -1, loggedIn: codex.code === 0 && /Logged in/i.test(codexMessage), message: codexMessage },
      claude: {
        installed: claude.code !== -1, loggedIn: claude.code === 0,
        message: claude.code === 0 ? "Logged in" : (claude.code === -1 ? "Claude CLI not installed" : "Claude login required")
      }
    };
  }

  function run({ provider, promptText, schemaPath, resultExtras = null, emit, signal }) {
    const selected = normalizeProvider(provider);
    return selected === "claude"
      ? runClaude({ promptText, schemaPath, resultExtras, emit, signal })
      : runCodex({ promptText, schemaPath, resultExtras, emit, signal });
  }

  function lifecycle(label, child, emit, signal) {
    const startedAt = Date.now();
    let finished = false;
    const heartbeat = setInterval(() => emit({ type: "status", message: `${label}が解説を作成しています（${Math.round((Date.now() - startedAt) / 1000)}秒）` }), HEARTBEAT_MS);
    const timeout = setTimeout(() => {
      if (!settle()) return;
      emit({ type: "error", message: `${label}の応答が${PROVIDER_TIMEOUT_MS / 1000}秒以内に完了しませんでした。時間を置くか再試行してください。` });
      child.kill("SIGTERM");
    }, PROVIDER_TIMEOUT_MS);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    function settle() {
      if (finished) return false;
      finished = true; clearInterval(heartbeat); clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      return true;
    }
    return settle;
  }

  function runCodex({ promptText, schemaPath, resultExtras, emit, signal }) {
    return new Promise(resolve => {
      emit({ type: "status", message: "Codexを起動しています" });
      const args = ["--ask-for-approval", "never", "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules", "--output-schema", schemaPath, "--json", "-"];
      const child = spawn(codexBinary, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "", finalText = "", stderr = "";
      const settle = lifecycle("Codex", child, emit, signal);
      child.stdin.on("error", () => {}); child.stdin.end(promptText);
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.stdout.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "item.completed" && event.item?.type === "agent_message") finalText = event.item.text || finalText;
          } catch { /* CLI diagnostic line */ }
        }
      });
      child.on("error", error => { if (settle()) emit({ type: "error", message: String(error) }); resolve(); });
      child.on("close", code => {
        if (!settle()) return resolve();
        if (signal?.aborted) return resolve();
        if (code !== 0) emit({ type: "error", message: stderr.trim() || `Codex exited with ${code}` });
        else {
          try { emit({ type: "result", result: { ...JSON.parse(finalText), ...(resultExtras || {}) } }); }
          catch { emit({ type: "error", message: "Codexの構造化出力を解析できませんでした" }); }
        }
        resolve();
      });
    });
  }

  function runClaude({ promptText, schemaPath, resultExtras, emit, signal }) {
    return new Promise(resolve => {
      emit({ type: "status", message: "Claudeを起動しています" });
      let args;
      try { args = claudeArguments(readFileSync(schemaPath, "utf8")); }
      catch (error) { emit({ type: "error", message: String(error) }); return resolve(); }
      const child = spawn(claudeBinary, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const settle = lifecycle("Claude", child, emit, signal);
      child.stdin.on("error", () => {}); child.stdin.end(promptText);
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { if (settle()) emit({ type: "error", message: String(error) }); resolve(); });
      child.on("close", code => {
        if (!settle()) return resolve();
        if (signal?.aborted) return resolve();
        if (code !== 0) emit({ type: "error", message: stderr.trim() || `Claude exited with ${code}` });
        else {
          try { emit({ type: "result", result: { ...parseClaudeOutput(stdout), ...(resultExtras || {}) } }); }
          catch (error) { emit({ type: "error", message: `Claudeの構造化出力を解析できませんでした: ${error.message}` }); }
        }
        resolve();
      });
    });
  }

  return { run, status };
}
