(() => {
  "use strict";
  const namespace = globalThis.MortalCoach ||= {};

  // Page-specific conversion lives here; coaching decisions never do.
  namespace.MortalPageAdapter = Object.freeze({
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
  });
})();
