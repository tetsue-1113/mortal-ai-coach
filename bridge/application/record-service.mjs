import { finiteNumber, limitedText, sceneId } from "./scene-service.mjs";
import { normalizeProvider } from "../providers.mjs";

export function createRecordService({ sceneService, repository }) {
  function normalizeStoredRecord(input) {
    const scene = sceneService.normalize(input?.scene);
    scene.sceneId = sceneId(input?.scene?.sceneId);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(scene.reportId)) throw new Error("Invalid report ID");
    if (!Number.isInteger(scene.playerId) || scene.playerId < 0 || scene.playerId > 3) throw new Error("Invalid player ID");
    const source = input?.explanation;
    const allowedVerdicts = new Set(["match", "equivalent", "uncertain", "minor", "clear", "major"]);
    const allowedDanger = new Set(["安", "中", "危", "現"]);
    const explanation = source && typeof source === "object" ? {
      ...(source.banner && typeof source.banner === "object" ? { banner: {
        verdict: allowedVerdicts.has(source.banner.verdict) ? source.banner.verdict : "equivalent",
        qDelta: finiteNumber(source.banner.qDelta), oneLine: limitedText(source.banner.oneLine, 60)
      }} : {}),
      comparison: Array.isArray(source.comparison) ? source.comparison.slice(0, 3).map(item => ({
        tile: limitedText(item?.tile, 8), route: ["最速", "中間", "守備"].includes(item?.route) ? item.route : null,
        isMortalTop: !!item?.isMortalTop, isActual: !!item?.isActual,
        shanten: finiteNumber(item?.shanten), ukeire: finiteNumber(item?.ukeire),
        qDelta: finiteNumber(item?.qDelta), probability: finiteNumber(item?.probability), value: finiteNumber(item?.value),
        danger: allowedDanger.has(item?.danger) ? item.danger : null
      })) : [],
      reason: limitedText(source.reason, 2400), lesson: limitedText(source.lesson, 1200),
      ...(source.pushFold && typeof source.pushFold === "object" ? { pushFold: scene.pushFold } : {}),
      ...(source.scoreSimulation && typeof source.scoreSimulation === "object" ? { scoreSimulation: scene.scoreSimulation } : {}),
      ...(source.tacticsGuidance && typeof source.tacticsGuidance === "object" ? { tacticsGuidance: scene.tacticsGuidance } : {}),
      provider: normalizeProvider(source.provider)
    } : null;
    const chat = Array.isArray(input?.chat) ? input.chat.slice(0, 100).map(message => ({
      role: message?.role === "assistant" ? "assistant" : "user", content: limitedText(message?.content, 4000)
    })).filter(message => message.content) : undefined;
    return { scene, explanation, chat };
  }

  return {
    save(input) {
      const records = (Array.isArray(input?.scenes) ? input.scenes : [input]).slice(0, 80).map(normalizeStoredRecord);
      if (!records.length) throw new Error("No scenes supplied");
      return repository.saveScenes(records);
    },
    status: () => repository.status()
  };
}
