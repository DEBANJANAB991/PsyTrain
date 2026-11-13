/**
 * The consultation page's only control: one button to start / end the live conversation with the patient,
 * a status line and a caption with the last thing said. (The full control panel is still at ?debug=1.)
 */
export function createTalkUI(root, { conversation, liveDirector, voice }) {
  root.hidden = false;
  root.innerHTML = `
    <div id="caption" aria-live="polite"></div>
    <button id="talk" disabled><span class="dot"></span><span class="label">Loading…</span></button>
    <div id="talkstatus">Click the button and greet her: she waits for you to speak first.</div>
    <label id="phones"><input type="checkbox"> I'm using headphones (lets me interrupt her)</label>`;
  const btn = root.querySelector('#talk'), label = root.querySelector('.label');
  const phones = root.querySelector('#phones input');
  phones.checked = conversation.headphones = localStorage.getItem('psytrain.headphones') === '1';
  phones.onchange = () => { conversation.headphones = phones.checked; localStorage.setItem('psytrain.headphones', phones.checked ? '1' : '0'); render(); };
  const statusEl = root.querySelector('#talkstatus'), caption = root.querySelector('#caption');
  let available = false, errorText = '';

  const setCaption = (who, text) => { caption.textContent = text ? `${who}: ${text}` : ''; caption.classList.toggle('her', who !== 'You'); };

  const render = () => {
    const s = conversation.state;
    btn.disabled = !available;
    btn.classList.toggle('live', s === 'live');
    btn.classList.toggle('busy', s === 'connecting');
    label.textContent = s === 'idle' ? 'Talk to the patient' : s === 'connecting' ? 'Connecting…' : 'End conversation';
    if (errorText) statusEl.textContent = errorText;
    else if (s === 'connecting') statusEl.textContent = 'Allow the microphone if your browser asks.';
    else if (s === 'live') statusEl.textContent = conversation.micMuted ? 'She is speaking… (your mic is paused until she finishes)'
      : conversation.speaking ? 'She is speaking… (you can interrupt her)' : 'Listening. Just talk to her.';
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

  conversation.on('status', render);
  conversation.on('student', (t) => setCaption('You', t));
  conversation.on('patient', (t) => setCaption('Patient', t));
  conversation.on('correction', (t) => setCaption('Patient', t));
  conversation.on('ended', ({ reason }) => { if (reason !== 'ended by you') errorText = `Conversation ended: ${reason}.`; render(); });
  conversation.on('error', (e) => { errorText = e.message; render(); });
  liveDirector.on('error', (e) => console.warn('[live director]', e.message));
  setInterval(() => { if (conversation.state === 'live') render(); }, 300);   // speaking / listening
  render();
}
