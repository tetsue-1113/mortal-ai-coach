export const API_VERSION = "1.0";
export const SERVER_VERSION = "0.14.0";

export const ROUTES = Object.freeze({
  health: "/api/v1/health",
  analyzeScene: "/api/v1/analyses/scene",
  summarizeHanchan: "/api/v1/analyses/hanchan",
  askQuestion: "/api/v1/questions",
  saveScenes: "/api/v1/records/scenes",
  storageStatus: "/api/v1/records/status"
});

export const LEGACY_ROUTES = Object.freeze({
  "/health": ROUTES.health,
  "/analyze": ROUTES.analyzeScene,
  "/summary": ROUTES.summarizeHanchan,
  "/question": ROUTES.askQuestion,
  "/records/scenes": ROUTES.saveScenes,
  "/records/status": ROUTES.storageStatus
});

export function canonicalPath(pathname) {
  return LEGACY_ROUTES[pathname] || pathname;
}
