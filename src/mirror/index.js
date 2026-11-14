/**
 * MIRROR integration layer (loaded by consult.html through boot.js unless the URL has ?mirror=0).
 *
 * PsyTrain owns the consultation (landing page, patient, Talk button, live conversation, avatar).
 * MIRROR only observes it and assesses it afterwards:
 *
 *   1. recording starts when PsyTrain's live conversation first goes live (nothing before that is captured)
 *   2. 'student' / 'patient' / 'correction' events of LiveConversation become transcript turns
 *   3. one click on End session: the conversation is ended through its own stop(), the transcript is frozen,
 *      MIRROR's case setup is fetched (/start, nothing is saved), exactly one POST /replay is sent and the
 *      saved assessment (GET /{id}/assessment) is shown below the consultation
 *   4. Back to patient returns to the same avatar; a failed step can be retried without a second replay
 *
 * No fact outcomes are entered or inferred: the replay carries the real transcript only, and MIRROR's own
 * assessment classifies the expected facts from it.
 *
 * The existing consult.html elements are moved (not recreated) into the consultation section.
 */
import './mirror.css';
import { createMirrorApi } from './api.js';
import { createTranscriptRecorder, instrumentVoice, listenToConversation } from './transcript.js';
import { buildReplayPayload } from './payload.js';
import { createSubmission } from './submit.js';
import { renderFeedback } from './feedback.js';
import { analyseCoaching, turnsFromAssessment } from './coaching.js';
import { buildIssueTimeline } from './issues.js';
import { DEMO_ASSESSMENT, demoOptions } from './demo.js';   // temporary demo fallback (empty transcript only)
// the teammates' hints for difficult patients, bundled as-is (read only; the file is not modified)
import hints from '../../ai-patient-voice/hints.json';

// PROVISIONAL mapping from the PsyTrain situation (landing page) to a MIRROR case. Not an approved clinical
// mapping: the 'distracted' patient's topic is her drinking, closest to MIRROR's 'defensive-001' case
// (expected fact: alcohol-history). No MIRROR case matches the 'aggressive' patient, so none is mapped.
// Override per consultation with ?scenario=<MIRROR scenario_id>.
const SITUATION_TO_SCENARIO = { distracted: 'defensive-001' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function describeError(e) {
  if (e?.status === 422 && Array.isArray(e.detail)) {
    return 'MIRROR rejected the consultation data: ' + e.detail.map((d) => `${(d.loc ?? []).join('.')}: ${d.msg}`).join('; ');
  }
  return e?.message || 'Unexpected error.';
}

export function mountMirror() {
  const api = createMirrorApi();
  const recorder = createTranscriptRecorder();
  const q = new URLSearchParams(location.search);
  const scenarioId = q.get('scenario') || SITUATION_TO_SCENARIO[q.get('situation')] || null;
  const state = { patient: null, scenario: null, startedAt: null, ended: false, submission: null, sessionId: null };

  // ---- layout: consultation section (the existing page) + feedback section below -----------------
  const html = document.documentElement;
  html.classList.add('mirror-on');
  const avatarScreen = el('div', { class: 'mirror-slide mirror-slide-avatar', 'aria-label': 'Consultation' });
  const consult = el('section', { class: 'mirror-consult' }, avatarScreen);
  const feedback = el('section', { class: 'mirror-feedback', hidden: true, 'aria-label': 'Consultation feedback' });
  const root = el('div', { id: 'mirror-root' }, consult, feedback);
  document.body.prepend(root);

  // Move (not recreate) every existing element of consult.html into the consultation section: #app (canvas),
  // #back, #status, #debug, #talkbar and the VR button that scene.js appends to <body>. Same nodes, same listeners.
  const existing = [...document.body.children].filter((n) => n !== root && n.tagName !== 'SCRIPT');
  avatarScreen.append(...existing);
  window.dispatchEvent(new Event('resize'));   // let scene.js re-measure its container

  // ---- the one MIRROR control on the patient screen -----------------------------------------------
  const endSessionBtn = el('button', { class: 'mirror-edge', type: 'button', title: 'End the consultation and get MIRROR feedback', onclick: onEndSession }, 'End session');
  const notice = el('p', { class: 'mirror-notice', role: 'status', 'aria-live': 'polite', hidden: true });
  avatarScreen.append(endSessionBtn, notice);
  let noticeTimer = null;
  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
  }

  // ---- feedback section ------------------------------------------------------------------------
  const fbStatus = el('span', { class: 'mirror-muted', role: 'status', 'aria-live': 'polite' });
  const fbPanel = el('div', { class: 'mirror-fb-panel' });
  const fbContent = el('div', { class: 'mirror-fb-content', hidden: true });
  feedback.append(el('div', { class: 'mirror-feedback-bar' },
    el('button', { class: 'mirror-btn', type: 'button', onclick: backToPatient }, '↑ Back to patient'), fbStatus), fbPanel, fbContent);

  // ---- MIRROR case for this patient (read-only GET; no consultation is created) -----------------
  async function loadScenario() {
    if (!scenarioId) return null;
    const all = await api.getScenarios();
    const found = all.find((s) => s.scenario_id === scenarioId);
    if (!found) throw new Error(`MIRROR has no case "${scenarioId}".`);
    return found;
  }
  loadScenario().then((s) => { state.scenario = s; }).catch(() => { /* retried on End session */ });

  // ---- recording follows PsyTrain's own conversation lifecycle -------------------------------------
  function beginRecordingIfLive(status) {
    if (status !== 'live' || state.ended || recorder.active) return;
    if (!state.startedAt) state.startedAt = new Date();   // consultation start = first live conversation
    recorder.start();
  }

  // ---- End session: one click = freeze, submit once, show the saved assessment ----------------------
  async function onEndSession() {
    if (state.sessionId) return showFeedbackSection();      // already assessed: just show it again
    if (state.submission) {                                  // submitted before (in flight, or failed)
      showFeedbackSection();
      if (!state.submission.busy) runSubmission();           // retry the same frozen submission
      return;
    }
    if (state.endedEmpty) return showFeedbackSection();      // already ended without a transcript
    // Empty transcript: still end the consultation, but send nothing (an empty replay is not a meaningful
    // assessment, and nothing is fabricated).
    if (recorder.count === 0) {
      finishConsultation();
      state.endedEmpty = true;
      endSessionBtn.textContent = 'Session ended';
      showFeedbackSection();
      // TEMPORARY demo fallback (demo.js): a predefined, clearly labelled demo assessment, rendered locally with
      // the existing feedback renderer. Nothing is submitted, saved or sent to Bedrock.
      try {
        renderFeedback(fbContent, DEMO_ASSESSMENT, demoOptions(hints, openLandingPage));
        setFeedbackState('ready', 'Demo assessment · simulated feedback, not based on a real consultation · not saved');
        feedback.dataset.demo = 'true';
      } catch (e) {
        console.warn('[mirror] demo assessment unavailable', e);
        setFeedbackState('empty', 'No consultation transcript was captured in this session, so MIRROR cannot generate feedback for it. Nothing was submitted.');
      }
      return;
    }
    // checks that do not end the consultation, so the student can carry on (transcript kept)
    if (!scenarioId) return showNotice('No MIRROR case is configured for this patient, so it cannot be assessed (open it with ?scenario=<MIRROR case id>). The transcript is kept.');
    endSessionBtn.disabled = true;
    try {
      if (!state.scenario) state.scenario = await loadScenario();
    } catch (e) {
      endSessionBtn.disabled = false;
      return showNotice(`MIRROR is not reachable, so the session was not ended. ${describeError(e)} Try End session again.`);
    }

    // from here the consultation is over
    finishConsultation();
    const turns = recorder.turns(), endedAt = new Date();
    const startedAt = state.startedAt ?? new Date(turns[0]?.timestamp ?? endedAt);
    const caseId = state.scenario.scenario_id;
    // built once and frozen inside the submission; /start only returns the case setup (nothing is saved)
    state.submission = createSubmission(api, async () => {
      const s = await api.startConsultation(caseId);
      const when = startedAt.toISOString();
      const session = {
        ...s,
        started_at: when,
        events: (s.events ?? []).map((e) => e.event_type === 'consultation_started' ? { ...e, timestamp: when, details: 'Consultation started (live conversation began in PsyTrain).' } : e)
      };
      return buildReplayPayload({ session, turns, endedAt });   // no fact outcomes: nothing is inferred
    });
    showFeedbackSection();
    runSubmission();
  }

  /** End the consultation: freeze the transcript and end the live conversation through its own stop(). */
  function finishConsultation() {
    state.ended = true;                                                   // no later recording restart
    recorder.stop();                                                      // nothing later is added
    if (state.patient?.conversation?.active) state.patient.conversation.stop();   // PsyTrain's own lifecycle method
  }

  async function runSubmission() {
    const sub = state.submission;
    endSessionBtn.disabled = true;
    setFeedbackState('loading', sub.submitted
      ? 'Retrieving the saved assessment (the consultation is not submitted again)…'
      : 'Submitting the consultation to MIRROR and waiting for the assessment…');
    try {
      const { sessionId, assessment } = await sub.submit();
      state.sessionId = sessionId;
      renderAssessment(sessionId, assessment);
    } catch (e) {
      const retry = sub.isRetryable(e);
      setFeedbackState('error', describeError(e) + (retry ? ' The transcript is kept.' : ''), retry ? runSubmission : null,
        sub.submitted ? 'Retrying only reloads the saved assessment; the consultation is not submitted again.'
          : 'Retrying sends the same consultation; MIRROR saves it only once.');
    } finally {
      endSessionBtn.disabled = false;
      endSessionBtn.textContent = 'View feedback';
    }
  }

  // ---- feedback: the saved MIRROR assessment, rendered natively (feedback.js) ------------------------
  function setFeedbackState(kind, message, retry = null, retryNote = '') {
    feedback.dataset.state = kind;
    if (kind === 'ready') {
      fbStatus.textContent = message;
      fbPanel.replaceChildren();
      fbPanel.hidden = true;
      fbContent.hidden = false;
      return;
    }
    fbContent.hidden = true;
    fbPanel.hidden = false;
    fbStatus.textContent = kind === 'loading' ? 'Loading feedback…' : kind === 'empty' ? 'Session ended · no feedback' : 'Feedback unavailable';
    fbPanel.replaceChildren(kind === 'loading'
      ? el('div', { class: 'mirror-fb-message' }, el('span', { class: 'mirror-spinner' }), el('p', {}, message))
      : el('div', { class: 'mirror-fb-message' }, el('p', { class: 'mirror-error', role: 'alert' }, message),
        retry ? el('button', { class: 'mirror-btn mirror-btn-primary', type: 'button', onclick: retry }, 'Retry') : null,
        retryNote ? el('p', { class: 'mirror-muted' }, retryNote) : null));
  }

  function showFeedbackSection() {
    feedback.hidden = false;
    html.classList.add('mirror-scroll');
    window.dispatchEvent(new Event('resize'));   // a page scrollbar may change the canvas width
    requestAnimationFrame(() => feedback.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }

  function renderAssessment(sessionId, assessment) {
    try {
      if (assessment?.session_id !== sessionId) throw new Error('MIRROR returned an assessment for a different session.');
      // coaching is derived from the transcript MIRROR saved with this assessment; a coaching error never hides the assessment
      let coaching = null;
      try { coaching = analyseCoaching(turnsFromAssessment(assessment), hints); }
      catch (e) { console.warn('[mirror] personalised coaching unavailable', e); coaching = { status: 'insufficient_evidence', items: [], tips: [], reason: 'The coaching analysis could not be completed.' }; }
      // issue timeline from the same saved transcript + assessment + coaching result; an error never hides the assessment
      let issues = null;
      try { issues = buildIssueTimeline(assessment, turnsFromAssessment(assessment), coaching); }
      catch (e) { console.warn('[mirror] issue timeline unavailable', e); issues = { status: 'insufficient', located: [], unlocated: [] }; }
      renderFeedback(fbContent, assessment, { coaching, issues, onTryAgain: openLandingPage });
      setFeedbackState('ready', `Saved assessment · Session ${sessionId}`);
    } catch (e) {
      setFeedbackState('error', `The saved assessment could not be displayed. ${describeError(e)}`, retryDisplay,
        'Retrying only reloads the saved assessment; the consultation is not submitted again.');
    }
  }

  async function retryDisplay() {
    setFeedbackState('loading', 'Retrieving the saved assessment…');
    try {
      renderAssessment(state.sessionId, await api.getAssessment(state.sessionId));   // GET only, never /replay
    } catch (e) {
      setFeedbackState('error', `The saved assessment could not be retrieved. ${describeError(e)}`, retryDisplay,
        'Retrying only reloads the saved assessment; the consultation is not submitted again.');
    }
  }

  /**
   * Try Again / Back to PsyTrain: PsyTrain's own navigation to its landing page, i.e. the room's existing
   * "← Patients" link (#back, href "/"). A normal page navigation, exactly like that link: the next
   * consultation room is a fresh page load, so MIRROR starts with an empty transcript, no submission and no
   * session; its session ID is created by /start when that consultation is submitted. The saved assessment
   * of this session stays in MIRROR's database.
   */
  function openLandingPage() {
    const href = document.getElementById('back')?.getAttribute('href') || '/';
    if (state.patient?.conversation?.active) state.patient.conversation.stop();   // already stopped at End session
    location.assign(href);
  }

  function backToPatient() {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return {
    attachPatient(patient) {
      state.patient = patient;
      instrumentVoice(patient.voice, recorder);              // ?debug=1 "Speak text" lines, mic echo excluded
      listenToConversation(patient.conversation, recorder);  // the live conversation (student / patient / correction)
      patient.conversation?.on?.('status', beginRecordingIfLive);
      beginRecordingIfLive(patient.conversation?.state);
    },
    recorder
  };
}
