#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSceneService } from "../bridge/application/scene-service.mjs";

export const DEFAULT_QUOTAS = Object.freeze({
  efficiency: 10,
  defense: 10,
  riichi: 8,
  calls: 8,
  placement: 6,
  control: 8
});

export const DEFAULT_SEVERITY_TARGETS = Object.freeze({
  efficiency: Object.freeze({ major: 4, clear: 3, minor: 3, match: 0 }),
  defense: Object.freeze({ major: 4, clear: 2, minor: 2, match: 2 }),
  riichi: Object.freeze({ major: 3, clear: 2, minor: 0, match: 3 }),
  calls: Object.freeze({ major: 3, clear: 2, minor: 1, match: 2 }),
  placement: Object.freeze({ major: 3, clear: 0, minor: 1, match: 2 }),
  control: Object.freeze({ major: 0, clear: 0, minor: 0, match: 8 })
});

const CALL_ACTIONS = new Set(["chi", "pon", "kan", "ankan", "kakan", "daiminkan"]);
const CATEGORY_ORDER = ["riichi", "calls", "placement", "defense", "efficiency", "control"];

function sameAction(left, right) {
  return left?.type === right?.type
    && (left?.pai || null) === (right?.pai || null)
    && JSON.stringify(left?.consumed || []) === JSON.stringify(right?.consumed || []);
}

function hasThreat(scene) {
  return scene.pushFold?.opponents?.some(opponent =>
    opponent.level === "critical" || opponent.level === "high" || opponent.callCount >= 2
  ) || false;
}

export function classifyScene(scene) {
  if (scene.actual?.type === "reach" || scene.expected?.type === "reach") return "riichi";
  if (scene.flags?.callDecision || CALL_ACTIONS.has(scene.actual?.type) || CALL_ACTIONS.has(scene.expected?.type)) return "calls";
  if (scene.position?.isLastKyoku === true) return "placement";
  if (hasThreat(scene) && scene.actual?.type === "dahai" && scene.expected?.type === "dahai") return "defense";
  if (!hasThreat(scene) && !sameAction(scene.actual, scene.expected)
      && scene.actual?.type === "dahai" && scene.expected?.type === "dahai") return "efficiency";
  if (sameAction(scene.actual, scene.expected) || Math.abs(Number(scene.metrics?.loss) || 0) < 0.001) return "control";
  return null;
}

function severity(scene) {
  const loss = Math.abs(Number(scene.metrics?.loss) || 0);
  if (sameAction(scene.actual, scene.expected) || loss < 0.001) return "match";
  if (loss < 0.02) return "minor";
  if (loss < 0.08) return "clear";
  return "major";
}

export function sceneTags(scene) {
  const tags = [severity(scene), `shanten-${scene.shanten}`];
  if (scene.context?.dealer) tags.push("dealer");
  if (scene.position?.isLastKyoku) tags.push("all-last");
  if (hasThreat(scene)) tags.push("threat");
  if (scene.flags?.furiten) tags.push("furiten");
  if (scene.actual?.type !== scene.expected?.type) tags.push("action-type-mismatch");
  if (scene.tacticsGuidance?.matched?.length) {
    tags.push(...scene.tacticsGuidance.matched.map(rule => `rule:${rule.id}`));
  }
  return [...new Set(tags)].sort();
}

function anonymizedInput(source, normalized, caseId) {
  const input = structuredClone(source);
  input.sceneId = caseId;
  input.reportId = "evaluation";
  input.sourceShanten = normalized.sourceShanten;
  input.shanten = normalized.shanten;
  input.scores = structuredClone(normalized.scores);
  input.table ||= {};
  input.table.kyotakuSticks = normalized.table?.kyotakuSticks ?? null;
  delete input.roundOutcome;
  return input;
}

function baselineExplanation(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const reason = typeof parsed?.reason === "string" ? parsed.reason : "";
    const lesson = typeof parsed?.lesson === "string" ? parsed.lesson : "";
    return reason || lesson ? { reason, lesson } : null;
  } catch {
    return null;
  }
}

function stableRank(seed, sceneId) {
  return createHash("sha256").update(`${seed}\0${sceneId}`).digest("hex");
}

export function selectRows(
  rows,
  quotas = DEFAULT_QUOTAS,
  seed = "mortal-ai-coach-eval-v1",
  severityTargets = DEFAULT_SEVERITY_TARGETS
) {
  const buckets = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]));
  for (const row of rows) {
    const category = classifyScene(row.scene);
    if (!category) continue;
    buckets[category].push({ ...row, category, rank: stableRank(seed, row.originalSceneId) });
  }

  const selected = [];
  for (const category of CATEGORY_ORDER) {
    const requested = Number(quotas[category]) || 0;
    const candidates = buckets[category].sort((left, right) => {
      const baselineDifference = Number(!!right.baseline) - Number(!!left.baseline);
      return baselineDifference || left.rank.localeCompare(right.rank);
    });
    if (candidates.length < requested) {
      throw new Error(`Not enough ${category} scenes: requested ${requested}, found ${candidates.length}`);
    }
    const targets = severityTargets[category] || {};
    const targetTotal = Object.values(targets).reduce((sum, value) => sum + Number(value || 0), 0);
    if (targetTotal !== requested) {
      selected.push(...candidates.slice(0, requested));
      continue;
    }
    const categorySelection = [];
    for (const level of ["major", "clear", "minor", "match"]) {
      const count = Number(targets[level]) || 0;
      categorySelection.push(...candidates.filter(row => severity(row.scene) === level).slice(0, count));
    }
    const selectedIds = new Set(categorySelection.map(row => row.originalSceneId));
    if (categorySelection.length < requested) {
      categorySelection.push(...candidates.filter(row => !selectedIds.has(row.originalSceneId))
        .slice(0, requested - categorySelection.length));
    }
    selected.push(...categorySelection);
  }
  return selected;
}

export function buildCase(row, index, version = 1) {
  const caseId = `eval-v${version}-${String(index + 1).padStart(3, "0")}`;
  return {
    schemaVersion: version,
    caseId,
    category: row.category,
    tags: sceneTags(row.scene),
    input: anonymizedInput(row.source, row.scene, caseId),
    baseline: row.baseline,
    reference: {
      status: "unreviewed",
      mustMention: [],
      mustNotClaim: [],
      idealReason: "",
      idealLesson: "",
      reviewerNotes: ""
    },
    scores: {
      factualCorrectness: null,
      decisionRelevance: null,
      uncertaintyDiscipline: null,
      coachingValue: null,
      criticalError: null
    }
  };
}

function parseArguments(args) {
  const options = {
    out: "evaluation/private/evaluation-set-v1.jsonl",
    summary: "evaluation/private/evaluation-set-v1.summary.json",
    seed: "mortal-ai-coach-eval-v1"
  };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--db", "--out", "--summary", "--seed"].includes(name)) throw new Error(`Unknown argument: ${name}`);
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${name}`);
    options[name.slice(2)] = value;
    index += 1;
  }
  options.db ||= process.env.MORTAL_CODEX_EVAL_DB;
  if (!options.db) throw new Error("--db or MORTAL_CODEX_EVAL_DB is required");
  return options;
}

function readRows(dbPath, sceneService) {
  const database = new DatabaseSync(resolve(dbPath), { readOnly: true });
  try {
    return database.prepare(`
      SELECT scene_id, payload_json, explanation_json
      FROM scenes
      ORDER BY scene_id
    `).all().map(row => {
      const source = JSON.parse(row.payload_json);
      return {
        originalSceneId: row.scene_id,
        source,
        scene: sceneService.normalize(source),
        baseline: baselineExplanation(row.explanation_json)
      };
    });
  } finally {
    database.close();
  }
}

export function generate(options) {
  const sceneService = createSceneService({
    sceneSystem: "",
    sceneUserTemplate: "{SCENE_JSON}",
    questionSystem: "",
    summarySystem: ""
  });
  const rows = readRows(options.db, sceneService);
  const selected = selectRows(rows, DEFAULT_QUOTAS, options.seed);
  const cases = selected.map((row, index) => buildCase(row, index));
  const outputPath = resolve(options.out);
  const summaryPath = resolve(options.summary);
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(outputPath, `${cases.map(item => JSON.stringify(item)).join("\n")}\n`, { mode: 0o600 });

  const categoryCounts = Object.fromEntries(Object.keys(DEFAULT_QUOTAS).map(category => [
    category, cases.filter(item => item.category === category).length
  ]));
  const summary = {
    schemaVersion: 1,
    sourceSceneCount: rows.length,
    selectedSceneCount: cases.length,
    baselineCount: cases.filter(item => item.baseline).length,
    seed: options.seed,
    categories: categoryCounts,
    reviewStatus: {
      unreviewed: cases.filter(item => item.reference.status === "unreviewed").length,
      reviewed: cases.filter(item => item.reference.status === "reviewed").length
    }
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return { outputPath, summaryPath, summary };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = generate(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
