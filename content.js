(() => {
  "use strict";

  const ROOT_ID = "mortal-codex-live-root";
  const REPORT_RE = /\/report\/([a-zA-Z0-9_-]+)\.json/;
  const state = {
    report: null,
    reportId: null,
    gameLength: null,
    contextLost: false,
    healthTimer: null,
    position: null,
    entry: null,
    result: null,
    generating: false,
    bridge: null,
    positionTimer: null,
    lastKey: null,
    currentKey: null,
    currentSignature: null,
    activePort: null,
    summaryResult: null,
    showingSummary: false,
    generatingKind: null,
    batchMap: {},
    batchError: null,
    chatByScene: {},
    questionGenerating: false,
    questionKey: null,
    questionPort: null,
    provider: "codex",
    tableByScene: {},
    recordState: "unsaved",
    recordError: null,
    recordTimer: null
  };
  const pageAdapter = globalThis.MortalCoach?.MortalPageAdapter || {
    parseRoundDisplay(value, fallbackHonba = 0) {
      const match = String(value || "").trim().match(/^([ES東南])\s*([1-4])(?:[-－]\s*(\d+))?(?:\s*\+\s*\d+)?$/);
      if (!match) return null;
      const wind = match[1] === "東" ? "E" : match[1] === "南" ? "S" : match[1];
      return { round: `${wind}${match[2]}`, honba: match[3] === undefined ? Number(fallbackHonba) || 0 : Number(match[3]) };
    },
    safeTile(value) {
      const raw = String(value || "");
      const red = raw.match(/^0([mps])$/);
      if (red) return `5${red[1]}r`;
      return /^(?:[1-9][mps]r?|[ESWNPFC])$/.test(raw) ? raw : null;
    },
    scoresByPlayer(relativeScores, playerId) {
      const absolute = [null, null, null, null];
      if (!Array.isArray(relativeScores) || !Number.isInteger(playerId) || playerId < 0 || playerId > 3) return absolute;
      relativeScores.slice(0, 4).forEach((score, offset) => {
        absolute[(playerId + offset) % 4] = Number.isFinite(Number(score)) ? Number(score) : null;
      });
      return absolute;
    }
  };
  const bridgeClient = globalThis.MortalCoach?.BridgeClient
    ? new globalThis.MortalCoach.BridgeClient({ onContextLost: () => noteContextLost() })
    : null;

  const html = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function isPanelEditor(target) {
    return target instanceof Element && !!target.closest(`#${ROOT_ID} textarea, #${ROOT_ID} input, #${ROOT_ID} [contenteditable="true"]`);
  }

  function blockMortalShortcut(event) {
    if (!isPanelEditor(event.target)) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  ["keydown", "keypress", "keyup"].forEach(type =>
    window.addEventListener(type, blockMortalShortcut, { capture: true }));

  function mahjongText(value) {
    const honors = { E: "東", S: "南", W: "西", N: "北", P: "白", F: "發", C: "中", s: "南" };
    return String(value ?? "").replace(/(^|[^0-9A-Za-z])([ESWNPFCs])(?=$|[^0-9A-Za-z])/g,
      (_match, prefix, code) => `${prefix}${honors[code]}`);
  }

  function dataUrl() {
    const raw = new URLSearchParams(location.search).get("data") || "";
    const url = new URL(raw, location.origin);
    const match = url.pathname.match(REPORT_RE);
    if (!match) throw new Error("MortalレポートURLを特定できません。");
    state.reportId = match[1];
    return url.href;
  }

  function readHonba() {
    const match = (document.querySelector(".info-honbas")?.textContent || "").match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function parseRoundDisplay(value, fallbackHonba = 0) {
    return pageAdapter.parseRoundDisplay(value, fallbackHonba);
  }

  function readActionHint() {
    const table = document.querySelector("main table");
    if (!table) return {};
    const rows = Array.from(table.querySelectorAll("tr"));
    const readRow = row => {
      if (!row) return null;
      const src = row.querySelector("img")?.getAttribute("src") || "";
      const tile = src.match(/\/([1-9][mps]r?|[ESWNPFC])\.svg(?:\?|$)/)?.[1] || null;
      return { text: row.textContent?.trim() || "", tile };
    };
    return { actual: readRow(rows[0]), expected: readRow(rows[1]) };
  }

  function readPosition() {
    const roundText = document.querySelector(".info-round")?.textContent?.trim();
    if (!roundText) return null;
    const parsedRound = parseRoundDisplay(roundText, readHonba());
    const playerId = Number.isInteger(state.report?.player_id) ? state.report.player_id : 0;
    const tilesLeftText = document.querySelector(".info-tiles-left")?.textContent?.trim() || "";
    const tilesLeftMatch = tilesLeftText.match(/(\d+)/);
    return {
      round: parsedRound?.round || roundText,
      honba: parsedRound?.honba ?? readHonba(),
      junme: document.querySelectorAll(`.grid-discard-p${playerId} .tileImg`).length + 1,
      tilesLeft: tilesLeftMatch ? Number(tilesLeftMatch[1]) : null,
      hint: readActionHint()
    };
  }

  function roundIndex(round) {
    const match = round?.match(/^([ES])(\d)$/);
    if (!match) return -1;
    return (match[1] === "S" ? 4 : 0) + Number(match[2]) - 1;
  }

  function actionTile(action) { return action?.pai || null; }
  function isMismatch(entry) { return entry && entry.is_equal === false; }

  function locateEntry(position) {
    if (!state.report || !position) return null;
    const index = roundIndex(position.round);
    const kyoku = state.report.review?.kyokus?.find(k => k.kyoku === index && k.honba === position.honba);
    if (!kyoku) return null;
    const allMismatches = kyoku.entries.filter(isMismatch);
    const actualTile = position.hint?.actual?.tile;
    const expectedTile = position.hint?.expected?.tile;
    if (actualTile || expectedTile) {
      const exactHint = allMismatches.filter(e =>
        (!actualTile || actionTile(e.actual) === actualTile) &&
        (!expectedTile || actionTile(e.expected) === expectedTile));
      if (exactHint.length === 1) return exactHint[0];
      if (actualTile) {
        const actualHint = allMismatches.filter(e => actionTile(e.actual) === actualTile);
        if (actualHint.length === 1) return actualHint[0];
      }
    }
    const tilesLeftMatches = Number.isFinite(position.tilesLeft)
      ? kyoku.entries.filter(e => e.tiles_left === position.tilesLeft)
      : [];
    const candidates = tilesLeftMatches.length
      ? tilesLeftMatches
      : kyoku.entries.filter(e => e.junme === position.junme);
    if (!candidates.length) {
      if (Number.isFinite(position.tilesLeft) && allMismatches.length) {
        return [...allMismatches].sort((a, b) =>
          Math.abs(a.tiles_left - position.tilesLeft) - Math.abs(b.tiles_left - position.tilesLeft))[0];
      }
      return null;
    }
    const mismatches = candidates.filter(isMismatch);
    const pool = mismatches.length ? mismatches : candidates;
    return pool.find(e => (!actualTile || actionTile(e.actual) === actualTile) && (!expectedTile || actionTile(e.expected) === expectedTile))
      || pool.find(e => !actualTile || actionTile(e.actual) === actualTile)
      || pool[0];
  }

  function qFor(entry, action, fallbackIndex) {
    const details = entry?.details || [];
    if (Number.isInteger(fallbackIndex) && details[fallbackIndex]) return details[fallbackIndex].q_value;
    const found = details.find(d => d.action?.type === action?.type && (d.action?.pai || null) === (action?.pai || null));
    return found?.q_value ?? null;
  }

  function entryFacts(entry) {
    if (!entry) return null;
    const expectedQ = qFor(entry, entry.expected, 0);
    const actualQ = qFor(entry, entry.actual, entry.actual_index);
    const loss = Number.isFinite(expectedQ) && Number.isFinite(actualQ) ? Math.max(0, expectedQ - actualQ) : null;
    return { expectedQ, actualQ, loss };
  }

  function positionLabel(position) {
    if (!position) return "局面を取得中";
    const wind = position.round.startsWith("E") ? "東" : "南";
    return `${wind}${position.round.slice(1)}局${position.honba ? ` ${position.honba}本場` : ""} ${position.junme}巡目`;
  }

  function entryKey(position, entry) {
    return [state.reportId, roundIndex(position.round), position.honba, entry?.junme,
      entry?.actual?.type, entry?.actual?.pai, entry?.expected?.type, entry?.expected?.pai].join(":");
  }

  function sceneIdFor(kyoku, entry) {
    return [state.reportId, kyoku.kyoku, kyoku.honba, entry?.junme,
      entry?.actual?.type, entry?.actual?.pai, entry?.expected?.type, entry?.expected?.pai].join(":");
  }

  function safeTile(value) {
    return pageAdapter.safeTile(value);
  }

  function roundNumberFromStart(start, fallback) {
    const wind = String(start?.bakaze || "").toUpperCase();
    const hand = Number(start?.kyoku);
    if ((wind === "E" || wind === "S") && Number.isFinite(hand)) return (wind === "S" ? 4 : 0) + hand - 1;
    return fallback;
  }

  function splitMjaiRounds(log) {
    const rounds = [];
    let current = null;
    for (const event of Array.isArray(log) ? log : []) {
      if (event?.type === "start_kyoku") {
        current = { start: event, events: [] };
      } else if (event?.type === "end_kyoku") {
        if (current) rounds.push(current);
        current = null;
      } else if (current && !["start_game", "end_game"].includes(event?.type)) {
        current.events.push(event);
      }
    }
    if (current) rounds.push(current);
    return rounds;
  }

  function tableSnapshot(table, kyokuNumber, carriedKyotaku) {
    const hero = Number(state.report?.player_id) || 0;
    const relations = ["self", "shimocha", "toimen", "kamicha"];
    const winds = ["E", "S", "W", "N"];
    const dealer = kyokuNumber % 4;
    const activeRiichiSticks = table.players.filter(player => player.riichiAccepted).length;
    return {
      doraIndicators: table.doraIndicators.map(safeTile).filter(Boolean),
      kyotakuSticks: Number.isFinite(carriedKyotaku) ? carriedKyotaku + activeRiichiSticks : (activeRiichiSticks || null),
      players: table.players.map((player, playerId) => ({
        playerId,
        relation: relations[(playerId - hero + 4) % 4],
        seatWind: winds[(playerId - dealer + 4) % 4],
        riichiAccepted: player.riichiAccepted,
        discards: player.discards.map(discard => ({ ...discard })),
        calls: player.calls.map(call => ({ ...call, consumed: [...call.consumed] }))
      }))
    };
  }

  function applyTableEvent(table, event, previousEvent) {
    const actor = Number(event?.actor);
    const target = Number(event?.target);
    if (event?.type === "dora") {
      const marker = safeTile(event.dora_marker);
      if (marker) table.doraIndicators.push(marker);
      return;
    }
    if (!Number.isInteger(actor) || actor < 0 || actor > 3) return;
    if (event.type === "dahai") {
      const discarded = safeTile(event.pai);
      if (discarded) table.players[actor].discards.push({
        tile: discarded,
        tsumogiri: !!event.tsumogiri,
        riichiDeclaration: previousEvent?.type === "reach" && Number(previousEvent.actor) === actor,
        called: false
      });
    } else if (["chi", "pon", "daiminkan"].includes(event.type)) {
      if (Number.isInteger(target) && table.players[target]?.discards.length) {
        table.players[target].discards.at(-1).called = true;
      }
      table.players[actor].calls.push({
        type: event.type,
        pai: safeTile(event.pai),
        consumed: (event.consumed || []).map(safeTile).filter(Boolean),
        fromPlayer: Number.isInteger(target) ? target : null,
        atDiscardCount: table.players[actor].discards.length
      });
    } else if (["ankan", "kakan"].includes(event.type)) {
      table.players[actor].calls.push({
        type: event.type,
        pai: safeTile(event.pai),
        consumed: (event.consumed || []).map(safeTile).filter(Boolean),
        fromPlayer: null,
        atDiscardCount: table.players[actor].discards.length
      });
    } else if (event.type === "reach_accepted") {
      table.players[actor].riichiAccepted = true;
    }
    const marker = safeTile(event.dora_marker);
    if (marker) table.doraIndicators.push(marker);
  }

  function detectGameLength(kyokus) {
    const hasSouthRound = (kyokus || []).some(k => Number(k.kyoku) >= 4);
    return hasSouthRound ? "hanchan" : null;
  }

  function buildTableContexts() {
    const result = {};
    const reviewKyokus = state.report?.review?.kyokus || [];
    state.gameLength = detectGameLength(reviewKyokus);
    const rounds = splitMjaiRounds(state.report?.mjai_log);
    const hero = Number(state.report?.player_id) || 0;
    for (const [roundOffset, kyoku] of reviewKyokus.entries()) {
      const round = rounds.find((candidate, index) =>
        roundNumberFromStart(candidate.start, index) === kyoku.kyoku && Number(candidate.start?.honba || 0) === Number(kyoku.honba || 0))
        || rounds[roundOffset];
      if (!round) continue;
      const initialDora = safeTile(round.start?.dora_marker);
      const carriedKyotaku = Number.isFinite(Number(round.start?.kyotaku)) ? Number(round.start.kyotaku) : null;
      const table = {
        doraIndicators: initialDora ? [initialDora] : [],
        players: Array.from({ length: 4 }, () => ({ discards: [], calls: [], riichiAccepted: false }))
      };
      const entries = kyoku.entries || [];
      let reviewIndex = 0;
      for (let eventIndex = 0; eventIndex < round.events.length && reviewIndex < entries.length; eventIndex++) {
        const event = round.events[eventIndex];
        const previousEvent = round.events[eventIndex - 1];
        applyTableEvent(table, event, previousEvent);
        const entry = entries[reviewIndex];
        const opponentDraw = Number(event.actor) !== hero && event.type === "tsumo";
        const heroDiscard = Number(event.actor) === hero && event.type === "dahai";
        if (opponentDraw || heroDiscard) continue;
        const previousEntry = entries[reviewIndex - 1];
        const heroRiichi = Number(event.actor) === hero && event.type === "reach" && previousEntry && entry.junme === previousEntry.junme;
        if (Number(event.actor) === Number(entry.last_actor) && (safeTile(event.pai) === safeTile(entry.tile) || heroRiichi)) {
          result[sceneIdFor(kyoku, entry)] = tableSnapshot(table, kyoku.kyoku, carriedKyotaku);
          reviewIndex++;
        }
      }
    }
    state.tableByScene = result;
  }
  function cleanAction(action) {
    if (!action || typeof action.type !== "string") return null;
    const allowed = ["dahai", "none", "reach", "chi", "pon", "kan", "ankan", "kakan", "daiminkan", "hora", "ryukyoku"];
    if (!allowed.includes(action.type)) return null;
    const result = { type: action.type };
    const pai = safeTile(action.pai);
    if (pai) result.pai = pai;
    if (Array.isArray(action.consumed)) result.consumed = action.consumed.map(safeTile).filter(Boolean).slice(0, 4);
    return result;
  }

  function contextFor(kyoku) {
    const playerId = Number(state.report.player_id) || 0;
    const dealer = kyoku.kyoku % 4;
    const seatWinds = ["E", "S", "W", "N"];
    return {
      roundWind: kyoku.kyoku < 4 ? "E" : "S",
      seatWind: seatWinds[(playerId - dealer + 4) % 4],
      dealer: playerId === dealer
    };
  }

  function scoresByPlayer(relativeScores, playerId) {
    return pageAdapter.scoresByPlayer(relativeScores, playerId);
  }

  function payloadFor(kyoku, entry) {
    const facts = entryFacts(entry);
    const sceneId = sceneIdFor(kyoku, entry);
    const playerId = Number(state.report.player_id) || 0;
    const startScores = scoresByPlayer(kyoku.relative_scores, playerId);
    const rawTable = state.tableByScene[sceneId] || { doraIndicators: [], kyotakuSticks: null, players: [] };
    // review.relative_scoresは局開始時点。成立済みリーチ棒を差し引いて現在点へ直す。
    const scores = startScores.map((score, id) => Number.isFinite(score) && rawTable.players.some(player => player.playerId === id && player.riichiAccepted)
      ? score - 1000 : score);
    const table = {
      ...rawTable,
      scoresIncludeRiichiDeposits: true,
      players: rawTable.players.map(player => ({ ...player, score: scores[player.playerId] }))
    };
    const reviewKyokus = state.report.review?.kyokus || [];
    const kyokuIndex = reviewKyokus.indexOf(kyoku);
    const nextKyoku = kyokuIndex >= 0 ? reviewKyokus[kyokuIndex + 1] : null;
    const scoresAfter = nextKyoku ? scoresByPlayer(nextKyoku.relative_scores, playerId) : null;
    const roundOutcome = {
      events: (kyoku.end_status || []).slice(0, 4).map(event => ({
        type: ["hora", "ryukyoku", "none"].includes(event?.type) ? event.type : "none",
        actor: Number.isInteger(Number(event?.actor)) ? Number(event.actor) : null,
        target: Number.isInteger(Number(event?.target)) ? Number(event.target) : null,
        deltas: Array.isArray(event?.deltas) ? event.deltas.slice(0, 4).map(value => Number(value)) : null
      })),
      scoresAfter: scoresAfter?.every(Number.isFinite) ? scoresAfter : null
    };
    return {
      sceneId,
      reportId: state.reportId,
      playerId,
      position: {
        kyoku: kyoku.kyoku, honba: kyoku.honba, junme: entry.junme, tilesLeft: entry.tiles_left,
        gameLength: state.gameLength || null,
        isLastKyoku: state.gameLength === "hanchan" ? kyoku.kyoku === 7 : null
      },
      context: contextFor(kyoku),
      scores,
      hand: (entry.state?.tehai || []).map(safeTile).filter(Boolean).slice(0, 14),
      calls: (entry.state?.fuuros || []).slice(0, 4).map(f => ({
        type: String(f.type || "").slice(0, 12), pai: safeTile(f.pai),
        consumed: (f.consumed || []).map(safeTile).filter(Boolean).slice(0, 4)
      })),
      actual: cleanAction(entry.actual), expected: cleanAction(entry.expected),
      shanten: Number.isFinite(entry.shanten) ? entry.shanten : null,
      flags: { furiten: !!entry.at_furiten, selfRiichi: !!entry.at_self_riichi, callDecision: !!entry.at_self_chi_pon },
      metrics: { expectedQ: facts.expectedQ, actualQ: facts.actualQ, loss: facts.loss },
      table,
      roundOutcome,
      alternatives: (entry.details || []).slice(0, 8).map(d => ({
        action: cleanAction(d.action),
        q: Number.isFinite(Number(d.q_value)) ? Number(d.q_value) : null,
        probability: Number.isFinite(Number(d.prob)) ? Number(d.prob) : null
      })).filter(d => d.action && (Number.isFinite(d.q) || Number.isFinite(d.probability)))
    };
  }

  function payload() {
    const index = roundIndex(state.position.round);
    const kyoku = state.report.review.kyokus.find(k => k.kyoku === index && k.honba === state.position.honba);
    return payloadFor(kyoku, state.entry);
  }

  function summaryPayload() {
    const scenes = [...(state.report.review?.kyokus || [])]
      .sort((a, b) => a.kyoku - b.kyoku || a.honba - b.honba)
      .flatMap(kyoku => kyoku.entries
        .filter(isMismatch)
        .sort((a, b) => a.junme - b.junme || b.tiles_left - a.tiles_left)
        .map(entry => {
          const scene = payloadFor(kyoku, entry);
          scene.alternatives = scene.alternatives.slice(0, 3);
          return scene;
        }));
    return {
      reportId: state.reportId,
      stats: {
        mortalRating: Number.isFinite(state.report.review?.rating) ? state.report.review.rating : null,
        totalMatches: Number(state.report.review?.total_matches) || 0,
        totalReviewed: Number(state.report.review?.total_reviewed) || 0,
        mismatchCount: scenes.length
      },
      scenes: scenes.slice(0, 80)
    };
  }

  /**
   * 拡張を再読み込み・更新すると、開いたままのページに残った旧content.jsは
   * chrome.* を呼んだ瞬間に "Extension context invalidated" で落ちる。
   * 一度検知したら以降のchrome呼び出しを止め、ページ再読み込みを促す。
   */
  function noteContextLost() {
    if (state.contextLost) return;
    state.contextLost = true;
    clearInterval(state.healthTimer);
    clearTimeout(state.positionTimer);
    state.generating = false; state.generatingKind = null; state.questionGenerating = false;
    const status = document.querySelector("#mcl-bridge-status");
    if (status) { status.textContent = "ページを再読み込み"; status.className = "mcl-status error"; status.disabled = false; }
    const progress = document.querySelector("#mcl-progress");
    if (progress) progress.textContent = "拡張機能が更新されました。このページを再読み込みしてください。";
  }

  /** 生成用ポートを開く。拡張が失効していればnullを返し、生成状態を戻す。 */
  function openStreamPort() {
    const port = bridgeClient?.openStream() || null;
    if (!port) render();
    return port;
  }

  async function cached(key) {
    return bridgeClient?.cacheGet(key) || null;
  }

  async function saveCache(key, result) {
    await bridgeClient?.cacheSet(key, result);
  }

  function providerLabel(provider = state.provider) {
    return provider === "claude" ? "Claude" : "Codex";
  }

  function providerState(provider = state.provider) {
    return state.bridge?.providers?.[provider]
      || (provider === "codex" ? { installed: !!state.bridge?.installed, loggedIn: !!state.bridge?.loggedIn } : { installed: false, loggedIn: false });
  }

  function providerReady() {
    return !!providerState().loggedIn;
  }

  function sceneCacheKey(sceneKey) {
    return `scene:${state.provider}:${sceneKey}:v14`;
  }

  function chatCacheKey(sceneKey) {
    return `chat:${state.provider}:${sceneKey}:v3`;
  }

  async function saveRecords(records, { quiet = false } = {}) {
    if (!records.length) return;
    if (!quiet) { state.recordState = "saving"; state.recordError = null; renderRecordState(); }
    try {
      const response = await bridgeClient?.saveRecords(records);
      if (state.contextLost) return;
      if (!response?.ok) throw new Error(response?.error || "SQLiteへ保存できませんでした");
      state.recordState = "saved";
    } catch (error) {
      state.recordState = "error"; state.recordError = error.message;
    }
    renderRecordState();
  }

  function recordFor(kyoku, entry, explanation = null, chat) {
    const scene = payloadFor(kyoku, entry);
    const providerExplanation = explanation ? { ...explanation, provider: state.provider } : null;
    return { scene, explanation: providerExplanation, ...(Array.isArray(chat) ? { chat } : {}) };
  }

  function kyokuFor(position) {
    const index = roundIndex(position?.round);
    return state.report?.review?.kyokus?.find(k => k.kyoku === index && k.honba === position?.honba) || null;
  }

  /** 一度DBへ保存した半荘だけ、新しい解説・質問をその局面ぶんだけ静かに上書きする。 */
  async function persistCurrent() {
    if (state.recordState !== "saved" || !state.entry || !state.currentKey) return;
    const kyoku = kyokuFor(state.position);
    if (!kyoku) return;
    const key = state.currentKey;
    await saveRecords([recordFor(kyoku, state.entry, state.batchMap[key] || null, state.chatByScene[key])], { quiet: true });
  }

  async function persistAllScenes({ quiet = false } = {}) {
    const records = [];
    for (const kyoku of state.report.review?.kyokus || []) {
      for (const entry of kyoku.entries || []) {
        const key = sceneIdFor(kyoku, entry);
        records.push(recordFor(kyoku, entry, state.batchMap[key] || null, state.chatByScene[key]));
      }
    }
    for (let offset = 0; offset < records.length; offset += 80) {
      await saveRecords(records.slice(offset, offset + 80), { quiet });
      if (state.recordState === "error") return;
    }
  }

  function renderRecordState() {
    const status = document.querySelector("#mcl-record-status");
    if (!status) return;
    const labels = { unsaved: "DBに保存", saving: "DB保存中…", saved: "DB保存済み", error: "DB保存を再試行" };
    status.textContent = labels[state.recordState] || labels.unsaved;
    status.className = `mcl-record-status ${state.recordState}`;
    status.disabled = state.recordState === "saving" || state.recordState === "saved";
    status.title = state.recordError || state.bridge?.database?.path || "この半荘をSQLiteへ保存します";
  }

  async function enableDatabaseSave() {
    if (!state.reportId || state.recordState === "saving" || state.recordState === "saved") return;
    state.recordState = "saving";
    state.recordError = null;
    renderRecordState();
    await persistAllScenes();
  }

  function coachingInline(value) {
    return html(mahjongText(value)).replace(/\*\*([^*]{1,120})\*\*/g, "<strong>$1</strong>");
  }

  function formatCoachingReason(value) {
    const sections = [];
    let current = null;
    for (const rawLine of String(value || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        current = { title: heading[1].replace(/\*\*/g, ""), bullets: [] };
        sections.push(current);
        continue;
      }
      if (!current) {
        current = { title: "解説", bullets: [] };
        sections.push(current);
      }
      current.bullets.push(line.replace(/^[-・]\s*/, ""));
    }
    return sections.map(section => `<section class="mcl-reason-section"><h4>${html(mahjongText(section.title))}</h4><ul>${section.bullets.map(item => `<li>${coachingInline(item)}</li>`).join("")}</ul></section>`).join("");
  }

  function tileLabel(value) {
    const raw = String(value || "").trim().replace(/^5([mps])r$/, "5$1");
    return raw ? mahjongText(raw) : "—";
  }

  function actionLabel(action) {
    if (!action || typeof action !== "object") return "—";
    const tile = action.pai ? tileLabel(action.pai) : "";
    if (action.type === "dahai") return tile || "—";
    const actions = {
      none: "見送り", reach: "リーチ", chi: "チー", pon: "ポン", kan: "カン",
      ankan: "暗槓", kakan: "加槓", daiminkan: "大明槓", hora: "和了", ryukyoku: "流局"
    };
    const label = actions[action.type] || String(action.type || "").slice(0, 12);
    return tile && tile !== "—" ? `${label} ${tile}` : label || "—";
  }

  function verdictPresentation(value) {
    const presentations = {
      match: { icon: "✅", label: "一致", className: "match" },
      equivalent: { icon: "✅", label: "実質同等", className: "equivalent" },
      uncertain: { icon: "🔎", label: "優劣を断定しない", className: "uncertain" },
      minor: { icon: "🟡", label: "軽微な差", className: "minor" },
      clear: { icon: "⚠️", label: "明確な差", className: "clear" },
      major: { icon: "🚨", label: "重大な差", className: "major" }
    };
    return presentations[value] || presentations.equivalent;
  }

  function metricLabel(value) {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
  }

  function qDeltaLabel(result, entry) {
    const localLoss = entryFacts(entry)?.loss;
    const schemaLoss = result?.banner?.qDelta;
    const loss = typeof localLoss === "number" && Number.isFinite(localLoss)
      ? localLoss
      : typeof schemaLoss === "number" && Number.isFinite(schemaLoss) ? Math.abs(schemaLoss) : null;
    if (loss === null) return "";
    const actualDelta = loss === 0 ? 0 : -Math.abs(loss);
    return `(${actualDelta.toFixed(3)})`;
  }

  function comparisonRows(result, entry) {
    const rows = Array.isArray(result?.comparison) ? result.comparison.slice(0, 3) : [];
    if (rows.length) return rows;
    const actualTile = entry?.actual?.pai;
    const expectedTile = entry?.expected?.pai;
    const fallback = [];
    if (expectedTile) fallback.push({ tile: expectedTile, route: null, isMortalTop: true, isActual: expectedTile === actualTile, shanten: null, ukeire: null, qDelta: null, probability: null, value: null, danger: null });
    if (actualTile && actualTile !== expectedTile) fallback.push({ tile: actualTile, route: null, isMortalTop: false, isActual: true, shanten: null, ukeire: null, qDelta: null, probability: null, value: null, danger: null });
    return fallback;
  }

  function analysisResultHtml(result, entry) {
    const banner = result?.banner || {};
    const verdict = verdictPresentation(banner.verdict);
    const actual = actionLabel(entry?.actual) !== "—"
      ? actionLabel(entry.actual)
      : tileLabel(result?.comparison?.find(item => item?.isActual)?.tile);
    const expected = actionLabel(entry?.expected) !== "—"
      ? actionLabel(entry.expected)
      : tileLabel(result?.comparison?.find(item => item?.isMortalTop)?.tile);
    const qDelta = qDeltaLabel(result, entry);
    const oneLine = mahjongText(banner.oneLine || result?.oneLine || result?.lesson || "この局面の判断理由を詳細解説で確認してください。");
    const rows = comparisonRows(result, entry).map(item => {
      const markers = `${item?.isMortalTop ? '<span class="mcl-candidate-marker top" title="Mortal推奨">★</span>' : ""}${item?.isActual ? '<span class="mcl-candidate-marker actual" title="実打">●</span>' : ""}`;
      const deterministicDanger = item?.isMortalTop ? result?.pushFold?.tileDanger?.expected?.label
        : item?.isActual ? result?.pushFold?.tileDanger?.actual?.label : null;
      const danger = deterministicDanger && deterministicDanger !== "—" ? deterministicDanger : item?.danger;
      const qDelta = Number.isFinite(item?.qDelta) ? `-${Math.abs(item.qDelta).toFixed(3)}` : "—";
      return `<tr${item?.isMortalTop ? ' class="mcl-top-candidate"' : ""}><td>${html(item?.route || "—")}</td><th scope="row">${html(tileLabel(item?.tile))}${markers}</th><td>${html(metricLabel(item?.shanten))}</td><td>${html(metricLabel(item?.ukeire))}</td><td>${html(qDelta)}</td><td>${html(danger || "—")}</td></tr>`;
    }).join("");
    const reason = result?.reason || result?.summary || "### 詳細解説\n- 理由を生成できませんでした。";
    const pushFold = result?.pushFold;
    const pushFoldHtml = pushFold ? `<section class="mcl-push-fold ${html(pushFold.code || "neutral")}">
      <div class="mcl-push-fold-head"><h3>押し引き判定</h3><strong>${html(pushFold.label || "比較保留")}</strong></div>
      <div class="mcl-push-fold-bars"><span>攻撃材料 <b>${html(metricLabel(pushFold.attackScore))}</b></span><span>守備材料 <b>${html(metricLabel(pushFold.defenceScore))}</b></span></div>
      <ul>${(pushFold.evidence || []).slice(0, 4).map(item => `<li>${html(item?.text || "")}</li>`).join("")}</ul>
      <small>${html(pushFold.note || "")}</small>
    </section>` : "";
    const tactics = result?.tacticsGuidance;
    const tacticsHtml = tactics?.matched?.length ? `<details class="mcl-tactics-guidance"><summary>この局面の学習ポイント</summary>
      <ul>${tactics.matched.slice(0, 4).map(item => `<li><strong>${html(item?.conclusion || "")}</strong><span>${html(item?.reason || "")}</span></li>`).join("")}</ul>
      <small>${html(`${tactics.sourceCount || 15}記事から局面に一致した定石のみ表示。Mortal評価と計算済み局面値を優先します。`)}</small>
    </details>` : "";
    const simulation = result?.scoreSimulation;
    const scenarioRow = (label, item) => `<tr><th>${html(label)}</th><td>${html(`${item.handPoints}点${item.honbaBonus ? `＋本場${item.honbaBonus}点` : ""}${item.kyotakuBonus ? `＋供託${item.kyotakuBonus}点` : ""}`)}</td><td class="${item.selfDelta >= 0 ? "plus" : "minus"}">${html(`${item.selfDelta >= 0 ? "+" : ""}${item.selfDelta} → ${item.afterScore}`)}</td><td>${html(item.afterRank ? `${item.afterRank}着` : "—")}</td></tr>`;
    const actualDelta = Number.isFinite(simulation?.actual?.selfDelta) ? `${simulation.actual.selfDelta >= 0 ? "+" : ""}${simulation.actual.selfDelta}点` : "点棒未確定";
    const actualClass = Number.isFinite(simulation?.actual?.selfDelta) ? (simulation.actual.selfDelta >= 0 ? "plus" : "minus") : "";
    const actualRow = simulation?.actual ? `<div class="mcl-actual-outcome"><span>実際の局結果</span><strong>${html(simulation.actual.label)}</strong><b class="${actualClass}">${html(actualDelta)}</b><small>${html(simulation.actual.afterRank ? `${simulation.actual.afterRank}着` : "")}</small></div>` : "";
    const scoreSimulationHtml = simulation ? `<details class="mcl-score-simulation"><summary>点棒・着順シミュレーション</summary>
      ${actualRow}
      <p>仮定する相手：${html(simulation.assumedOpponent?.relation || "他家")}（${html(simulation.assumedOpponent?.basis || "代表シナリオ")}）</p>
      <div class="mcl-table-wrap"><table><thead><tr><th>条件</th><th>打点</th><th>自分の点棒</th><th>順位</th></tr></thead><tbody>
        ${(simulation.selfRon || []).map((item, index) => scenarioRow(index === 0 ? "自分がロン" : "", item)).join("")}
        ${(simulation.dealIn || []).map((item, index) => scenarioRow(index === 0 ? "自分が放銃" : "", item)).join("")}
      </tbody></table></div><small>${html(simulation.note || "")}</small></details>` : "";
    return `<article class="mcl-answer-card mcl-analysis-card">
      <div class="mcl-verdict-banner ${verdict.className}">
        <div class="mcl-decision-row"><span>実打</span><strong>${html(actual)}</strong><b class="mcl-verdict"><i aria-hidden="true">${verdict.icon}</i>${html(verdict.label)}${qDelta ? `<small>${html(qDelta)}</small>` : ""}</b></div>
        <div class="mcl-decision-row"><span>推奨</span><strong>${html(expected)}</strong></div>
      </div>
      ${pushFoldHtml}
      ${tacticsHtml}
      ${scoreSimulationHtml}
      <section class="mcl-one-line"><h3><span aria-hidden="true">💡</span>一言</h3><p>${html(oneLine)}</p></section>
      <section class="mcl-comparison"><h3><span aria-hidden="true">📊</span>候補比較</h3>
        <div class="mcl-table-wrap"><table><thead><tr><th>方針</th><th>打牌</th><th>向聴</th><th>受入</th><th>Q差</th><th>危険</th></tr></thead><tbody>${rows || '<tr><td colspan="6">候補データなし</td></tr>'}</tbody></table></div>
        <p class="mcl-marker-guide"><span class="mcl-candidate-marker top">★</span>Mortal推奨 <span class="mcl-candidate-marker actual">●</span>実打</p>
      </section>
      <details class="mcl-analysis-details" open><summary>詳細解説</summary><div class="mcl-reason-sections">${formatCoachingReason(reason)}</div></details>
      <section class="mcl-intent-review"><h3>あなたはなぜ実打を選びましたか？</h3><p>理由を入力すると、正しい部分と修正点を盤面の事実・数字で検証します。</p><button id="mcl-intent-review-start" type="button">打牌理由を入力</button></section>
    </article>`;
  }

  function renderResult() {
    const box = document.querySelector("#mcl-answer");
    if (!box) return;
    if (state.generating && (state.generatingKind === "summary" || !state.result)) {
      const title = state.generatingKind === "summary" ? "半荘全体を分析中…" : "この局面を解析中…";
      box.innerHTML = `<div class="mcl-loading"><i></i><strong>${title}</strong><span id="mcl-progress">安全な読み取り専用モードで実行しています</span></div>`;
      return;
    }
    if (state.showingSummary && state.summaryResult) {
      const r = state.summaryResult;
      const trends = (r.mistakeTrends || []).map(item => `<li>${html(mahjongText(item))}</li>`).join("");
      const improvements = (r.improvements || []).map(item => `<li>${html(mahjongText(item))}</li>`).join("");
      box.innerHTML = `<article class="mcl-summary-card"><div class="mcl-grade"><span>総合評価</span><strong>${html(r.grade || "-")}</strong><b>${Number.isFinite(r.score) ? `${r.score}点` : "採点なし"}</b></div>
        <h4>ミスの傾向</h4><ul>${trends}</ul>
        <h4>今後の改善点</h4><ol>${improvements}</ol></article>`;
      return;
    }
    if (!state.result) {
      const message = state.batchError
        ? `解析に失敗しました：${html(state.batchError)}`
        : state.entry
          ? "「この局面を解析」を押すと、現在の選択だけを解説します。"
          : "Mortal評価がある選択局面へ移動してください。";
      box.innerHTML = `<div class="mcl-empty">${message}</div>`;
      return;
    }
    box.innerHTML = analysisResultHtml(state.result, state.entry);
    box.querySelector("#mcl-intent-review-start")?.addEventListener("click", () => {
      const input = document.querySelector("#mcl-question");
      if (!input) return;
      input.value = "この打牌を選んだ理由：";
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function renderStatus() {
    const status = document.querySelector("#mcl-bridge-status");
    if (!status) return;
    if (state.contextLost) {
      status.className = "mcl-status error";
      status.textContent = "ページを再読み込み";
      status.title = "拡張機能が更新されました。このページを再読み込みしてください。";
      status.disabled = false;
    } else if (!state.bridge?.ok) {
      status.className = "mcl-status error";
      status.textContent = "AIに接続";
      status.disabled = false;
    } else if (!providerState().installed) {
      status.className = "mcl-status warn";
      status.textContent = `${providerLabel()}未導入`;
      status.disabled = false;
    } else if (!providerReady()) {
      status.className = "mcl-status warn";
      status.textContent = `${providerLabel()}未ログイン`;
      status.disabled = false;
    } else {
      status.className = "mcl-status ok";
      status.textContent = `${providerLabel()}接続済み`;
      status.disabled = true;
    }
    const selector = document.querySelector("#mcl-provider");
    if (selector) {
      selector.value = state.provider;
      selector.disabled = state.generating || state.questionGenerating;
      const claudeOption = selector.querySelector('option[value="claude"]');
      if (claudeOption) {
        claudeOption.disabled = !!state.bridge?.ok && !providerState("claude").installed;
        claudeOption.textContent = providerState("claude").installed ? "Claude" : "Claude（未導入）";
      }
    }
  }

  function renderGenerateState() {
    const button = document.querySelector("#mcl-batch");
    if (button) {
      button.disabled = state.generating || !providerReady() || !state.entry;
      button.textContent = state.generatingKind === "single" ? "この局面を解析中…" : state.result ? "この局面を再解析" : "この局面を解析";
    }
    const summary = document.querySelector("#mcl-summary");
    if (summary) summary.disabled = state.generating || !providerReady() || !(state.report?.review?.kyokus?.length);
    const question = document.querySelector("#mcl-question-submit");
    if (question) {
      question.disabled = !state.entry || state.showingSummary || state.questionGenerating || !providerReady();
      question.textContent = state.questionGenerating ? "回答中…" : "質問する";
    }
    const questionInput = document.querySelector("#mcl-question");
    if (questionInput) questionInput.disabled = !state.entry || state.showingSummary || state.questionGenerating;
  }

  function render() {
    const current = document.querySelector("#mcl-current");
    if (current) current.textContent = positionLabel(state.position);
    renderGenerateState();
    renderResult(); renderChat(); renderStatus(); renderRecordState();
  }

  async function health() {
    const result = await bridgeClient?.health();
    if (state.contextLost) return;
    state.bridge = result;
    renderStatus(); renderGenerateState();
  }

  async function connect() {
    if (state.contextLost) { location.reload(); return; }
    const status = document.querySelector("#mcl-bridge-status");
    if (status) { status.disabled = true; status.textContent = "接続確認中…"; }
    await health();
    if (!providerReady()) {
      const details = document.querySelector("#mcl-connect-help");
      if (details) details.open = true;
    }
  }

  async function generateCurrent({ force = false } = {}) {
    if (state.generating || !providerReady() || !state.entry || !state.currentKey) return;
    const sceneKey = state.currentKey;
    const cacheKey = sceneCacheKey(sceneKey);
    if (!force) {
      const existing = await cached(cacheKey);
      if (existing) {
        state.batchMap[sceneKey] = existing;
        if (state.currentKey === sceneKey) state.result = existing;
        state.batchError = null; render(); return;
      }
    }
    state.generating = true; state.generatingKind = "single"; state.batchError = null;
    if (state.currentKey === sceneKey) state.result = null;
    render();
    const scene = payload();
    const port = openStreamPort();
    if (!port) return;
    state.activePort = port;
    port.onMessage.addListener(async event => {
      if (event.type === "status") {
        const progress = document.querySelector("#mcl-progress");
        if (progress) progress.textContent = event.message;
      } else if (event.type === "result") {
        await saveCache(cacheKey, event.result);
        state.batchMap[sceneKey] = event.result;
        if (state.currentKey === sceneKey) state.result = event.result;
        state.generating = false; state.generatingKind = null; state.activePort = null; state.batchError = null;
        render(); persistCurrent(); port.disconnect();
      } else if (event.type === "error") {
        state.generating = false; state.generatingKind = null; state.activePort = null;
        state.batchError = event.message; render(); port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.activePort === port) {
        state.activePort = null; state.generating = false; state.generatingKind = null; render();
      }
    });
    port.postMessage({ type: "analyze", provider: state.provider, payload: scene });
  }

  async function generateSummary({ force = false } = {}) {
    if (state.generating || !providerReady()) return;
      const key = `summary:${state.provider}:${state.reportId}:v6`;
    state.showingSummary = true;
    if (!force) {
      const existing = await cached(key);
      if (existing) { state.summaryResult = existing; render(); return; }
    }
    state.generating = true; state.generatingKind = "summary"; state.summaryResult = null; render();
    const port = openStreamPort();
    if (!port) return;
    state.activePort = port;
    port.onMessage.addListener(async event => {
      if (event.type === "status") {
        const progress = document.querySelector("#mcl-progress");
        if (progress) progress.textContent = event.message;
      } else if (event.type === "result") {
        await saveCache(key, event.result);
        state.summaryResult = event.result; state.generating = false; state.generatingKind = null; state.activePort = null;
        render(); port.disconnect();
      } else if (event.type === "error") {
        state.generating = false; state.generatingKind = null; state.activePort = null;
        state.summaryResult = { grade: "-", score: null, mistakeTrends: [`生成エラー：${event.message}`], improvements: ["接続状態とCodexログインを確認してください。"] };
        render(); port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.activePort === port) {
        state.activePort = null; state.generating = false; state.generatingKind = null; render();
      }
    });
    port.postMessage({ type: "summary", provider: state.provider, payload: summaryPayload() });
  }

  function renderChat() {
    const log = document.querySelector("#mcl-chat-log");
    const section = document.querySelector("#mcl-chat");
    if (!log || !section) return;
    section.hidden = state.showingSummary;
    if (section.hidden) return;
    if (!state.currentKey || !state.entry) {
      log.innerHTML = `<div class="mcl-chat-empty">Mortal評価がある局面へ移動すると追加質問できます。</div>`;
      return;
    }
    const messages = state.chatByScene[state.currentKey] || [];
    log.innerHTML = messages.length ? messages.map(item =>
      `<div class="mcl-chat-message ${item.role}"><b>${item.role === "user" ? "質問" : "回答"}</b><p>${html(mahjongText(item.content))}</p></div>`
    ).join("") : `<div class="mcl-chat-empty">この局面の解説について、さらに質問できます。</div>`;
    if (state.questionGenerating && state.questionKey === state.currentKey) log.insertAdjacentHTML("beforeend", `<div class="mcl-chat-wait">回答を考えています…</div>`);
  }

  function questionAnswerText(answer) {
    if (typeof answer === "string") return answer;
    if (!Array.isArray(answer)) return "回答を生成できませんでした。";
    return answer.slice(0, 3).map(item => {
      const category = String(item?.category || "判断").slice(0, 8);
      const text = String(item?.text || "").trim();
      const evidence = String(item?.evidence || "").trim();
      return `・[${category}] ${text}${evidence ? `\n  └ 根拠: ${evidence}` : ""}`;
    }).filter(line => line.trim()).join("\n");
  }

  async function askQuestion() {
    const input = document.querySelector("#mcl-question");
    const question = input?.value.trim();
    if (!question || !state.entry || !state.currentKey || state.questionGenerating || !providerReady()) return;
    const key = state.currentKey;
    const existing = state.chatByScene[key] || [];
    const prior = existing.slice(-6);
    const scene = payload();
    const explanation = { reason: state.result?.reason || "", lesson: state.result?.lesson || "" };
    state.chatByScene[key] = [...existing, { role: "user", content: question }];
    input.value = ""; state.questionGenerating = true; state.questionKey = key; render();
    await saveCache(chatCacheKey(key), state.chatByScene[key]);
    const port = openStreamPort();
    if (!port) return;
    state.questionPort = port;
    port.onMessage.addListener(async event => {
      if (event.type === "result") {
        state.chatByScene[key] = [...(state.chatByScene[key] || []), { role: "assistant", content: questionAnswerText(event.result.answer) }];
        await saveCache(chatCacheKey(key), state.chatByScene[key]);
        state.questionGenerating = false; state.questionKey = null; state.questionPort = null; render(); persistCurrent(); port.disconnect();
      } else if (event.type === "error") {
        state.chatByScene[key] = [...(state.chatByScene[key] || []), { role: "assistant", content: `回答エラー：${event.message}` }];
        await saveCache(chatCacheKey(key), state.chatByScene[key]);
        state.questionGenerating = false; state.questionKey = null; state.questionPort = null; render(); persistCurrent(); port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.questionPort === port) { state.questionPort = null; state.questionGenerating = false; state.questionKey = null; render(); }
    });
    port.postMessage({ type: "question", provider: state.provider, payload: {
      scene, explanation, history: prior, question
    }});
  }

  async function changeProvider(value) {
    const provider = value === "claude" ? "claude" : "codex";
    if (provider === state.provider || state.generating || state.questionGenerating) return;
    state.provider = provider;
    state.batchMap = {};
    state.chatByScene = {};
    state.result = null;
    state.summaryResult = null;
    state.showingSummary = false;
    state.batchError = null;
    await saveCache("provider", provider);
    if (state.currentKey) {
      const [chat, explanation] = await Promise.all([cached(chatCacheKey(state.currentKey)), cached(sceneCacheKey(state.currentKey))]);
      if (Array.isArray(chat)) state.chatByScene[state.currentKey] = chat;
      if (explanation) state.batchMap[state.currentKey] = explanation;
      state.result = explanation || null;
    }
    render();
  }

  function build() {
    document.documentElement.classList.add("mcl-side-panel");
    const root = document.createElement("aside"); root.id = ROOT_ID;
    root.innerHTML = `<header><div><span>MORTAL AI COACH</span><h2>リアルタイム解説</h2></div><button id="mcl-collapse" aria-label="折りたたむ">−</button></header>
      <section class="mcl-top"><div id="mcl-current">局面を取得中</div><div class="mcl-statuses"><button id="mcl-bridge-status" class="mcl-status">確認中</button><button id="mcl-record-status" class="mcl-record-status unsaved">DBに保存</button></div></section>
      <div class="mcl-provider-row"><label for="mcl-provider">AIモデル</label><select id="mcl-provider"><option value="codex">Codex</option><option value="claude">Claude</option></select></div>
      <div class="mcl-controls"><button id="mcl-batch">この局面を解析</button><button id="mcl-summary">半荘総評</button></div>
      <section id="mcl-answer"></section>
      <section id="mcl-chat"><div id="mcl-chat-log"></div><form id="mcl-chat-form"><textarea id="mcl-question" rows="2" maxlength="1000" placeholder="この解説について質問"></textarea><button id="mcl-question-submit" type="submit">質問する</button></form></section>
      <nav><button data-mortal="#prev-mismatch">← 前のミス</button><button data-mortal="#next-mismatch">次のミス →</button><button class="mcl-choice" data-mortal="#ply-dec2">← 前の選択</button><button class="mcl-choice" data-mortal="#ply-inc2">次の選択 →</button></nav>
      <details id="mcl-connect-help"><summary>接続方法</summary><p>初回または更新時に「install-companion.command」を実行します。Codexは <code>codex login</code>、ClaudeはClaude Codeを導入後 <code>claude auth login</code> でログインしてください。</p></details>`;
    document.documentElement.appendChild(root);
    root.querySelector("#mcl-collapse").addEventListener("click", event => {
      root.classList.toggle("collapsed");
      document.documentElement.classList.toggle("mcl-side-collapsed", root.classList.contains("collapsed"));
      event.target.textContent = root.classList.contains("collapsed") ? "+" : "−";
    });
    root.querySelector("#mcl-batch").addEventListener("click", () => generateCurrent({ force: !!state.result }));
    root.querySelector("#mcl-bridge-status").addEventListener("click", connect);
    root.querySelector("#mcl-summary").addEventListener("click", () => generateSummary());
    root.querySelector("#mcl-record-status").addEventListener("click", enableDatabaseSave);
    root.querySelector("#mcl-provider").addEventListener("change", event => changeProvider(event.target.value));
    root.querySelector("#mcl-chat-form").addEventListener("submit", event => { event.preventDefault(); askQuestion(); });
    root.querySelectorAll("[data-mortal]").forEach(button => button.addEventListener("click", () => document.querySelector(button.dataset.mortal)?.click()));
    root.addEventListener("wheel", event => event.stopPropagation(), { capture: true, passive: true });
    root.addEventListener("touchmove", event => event.stopPropagation(), { capture: true, passive: true });
  }

  async function positionChanged() {
    const nextPosition = readPosition();
    const nextEntry = locateEntry(nextPosition);
    if (nextEntry) nextPosition.junme = nextEntry.junme;
    const key = nextEntry ? entryKey(nextPosition, nextEntry) : null;
    const signature = key || [nextPosition?.round, nextPosition?.honba, nextPosition?.junme, nextPosition?.tilesLeft].join(":");
    if (signature === state.currentSignature) return;
    if (state.activePort) { state.activePort.disconnect(); state.activePort = null; state.generating = false; state.generatingKind = null; }
    state.showingSummary = false;
    state.batchError = null;
    state.position = nextPosition; state.entry = nextEntry; state.result = key ? state.batchMap[key] || null : null; state.currentKey = key; state.currentSignature = signature;
    render();
    if (key) {
      const [existing, explanation] = await Promise.all([cached(chatCacheKey(key)), cached(sceneCacheKey(key))]);
      if (state.currentKey !== key) return;
      if (Array.isArray(existing)) state.chatByScene[key] = existing;
      if (explanation) state.batchMap[key] = explanation;
      state.result = state.batchMap[key] || null; render();
    }
  }

  function observe() {
    const target = document.querySelector("main") || document.body;
    new MutationObserver(() => {
      if (state.contextLost) return;
      clearTimeout(state.positionTimer);
      state.positionTimer = setTimeout(positionChanged, 180);
    }).observe(target, { subtree: true, childList: true, characterData: true });
  }

  async function start() {
    build(); render();
    try {
      const url = dataUrl();
      const savedProvider = await cached("provider");
      state.provider = savedProvider === "claude" ? "claude" : "codex";
      state.recordState = "unsaved";
      state.report = await (await fetch(url)).json();
    }
    catch (error) {
      document.querySelector("#mcl-answer").innerHTML = `<div class="mcl-empty">元JSONを読めません：${html(error.message)}</div>`;
      return;
    }
    buildTableContexts();
    await health(); await positionChanged();
    observe();
    state.healthTimer = setInterval(health, 15000);
  }

  if (globalThis.__MCL_TEST__) {
    globalThis.__MCL_TEST_API__ = {
      buildTableContexts(report, reportId = "test") {
        state.report = report; state.reportId = reportId; buildTableContexts();
        return state.tableByScene;
      },
      scenePayload(report, kyokuIndex = 0, entryIndex = 0, reportId = "test") {
        state.report = report; state.reportId = reportId; buildTableContexts();
        const kyoku = report.review.kyokus[kyokuIndex];
        return payloadFor(kyoku, kyoku.entries[entryIndex]);
      },
      formatCoachingReason,
      analysisResultHtml,
      parseRoundDisplay,
      scoresByPlayer,
      questionAnswerText
    };
    return;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
