/**
 * MIRROR entry point, loaded by consult.html after src/main.js (one additive <script> tag).
 * PsyTrain's main.js is not modified: MIRROR waits for the public `window.patient` handle that main.js
 * already publishes once the avatar is ready, then observes its voice + live conversation.
 *
 *   consult.html?...            MIRROR on (default)
 *   consult.html?...&mirror=0   the original PsyTrain consultation, nothing from MIRROR is loaded
 */
if (new URLSearchParams(location.search).get('mirror') !== '0') {
  import('./index.js').then(({ mountMirror }) => {
    const mirror = mountMirror();
    const attach = () => {
      if (!window.patient?.voice) return false;
      mirror.attachPatient(window.patient);
      return true;
    };
    if (!attach()) {
      const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 200);
    }
  }).catch((e) => console.warn('[mirror] integration unavailable', e));
}
