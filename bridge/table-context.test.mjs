import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";

test("Mortal event log restores rivers, riichi declaration and calls per scene", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  class Element {}
  const sandbox = { __MCL_TEST__: true, Element, window: { addEventListener() {} } };
  sandbox.globalThis = sandbox;
  new Script(source).runInContext(createContext(sandbox));

  const first = { junme: 1, tiles_left: 69, last_actor: 0, tile: "4m", actual: { type: "dahai", pai: "9s" }, expected: { type: "dahai", pai: "9s" } };
  const second = { junme: 2, tiles_left: 67, last_actor: 0, tile: "7s", actual: { type: "dahai", pai: "1m" }, expected: { type: "dahai", pai: "2m" } };
  const report = {
    player_id: 0,
    review: { kyokus: [{ kyoku: 0, honba: 0, relative_scores: [25000, 25000, 25000, 25000], entries: [first, second] }] },
    mjai_log: [
      { type: "start_kyoku", bakaze: "E", kyoku: 1, honba: 0, dora_marker: "3p" },
      { type: "dahai", actor: 1, pai: "9m", tsumogiri: false },
      { type: "tsumo", actor: 0, pai: "4m" },
      { type: "reach", actor: 1 },
      { type: "dahai", actor: 1, pai: "5p", tsumogiri: false },
      { type: "reach_accepted", actor: 1 },
      { type: "pon", actor: 2, target: 1, pai: "5p", consumed: ["5p", "5pr"] },
      { type: "tsumo", actor: 0, pai: "7s" },
      { type: "end_kyoku" }
    ]
  };

  const contexts = sandbox.__MCL_TEST_API__.buildTableContexts(report, "report_test");
  const keys = Object.keys(contexts);
  assert.equal(keys.length, 2);
  assert.equal(contexts[keys[0]].kyotakuSticks, null);
  const table = contexts[keys[1]];
  assert.equal(table.kyotakuSticks, 1);
  assert.deepEqual(Array.from(table.doraIndicators), ["3p"]);
  assert.equal(table.players[1].relation, "shimocha");
  assert.equal(table.players[1].riichiAccepted, true);
  assert.equal(table.players[1].discards[1].tile, "5p");
  assert.equal(table.players[1].discards[1].riichiDeclaration, true);
  assert.equal(table.players[1].discards[1].called, true);
  assert.equal(table.players[2].calls[0].type, "pon");
  assert.deepEqual(Array.from(table.players[2].calls[0].consumed), ["5p", "5pr"]);
  assert.equal(table.players[2].calls[0].atDiscardCount, 0);
  const secondPayload = sandbox.__MCL_TEST_API__.scenePayload(report, 0, 1);
  assert.deepEqual(Array.from(secondPayload.scores), [25000, 24000, 25000, 25000]);
  assert.equal(secondPayload.table.players[1].score, 24000);

  const formatted = sandbox.__MCL_TEST_API__.formatCoachingReason("### 手役・打点面\n- **三色同順**を維持\n### 安全性\n- 2sは筋");
  assert.match(formatted, /<h4>手役・打点面<\/h4>/);
  assert.match(formatted, /<strong>三色同順<\/strong>/);
  assert.match(formatted, /<h4>安全性<\/h4>/);
  assert.doesNotMatch(formatted, /###|\*\*/);

  const analysisHtml = sandbox.__MCL_TEST_API__.analysisResultHtml({
    banner: { verdict: "clear", qDelta: 0.029, oneLine: "七対子より通常手の変化を優先します。" },
    comparison: [
      { tile: "7p", isMortalTop: true, isActual: false, ukeire: 16, value: 5200, danger: "中" },
      { tile: "9m", isMortalTop: false, isActual: true, ukeire: 12, value: 5200, danger: "安" },
      { tile: "8s", isMortalTop: false, isActual: false, ukeire: null, value: null, danger: null }
    ],
    reason: "### 手役・打点面\n- 三色を維持\n### 手牌構造面\n- 浮き牌を比較\n### 安全性\n- 現物なし\n### 状況判断\n- 平場は速度優先",
    lesson: "序盤は通常手の変化を優先する。",
    pushFold: { code: "lean_push", label: "やや押し", attackScore: 72, defenceScore: 44,
      evidence: [{ text: "推奨打牌後は1シャンテン、受け入れ16枚" }, { text: "対面は2副露" }],
      note: "公開情報による補助判定。放銃率・局収支・期待値そのものではありません。" },
    scoreSimulation: {
      assumedOpponent: { relation: "対面", basis: "対面がリーチ済み" },
      selfRon: [{ handPoints: 3900, honbaBonus: 300, kyotakuBonus: 1000, selfDelta: 5200, afterScore: 30200, afterRank: 1 }],
      dealIn: [{ handPoints: 3900, honbaBonus: 300, kyotakuBonus: 1000, selfDelta: -4200, afterScore: 20800, afterRank: 4 }],
      actual: { label: "他家の和了（横移動）", selfDelta: 0, afterRank: 2 },
      note: "固定打点別の条件計算です。"
    }
  }, {
    actual: { type: "dahai", pai: "9m" }, expected: { type: "dahai", pai: "7p" },
    actual_index: 1,
    details: [{ q_value: 0.5 }, { q_value: 0.471 }]
  });
  assert.match(analysisHtml, /実打[\s\S]*9m[\s\S]*⚠️[\s\S]*明確な差[\s\S]*\(-0\.029\)/);
  assert.match(analysisHtml, /推奨[\s\S]*7p/);
  assert.match(analysisHtml, /💡[\s\S]*七対子より通常手の変化を優先します。/);
  assert.match(analysisHtml, /候補比較[\s\S]*7p[\s\S]*Mortal推奨[\s\S]*9m/);
  assert.match(analysisHtml, /8s[\s\S]*—/);
  assert.match(analysisHtml, /<details class="mcl-analysis-details" open>/);
  assert.match(analysisHtml, /<h4>手役・打点面<\/h4>/);
  assert.match(analysisHtml, /押し引き判定[\s\S]*やや押し[\s\S]*攻撃材料[\s\S]*72[\s\S]*守備材料[\s\S]*44/);
  assert.match(analysisHtml, /点棒・着順シミュレーション[\s\S]*実際の局結果[\s\S]*他家の和了（横移動）/);
  assert.match(analysisHtml, /自分がロン[\s\S]*3900点＋本場300点＋供託1000点[\s\S]*\+5200 → 30200[\s\S]*1着/);
  assert.match(analysisHtml, /自分が放銃[\s\S]*-4200 → 20800[\s\S]*4着/);

  const parsedRound = sandbox.__MCL_TEST_API__.parseRoundDisplay("南1-1 +1000", 0);
  assert.deepEqual({ ...parsedRound }, { round: "S1", honba: 1 });
  assert.deepEqual({ ...sandbox.__MCL_TEST_API__.parseRoundDisplay("東2", 3) }, { round: "E2", honba: 3 });
  assert.deepEqual({ ...sandbox.__MCL_TEST_API__.parseRoundDisplay("S4－2+2000", 0) }, { round: "S4", honba: 2 });
  assert.equal(sandbox.__MCL_TEST_API__.parseRoundDisplay("南1局", 0), null);

  assert.deepEqual(Array.from(sandbox.__MCL_TEST_API__.scoresByPlayer(
    [26000, 25000, 25000, 24000], 1
  )), [24000, 26000, 25000, 25000]);
  assert.deepEqual(Array.from(sandbox.__MCL_TEST_API__.scoresByPlayer(
    [31000, 27000, 23000, 19000], 3
  )), [27000, 23000, 19000, 31000]);

  assert.equal(sandbox.__MCL_TEST_API__.questionAnswerText([{
    category: "防御", text: "7pは対面に無筋です。", evidence: "scene.table.players[2]"
  }]), "・[防御] 7pは対面に無筋です。\n  └ 根拠: scene.table.players[2]");
});

test("kyotakuSticks adds carried-over riichi sticks to newly declared ones", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  class Element {}
  const sandbox = { __MCL_TEST__: true, Element, window: { addEventListener() {} } };
  sandbox.globalThis = sandbox;
  new Script(source).runInContext(createContext(sandbox));

  const entry = { junme: 1, tiles_left: 69, last_actor: 0, tile: "4m", actual: { type: "dahai", pai: "9s" }, expected: { type: "dahai", pai: "9s" } };
  const report = {
    player_id: 0,
    review: { kyokus: [{ kyoku: 0, honba: 1, entries: [entry] }] },
    mjai_log: [
      { type: "start_kyoku", bakaze: "E", kyoku: 1, honba: 1, kyotaku: 1, dora_marker: "3p" },
      { type: "dahai", actor: 1, pai: "9m", tsumogiri: false },
      { type: "reach", actor: 1 },
      { type: "dahai", actor: 1, pai: "5p", tsumogiri: false },
      { type: "reach_accepted", actor: 1 },
      { type: "tsumo", actor: 0, pai: "4m" },
      { type: "end_kyoku" }
    ]
  };

  const contexts = sandbox.__MCL_TEST_API__.buildTableContexts(report, "report_test_2");
  const [key] = Object.keys(contexts);
  assert.equal(contexts[key].kyotakuSticks, 2);
});

test("round outcome uses absolute player order and next-round scores", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  class Element {}
  const sandbox = { __MCL_TEST__: true, Element, window: { addEventListener() {} } };
  sandbox.globalThis = sandbox;
  new Script(source).runInContext(createContext(sandbox));
  const entry = { junme: 1, tiles_left: 69, last_actor: 1, tile: "4m", state: { tehai: ["1m", "2m", "3m"] },
    actual: { type: "dahai", pai: "1m" }, expected: { type: "dahai", pai: "1m" }, details: [] };
  const report = { player_id: 1, review: { kyokus: [
    { kyoku: 0, honba: 0, relative_scores: [26000, 24000, 25000, 25000], entries: [entry],
      end_status: [{ type: "hora", actor: 1, target: 2, deltas: [0, 4000, -4000, 0] }] },
    { kyoku: 1, honba: 0, relative_scores: [30000, 20000, 25000, 25000], entries: [] }
  ] }, mjai_log: [] };
  const payload = sandbox.__MCL_TEST_API__.scenePayload(report);
  assert.deepEqual(Array.from(payload.scores), [25000, 26000, 24000, 25000]);
  assert.deepEqual(Array.from(payload.roundOutcome.scoresAfter), [25000, 30000, 20000, 25000]);
  assert.equal(payload.roundOutcome.events[0].actor, 1);
  assert.equal(payload.roundOutcome.events[0].target, 2);
});

test("SQLite save is only triggered by the explicit DB save action", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  assert.match(source, /#mcl-record-status"\)\.addEventListener\("click", enableDatabaseSave\)/);
  assert.equal((source.match(/await persistAllScenes\(\)/g) || []).length, 1);
  assert.match(source, /async function enableDatabaseSave\(\)[\s\S]*await persistAllScenes\(\)/);
  assert.doesNotMatch(source, /db-opt-in:/);
});

test("a reloaded extension stops calling chrome APIs instead of throwing", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../extension/clients/bridge-client.js", import.meta.url), "utf8");
  // View/composition側はChrome APIを直接呼ばず、BridgeClientだけに依存する。
  assert.doesNotMatch(source, /chrome\.(runtime|storage)/);
  assert.equal((client.match(/chrome\.storage\.local\.(get|set)\(/g) || []).length, 2);
  assert.equal((client.match(/chrome\.runtime\.connect\(/g) || []).length, 1);
  assert.match(client, /async call\(run, fallback = null\)[\s\S]*Extension context invalidated/);
  assert.match(source, /function openStreamPort\(\)[\s\S]*bridgeClient\?\.openStream\(\)/);
  assert.equal((source.match(/const port = openStreamPort\(\);\s*\n\s*if \(!port\) return;/g) || []).length, 3);
  // 失効後はポーリングも監視も止め、再読み込みを促す。
  assert.match(source, /function noteContextLost\(\)[\s\S]*clearInterval\(state\.healthTimer\)/);
  assert.match(source, /state\.healthTimer = setInterval\(health, 15000\)/);
  assert.match(source, /new MutationObserver\(\(\) => {\s*if \(state\.contextLost\) return;/);
  assert.match(source, /async function connect\(\) {\s*if \(state\.contextLost\) { location\.reload\(\); return; }/);
});

test("navigating scenes never marks a saved report as unsaved again", async () => {
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");
  // 局面移動・プロバイダ切替・キャッシュ再読込は保存状態を変えない。
  const positionChanged = source.match(/async function positionChanged\(\)[\s\S]*?\n  }\n/)[0];
  assert.doesNotMatch(positionChanged, /persist(Current|Batch|AllScenes)\(/);
  const changeProvider = source.match(/async function changeProvider\([\s\S]*?\n  }\n/)[0];
  assert.doesNotMatch(changeProvider, /persist(Current|Batch|AllScenes)\(/);
  // 保存済みの半荘だけ、新しい解説をその局面ぶんだけ静かに上書きする。
  assert.match(source, /async function persistCurrent\(\)\s*{\s*if \(state\.recordState !== "saved"/);
  assert.match(source, /saveRecords\(\[recordFor\([\s\S]{0,160}?\{ quiet: true \}\)/);
  // 未保存へ戻す処理は残っていない。
  assert.doesNotMatch(source, /state\.recordState = "unsaved";\s*\n\s*renderRecordState\(\)/);
});
