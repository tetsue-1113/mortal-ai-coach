import assert from "node:assert/strict";
import test from "node:test";
import { claudeArguments, normalizeProvider, parseClaudeOutput } from "./providers.mjs";

test("provider input is restricted to Codex or Claude", () => {
  assert.equal(normalizeProvider("claude"), "claude");
  assert.equal(normalizeProvider("anything-else"), "codex");
});

test("Claude runs without tools and with JSON Schema", () => {
  const schema = JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { answer: { type: "string" } }, required: ["answer"] });
  const args = claudeArguments(schema);
  assert.deepEqual(args.slice(0, 3), ["-p", "--output-format", "json"]);
  const claudeSchema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
  assert.equal(claudeSchema.$schema, undefined);
  assert.equal(claudeSchema.type, "object");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--no-session-persistence")], "--no-session-persistence");
  assert.equal(args[args.indexOf("--effort") + 1], "low");
  assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
});

test("Claude structured output envelope is parsed", () => {
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ type: "result", subtype: "success", structured_output: { answer: "ok" } })), { answer: "ok" });
});
