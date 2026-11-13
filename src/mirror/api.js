/**
 * Minimal client for the existing MIRROR consultation API (contracts unchanged).
 * Paths are same-origin: the PsyTrain server proxies /api/consultations to the MIRROR backend
 * (vite.config.js), so the browser never needs the backend URL and no CORS change is required.
 *
 *   GET  /api/consultations/scenarios
 *   POST /api/consultations/start                  { scenario_id }
 *   POST /api/consultations/replay                 ConsultationSession
 *   GET  /api/consultations/{session_id}/assessment
 */

export class MirrorApiError extends Error {
  constructor(message, { status = 0, detail = null } = {}) {
    super(message);
    this.name = 'MirrorApiError';
    this.status = status;     // 0 = network error / timeout / backend unreachable
    this.detail = detail;     // FastAPI `detail` (string, or a list of validation errors for 422)
  }
}

export function createMirrorApi({ fetchImpl = globalThis.fetch?.bind(globalThis), base = '/api/consultations' } = {}) {
  async function request(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: ctrl.signal
      });
    } catch (e) {
      const timedOut = e?.name === 'AbortError';
      throw new MirrorApiError(timedOut ? 'The MIRROR backend did not respond in time.' : 'The MIRROR backend could not be reached.', { status: 0 });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.detail ?? null;
      const text = typeof detail === 'string' ? detail : `MIRROR request failed (HTTP ${res.status}).`;
      throw new MirrorApiError(text, { status: res.status, detail });
    }
    return data;
  }

  return {
    getScenarios: () => request('/scenarios'),
    startConsultation: (scenarioId) => request('/start', { method: 'POST', body: { scenario_id: scenarioId } }),
    // Deterministic assessment + Bedrock contextual feedback (its own timeout is 15 s): allow two minutes.
    replay: (session) => request('/replay', { method: 'POST', body: session, timeoutMs: 120000 }),
    getAssessment: (sessionId) => request(`/${encodeURIComponent(sessionId)}/assessment`)
  };
}
