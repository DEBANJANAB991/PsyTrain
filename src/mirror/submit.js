/**
 * Submit-once controller for End Session.
 *  - The payload is frozen on the first submit; it never changes afterwards.
 *  - POST /replay is sent until it has succeeded once. 409 means this session_id is already saved
 *    (e.g. the first response was lost) and counts as success.
 *  - After that, retries only GET the saved assessment: the consultation is never submitted again.
 *  - Concurrent calls share one in-flight request (double clicks cannot create two submissions).
 *  - After success, further calls return the same result without contacting the backend.
 */
export function createSubmission(api, buildPayload) {
  let payload = null;
  let replayed = false;
  let inFlight = null;
  let result = null;

  async function run() {
    if (!payload) payload = await buildPayload();   // sync or async builder; frozen once built
    if (!replayed) {
      try {
        await api.replay(payload);
      } catch (e) {
        if (e?.status !== 409) throw e;
      }
      replayed = true;
    }
    const assessment = await api.getAssessment(payload.session_id);
    if (assessment?.session_id !== payload.session_id) throw new Error('MIRROR returned an assessment for a different session.');
    result = { sessionId: payload.session_id, assessment };
    return result;
  }

  return {
    submit() {
      if (result) return Promise.resolve(result);
      if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
      return inFlight;
    },
    get payload() { return payload; },
    get submitted() { return replayed; },
    get done() { return Boolean(result); },
    get busy() { return Boolean(inFlight); },
    /** 422 means the backend rejected the data itself; resending it would fail the same way. */
    isRetryable: (error) => error?.status !== 422
  };
}
