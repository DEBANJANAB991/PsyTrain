/**
 * The talk dock, top right of the consultation page (above the SKID notes, clear of the patient's body):
 * start / end the live conversation, a headphones switch, a Notes button while the notes are hidden and the
 * ENTER VR button where the browser supports it. Below them a status line with a mic meter and a "Heard you"
 * flash, and a caption with the last thing said.
 * The buttons are large (60 px) and spaced apart, so that looking at one on Apple Vision Pro selects only it.
 *
 * Debug session (?debug=1): also a label with the orchestrator's mode (normal / distracted / aggressive) and why it
 * changed; "Bingo" flips it. It is never shown in a normal session, so the trainee does not see the answer.
 */
const HEARD_MS = 1600;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {HTMLElement} root  #talkbar
 * @param {object} o
 * @param {{ name: string, firstName: string }} [o.who]  who the patient is (cases.js sessionPersona)
 * @param {{ button: HTMLElement, supported: Promise<boolean> }} [o.vr]  three.js' VR button (scene.js)
 * @param {object} [o.skid]  the SKID notes panel (skid.js): the Notes button reopens it
 * @param {boolean} [o.showMode]  debug session: show the orchestrator's mode
 */
export function createTalkUI(root, { conversation, liveDirector, voice, modeWatcher, who = null, vr = null, skid = null, showMode = false }) {
  const first = who?.firstName || 'the patient';
  root.hidden = false;
  root.innerHTML = `
    <div class="dock-row">
      <button id="talk" class="dock-btn primary" disabled><span class="dot"></span><span class="label">Loading…</span></button>
      <button id="phones" class="dock-btn" aria-pressed="false"
        title="With headphones the mic stays open and you can interrupt ${first}. Without them the mic pauses while ${first} speaks, so ${first}'s voice from your speakers is not taken as yours.">🎧 <span></span></button>
      <button id="notes" class="dock-btn" hidden title="Show the SKID notes again">📝 Notes</button>
    </div>
    <div id="talkstatus"><span class="mic" aria-hidden="true"><i></i></span><span class="text"></span><span class="heard" hidden>✓ Heard you</span></div>
    <div id="modebadge" hidden></div>
    <div id="caption" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const btn = $('#talk'), label = $('#talk .label'), phones = $('#phones'), notes = $('#notes');
  const statusEl = $('#talkstatus'), statusText = $('#talkstatus .text'), mic = $('#talkstatus .mic'), heard = $('#talkstatus .heard');
  const caption = $('#caption');
  let available = false, errorText = '', awaitingReply = false, heardTimer = 0;

  // ---- headphones -----------------------------------------------------------------------------------
  conversation.headphones = localStorage.getItem('psytrain.headphones') === '1';
  const renderPhones = () => {
    phones.setAttribute('aria-pressed', String(conversation.headphones));
    phones.querySelector('span').textContent = `Headphones: ${conversation.headphones ? 'on' : 'off'}`;
  };
  phones.onclick = () => {
    conversation.headphones = !conversation.headphones;
    localStorage.setItem('psytrain.headphones', conversation.headphones ? '1' : '0');
    renderPhones(); render();
  };
  renderPhones();

  // ---- notes and VR -------------------------------------------------------------------------------------
  if (skid) {
    const renderNotes = () => { notes.hidden = skid.isOpen; };
    notes.onclick = () => skid.open();
    skid.onToggle(renderNotes);
    renderNotes();
  }
  vr?.supported.then((ok) => { if (ok) $('.dock-row').appendChild(vr.button); });

  // ---- status, captions -----------------------------------------------------------------------------------
  const setCaption = (whoSaid, text) => { caption.textContent = text ? `${whoSaid}: ${text}` : ''; caption.classList.toggle('her', whoSaid !== 'You'); };

  const render = () => {
    const s = conversation.state;
    btn.disabled = !available;
    btn.classList.toggle('live', s === 'live');
    btn.classList.toggle('busy', s === 'connecting');
    label.textContent = s === 'idle' ? `Talk to ${who?.firstName || 'the patient'}` : s === 'connecting' ? 'Connecting…' : 'End conversation';
    const live = s === 'live' && !errorText;
    if (conversation.speaking) awaitingReply = false;
    mic.hidden = !live;
    mic.classList.toggle('paused', live && conversation.micMuted);
    statusEl.classList.toggle('error', Boolean(errorText));
    if (errorText) statusText.textContent = errorText;
    else if (s === 'idle') statusText.textContent = `Press Talk: ${first} says hello, then it's your turn.`;
    else if (s === 'connecting') statusText.textContent = 'Allow the microphone if your browser asks.';
    else if (conversation.speaking) statusText.textContent = conversation.micMuted ? `${cap(first)} is speaking. Your mic is paused until ${first} finishes.` : `${cap(first)} is speaking. You can interrupt.`;
    else if (awaitingReply) statusText.textContent = `${cap(first)} is thinking…`;
    else statusText.textContent = 'Listening. Just talk.';
  };

  // mic meter: only animated while the conversation is live
  let meter = 0;
  const animateMeter = () => {
    if (conversation.state !== 'live') { mic.style.setProperty('--level', 0); meter = 0; return; }
    mic.style.setProperty('--level', conversation.micMuted ? 0 : conversation.micLevel.toFixed(3));
    meter = requestAnimationFrame(animateMeter);
  };

  (voice.status?.checked ? Promise.resolve(voice.status) : voice.checkStatus()).then((st) => {
    available = Boolean(st.agent);
    if (!available) errorText = st.configured ? 'The patient agent is not set up yet (run ai-patient-voice/create_agent.py).' : 'Voice is not configured on the server (ElevenLabs key missing).';
    render();
  });

  btn.onclick = async () => {
    if (conversation.active) { conversation.stop(); return; }
    errorText = '';
    setCaption('', '');
    try { await conversation.start(); }
    catch (e) { errorText = e.message; render(); }
  };

  conversation.on('status', (s) => {
    if (s !== 'live') awaitingReply = false;
    if (s === 'live' && !meter) animateMeter();
    render();
  });
  conversation.on('student', (t) => {
    setCaption('You', t);
    if (!t.trim()) return;
    awaitingReply = true;
    heard.hidden = false;
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => { heard.hidden = true; }, HEARD_MS);
    render();
  });
  conversation.on('patient', (t) => { awaitingReply = false; setCaption(cap(first), t); render(); });
  conversation.on('correction', (t) => setCaption(cap(first), t));
  conversation.on('ended', ({ reason }) => { if (reason !== 'ended by you') errorText = `Conversation ended: ${reason}.`; render(); });
  conversation.on('error', (e) => { errorText = e.message; render(); });
  liveDirector.on('error', (e) => console.warn('[live director]', e.message));

  // ---- leaving the room ---------------------------------------------------------------------------------
  document.getElementById('back')?.addEventListener('click', (e) => {
    if (!conversation.active) return;
    if (!confirm(`End the conversation with ${first} and go back to the patient list?`)) { e.preventDefault(); return; }
    conversation.stop();
  });
  window.addEventListener('beforeunload', (e) => { if (conversation.active) { e.preventDefault(); e.returnValue = ''; } });

  // ---- orchestrator mode label (debug session only) ------------------------------------------------------
  const badge = $('#modebadge');
  const setMode = (mode, reason, by) => {
    if (!showMode) return;
    badge.hidden = false;
    badge.className = mode;
    badge.textContent = `Mode: ${mode}${by === 'bingo' ? ' (Bingo)' : ''}${reason ? ' · ' + reason : ''}`;
    badge.title = reason || '';
  };
  conversation.on('session', () => setMode('normal', 'conversation start', 'start'));
  modeWatcher?.on('mode', ({ mode, reason, by }) => {
    setMode(mode, reason, by);
    console.info(`[orchestrator] mode -> ${mode} (${by}): ${reason}`);
  });
  conversation.on('status', (s) => { if (s === 'idle') badge.hidden = true; });

  setInterval(() => { if (conversation.state === 'live') render(); }, 250);   // speaking / listening
  render();
}
