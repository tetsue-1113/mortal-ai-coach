export function normalizeProvider(value) {
  return value === "claude" ? "claude" : "codex";
}

export function claudeArguments(schemaText) {
  const schema = JSON.parse(schemaText);
  // Claude Code's validator may not register the Draft 2020-12 meta-schema.
  // The extension only uses portable keywords, so omit the declaration itself.
  delete schema.$schema;
  const portableSchema = JSON.stringify(schema);
  return [
    "-p",
    "--output-format", "json",
    "--json-schema", portableSchema,
    "--tools", "",
    "--disallowedTools", "mcp__*",
    "--permission-mode", "plan",
    "--no-session-persistence",
    "--max-turns", "1",
    // 受け入れ枚数・危険度・着順はブリッジ側で計算済みで、Claudeの仕事は
    // その数値を日本語へ言い換えることに絞られる。重い推論は不要なため
    // Sonnet 5 + effort low で応答時間とトークン消費を抑える。
    "--model", "claude-sonnet-5",
    "--effort", "low"
  ];
}

export function parseClaudeOutput(stdout) {
  const envelope = JSON.parse(String(stdout || ""));
  if (envelope?.subtype && envelope.subtype !== "success") {
    throw new Error(`Claude structured output failed: ${envelope.subtype}`);
  }
  if (envelope?.structured_output && typeof envelope.structured_output === "object") return envelope.structured_output;
  if (typeof envelope?.result === "string") return JSON.parse(envelope.result);
  throw new Error("Claudeの構造化出力を解析できませんでした");
}
