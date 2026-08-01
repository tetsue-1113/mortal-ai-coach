import { computeSafety, computeSceneVisibleCounts, computeStandings, decisionAxes, turnPhase, verifiedPerspective, verifiedTileCounts } from "../scene-facts.mjs";
import { shantenOf, toCounts, ukeireAfterDiscard } from "../shanten.mjs";
import { computePushFold } from "../push-fold.mjs";
import { buildScoreSimulation } from "../score-simulator.mjs";
import { buildTacticsGuidance } from "../tactics-knowledge.mjs";
import { assessDecision } from "../decision-assessment.mjs";
import { buildDecisionRoutes } from "../decision-routes.mjs";

const TILE = /^(?:[1-9][mps]r?|[ESWNPFC])$/;
const ACTIONS = new Set(["dahai", "none", "reach", "chi", "pon", "kan", "ankan", "kakan", "daiminkan", "hora", "ryukyoku"]);
const CALLS = new Set(["chi", "pon", "ankan", "kakan", "daiminkan", "kan"]);
const MAX_UKEIRE_TILES = 10;

export function tile(value) { return typeof value === "string" && TILE.test(value) ? value : null; }
export function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
export function limitedText(value, maximum = 1200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
export function sceneId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,180}$/.test(value)) throw new Error("Invalid scene ID");
  return value;
}

function action(value) {
  if (!value || !ACTIONS.has(value.type)) return null;
  const result = { type: value.type };
  if (tile(value.pai)) result.pai = value.pai;
  if (Array.isArray(value.consumed)) result.consumed = value.consumed.map(tile).filter(Boolean).slice(0, 4);
  return result;
}

function tableState(value) {
  if (!value || typeof value !== "object") return { doraIndicators: [], kyotakuSticks: null, players: [] };
  const players = Array.isArray(value.players) ? value.players.slice(0, 4).map(player => ({
    playerId: finiteNumber(player?.playerId),
    relation: ["self", "shimocha", "toimen", "kamicha"].includes(player?.relation) ? player.relation : null,
    seatWind: tile(player?.seatWind), score: finiteNumber(player?.score), riichiAccepted: !!player?.riichiAccepted,
    discards: Array.isArray(player?.discards) ? player.discards.slice(0, 30).map(discard => ({
      tile: tile(discard?.tile), tsumogiri: !!discard?.tsumogiri,
      riichiDeclaration: !!discard?.riichiDeclaration, called: !!discard?.called
    })).filter(discard => discard.tile) : [],
    calls: Array.isArray(player?.calls) ? player.calls.slice(0, 8).map(call => ({
      type: CALLS.has(call?.type) ? call.type : null, pai: tile(call?.pai),
      consumed: Array.isArray(call?.consumed) ? call.consumed.map(tile).filter(Boolean).slice(0, 4) : [],
      fromPlayer: finiteNumber(call?.fromPlayer), atDiscardCount: finiteNumber(call?.atDiscardCount)
    })).filter(call => call.type) : []
  })).filter(player => player.playerId !== null) : [];
  const activeRiichiSticks = players.filter(player => player.riichiAccepted).length;
  const reportedKyotaku = finiteNumber(value.kyotakuSticks);
  return {
    doraIndicators: Array.isArray(value.doraIndicators) ? value.doraIndicators.map(tile).filter(Boolean).slice(0, 5) : [],
    kyotakuSticks: reportedKyotaku === null
      ? (activeRiichiSticks || null)
      : Math.max(reportedKyotaku, activeRiichiSticks),
    players,
    _scoresIncludeRiichiDeposits: value.scoresIncludeRiichiDeposits === true
      || Object.prototype.hasOwnProperty.call(value, "kyotakuSticks")
  };
}

function roundOutcome(value) {
  if (!value || typeof value !== "object") return { events: [], scoresAfter: null };
  const events = Array.isArray(value.events) ? value.events.slice(0, 4).map(event => ({
    type: ["hora", "ryukyoku", "none"].includes(event?.type) ? event.type : "none",
    actor: finiteNumber(event?.actor), target: finiteNumber(event?.target),
    deltas: Array.isArray(event?.deltas) && event.deltas.length === 4 ? event.deltas.map(finiteNumber) : null
  })).filter(event => event.deltas?.every(item => item !== null)) : [];
  const scoresAfter = Array.isArray(value.scoresAfter) && value.scoresAfter.length === 4
    ? value.scoresAfter.map(finiteNumber) : null;
  return { events, scoresAfter: scoresAfter?.every(item => item !== null) ? scoresAfter : null };
}

function candidateUkeire(scene) {
  const dahaiTile = current => (current?.type === "dahai" && current.pai ? current.pai : null);
  const order = [dahaiTile(scene.expected), dahaiTile(scene.actual),
    ...scene.alternatives.map(alternative => dahaiTile(alternative.action))];
  const tiles = [...new Set(order.filter(Boolean))].slice(0, 6);
  if (!tiles.length) return null;
  const entries = [];
  for (const candidate of tiles) {
    const result = ukeireAfterDiscard(scene.hand, candidate, scene.calls.length, scene.table.visibleCounts);
    if (!result) continue;
    entries.push({
      tile: candidate, isActual: candidate === dahaiTile(scene.actual), isMortalTop: candidate === dahaiTile(scene.expected),
      shantenAfter: result.shanten, ukeire: result.count,
      ukeireTiles: result.tiles.slice(0, MAX_UKEIRE_TILES).map(item => `${item.tile}×${item.remaining}`)
    });
  }
  if (!entries.length) return null;
  const bestShanten = Math.min(...entries.map(entry => entry.shantenAfter));
  for (const entry of entries) entry.keepsShanten = entry.shantenAfter === bestShanten;
  return { bestShanten, candidates: entries };
}

export function createSceneService(prompts) {
  function normalize(input) {
    if (!input || typeof input !== "object") throw new Error("Invalid payload");
    const p = input.position || {}, m = input.metrics || {}, f = input.flags || {}, c = input.context || {};
    const normalized = {
      sceneId: typeof input.sceneId === "string" ? input.sceneId.slice(0, 180) : "",
      reportId: typeof input.reportId === "string" ? input.reportId.slice(0, 100) : "",
      playerId: finiteNumber(input.playerId),
      position: {
        kyoku: finiteNumber(p.kyoku), honba: finiteNumber(p.honba), junme: finiteNumber(p.junme), tilesLeft: finiteNumber(p.tilesLeft),
        gameLength: p.gameLength === "hanchan" ? "hanchan" : null,
        isLastKyoku: typeof p.isLastKyoku === "boolean" ? p.isLastKyoku : null,
        turnPhase: turnPhase(p.junme)
      },
      context: { roundWind: tile(c.roundWind), seatWind: tile(c.seatWind), dealer: !!c.dealer },
      scores: Array.isArray(input.scores) ? input.scores.map(finiteNumber).filter(value => value !== null).slice(0, 4) : [],
      hand: Array.isArray(input.hand) ? input.hand.map(tile).filter(Boolean).slice(0, 14) : [],
      calls: Array.isArray(input.calls) ? input.calls.slice(0, 4).filter(call => CALLS.has(call?.type)).map(call => ({
        type: call.type, pai: tile(call.pai), consumed: Array.isArray(call.consumed) ? call.consumed.map(tile).filter(Boolean).slice(0, 4) : []
      })) : [],
      actual: action(input.actual), expected: action(input.expected),
      sourceShanten: finiteNumber(input.shanten), shanten: null,
      flags: { furiten: !!f.furiten, selfRiichi: !!f.selfRiichi, callDecision: !!f.callDecision },
      metrics: { expectedQ: finiteNumber(m.expectedQ), actualQ: finiteNumber(m.actualQ), loss: finiteNumber(m.loss) },
      table: tableState(input.table), roundOutcome: roundOutcome(input.roundOutcome),
      alternatives: Array.isArray(input.alternatives) ? input.alternatives.slice(0, 8).map(alternative => ({
        action: action(alternative.action), q: finiteNumber(alternative.q), probability: finiteNumber(alternative.probability)
      })).filter(alternative => alternative.action && (alternative.q !== null || alternative.probability !== null)) : []
    };
    if (!normalized.hand.length || !normalized.actual || !normalized.expected) {
      throw new Error(`Required mahjong fields are missing (scene: ${normalized.sceneId || "unknown"}, hand: ${normalized.hand.length}, actual: ${!!normalized.actual}, expected: ${!!normalized.expected})`);
    }
    if (!normalized.table._scoresIncludeRiichiDeposits) {
      const acceptedPlayers = new Set(normalized.table.players.filter(player => player.riichiAccepted).map(player => player.playerId));
      normalized.scores = normalized.scores.map((score, playerId) => acceptedPlayers.has(playerId) ? score - 1000 : score);
    }
    delete normalized.table._scoresIncludeRiichiDeposits;
    // Mortalのreview.shantenは現在のツモを引く前の値。解説では現在手牌を正本にする。
    normalized.shanten = shantenOf(toCounts(normalized.hand), normalized.calls.length);
    normalized.verifiedTileCounts = verifiedTileCounts(normalized.hand, normalized.table.doraIndicators);
    normalized.verifiedPerspective = verifiedPerspective(normalized.playerId, normalized.context.seatWind, normalized.table.players, normalized.scores);
    normalized.standings = computeStandings(normalized.scores, normalized.playerId);
    normalized.table.players = normalized.table.players.map(player => ({ ...player, safety: computeSafety(player.discards.map(discard => discard.tile)) }));
    normalized.table.visibleCounts = computeSceneVisibleCounts(
      normalized.hand, normalized.table.doraIndicators, normalized.table.players
    );
    normalized.ukeire = candidateUkeire(normalized);
    normalized.pushFold = computePushFold(normalized);
    normalized.decisionAssessment = assessDecision(normalized);
    normalized.decisionRoutes = buildDecisionRoutes(normalized);
    normalized.scoreSimulation = buildScoreSimulation(normalized);
    normalized.tacticsGuidance = buildTacticsGuidance(normalized);
    normalized.decisionAxes = decisionAxes(normalized);
    return normalized;
  }

  function normalizeSummary(input) {
    if (!input || !Array.isArray(input.scenes)) throw new Error("Invalid summary payload");
    const scenes = input.scenes.slice(0, 80).map(normalize);
    if (!scenes.length) throw new Error("No mismatch scenes");
    const stats = input.stats || {};
    return { stats: {
      mortalRating: finiteNumber(stats.mortalRating), totalMatches: finiteNumber(stats.totalMatches),
      totalReviewed: finiteNumber(stats.totalReviewed), mismatchCount: finiteNumber(stats.mismatchCount)
    }, scenes };
  }

  function normalizeQuestion(input) {
    if (!input || typeof input !== "object") throw new Error("Invalid question payload");
    const question = limitedText(input.question, 1000);
    if (!question) throw new Error("Question is required");
    const explanation = { reason: limitedText(input.explanation?.reason, 1800), lesson: limitedText(input.explanation?.lesson, 1000) };
    const history = Array.isArray(input.history) ? input.history.slice(-6).map(item => ({
      role: item?.role === "assistant" ? "assistant" : "user", content: limitedText(item?.content, 1000)
    })).filter(item => item.content) : [];
    return { scene: normalize(input.scene), explanation, history, question };
  }

  function analysisPrompt(data) {
    const promptData = { ...data, roundOutcome: undefined, scoreSimulation: data.scoreSimulation ? { ...data.scoreSimulation, actual: null } : null };
    const userPrompt = prompts.sceneUserTemplate.replace("{SCENE_JSON}", JSON.stringify(promptData));
    return `${prompts.sceneSystem}\n\n---\n\n${userPrompt}`;
  }

  return {
    normalize, normalizeSummary, normalizeQuestion,
    analysisPrompt,
    questionPrompt: data => `${prompts.questionSystem}\n\n---\n\n【質問データ】\n${JSON.stringify(data)}`,
    summaryPrompt: data => `${prompts.summarySystem}\n\n---\n\n【局順の不一致局面JSON】\n${JSON.stringify(data)}`
  };
}
