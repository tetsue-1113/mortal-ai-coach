import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function promptPath(name) {
  return new URL(`../prompts/${name}`, import.meta.url);
}

// 解説文へ内部フィールド名が漏れないよう、3つのプロンプトすべてに言い換えルールを置く。
const READER_FACING = ["scene_analysis.system.md", "question_answer.system.md", "summary.system.md"];

test("every reader-facing prompt forbids leaking internal field names", async () => {
  for (const name of READER_FACING) {
    const source = await readFile(promptPath(name), "utf8");
    assert.match(source, /読者に見せる言葉の原則/, `${name} に言い換えルールが無い`);
    assert.match(source, /フィールド名/, `${name} にフィールド名の禁止が無い`);
    for (const identifier of ["standings", "turnPhase", "verifiedTileCounts", "safety", "metrics"]) {
      assert.ok(source.includes(identifier), `${name} の禁止例に ${identifier} が無い`);
    }
  }
});

test("scene analysis prompt lists the mahjong wording for each internal value", async () => {
  const source = await readFile(promptPath("scene_analysis.system.md"), "utf8");
  // 内部データ→麻雀の言葉 の対応表があること。
  assert.match(source, /\| *内部データ *\| *出力での書き方 *\|/);
  for (const wording of ["トップとは7000点差", "表ドラ1枚と赤ドラ1枚", "下家の現物", "オーラス", "親番"]) {
    assert.ok(source.includes(wording), `対応表に「${wording}」が無い`);
  }
  // 出力前の自己検証にも識別子チェックを入れていること。
  assert.match(source, /英字のフィールド名・変数名が1つも無い/);
  assert.match(source, /バッククォート/);
});

test("scene analysis prompt no longer tells the model to cite raw field names", async () => {
  const source = await readFile(promptPath("scene_analysis.system.md"), "utf8");
  const outputRules = source.slice(source.indexOf("## `reason`"));
  // 4観点の指示は麻雀の言葉で書かれ、フィールド名を引用させない。
  assert.doesNotMatch(outputRules, /`selfRank`[^|]*引用/);
  assert.doesNotMatch(outputRules, /`safety\.genbutsu`[^|]*名指し/);
  assert.match(outputRules, /読者に見せる言葉の原則」に従い/);
});

test("question answer prompt asks for board facts as evidence, not field paths", async () => {
  const source = await readFile(promptPath("question_answer.system.md"), "utf8");
  assert.doesNotMatch(source, /"evidence": "scene\./);
  assert.match(source, /そう言える麻雀上の理由/);
  assert.match(source, /盤面のどんな事実からそう言えるか/);
});

test("initial scene explanation cannot see the actual future outcome", async () => {
  const source = await readFile(new URL("application/scene-service.mjs", import.meta.url), "utf8");
  const promptFunction = source.slice(source.indexOf("function analysisPrompt(data)"), source.indexOf("return {", source.indexOf("function analysisPrompt(data)")));
  assert.match(promptFunction, /roundOutcome: undefined/);
  assert.match(promptFunction, /actual: null/);
});

test("tactics guidance is constrained to computed facts and non-deterministic river reading", async () => {
  const scene = await readFile(promptPath("scene_analysis.system.md"), "utf8");
  const question = await readFile(promptPath("question_answer.system.md"), "utf8");
  assert.match(scene, /記事の定石でMortal推奨や計算済み数値を上書きしない/);
  assert.match(scene, /待ちや放銃率を断定しない/);
  assert.match(question, /単騎・双碰・嵌張/);
});
