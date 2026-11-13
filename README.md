# Meet Your AI Patient (track A: visual patient)

A life-size, seated virtual patient in a three.js room, runnable in desktop Chrome and (via WebXR)
on Apple Vision Pro. Face, lip-sync and skeleton are driven by [TalkingHead](https://github.com/met4citizen/TalkingHead) (MIT).
Voice / LLM (ElevenLabs, track B) plugs into one function: `setAffect()`.

## Run

```bash
npm install
npm run dev          # http://localhost:5173  (Node 18+)
```

Desktop: drag to orbit around the patient. The panel on the right has 4 mood buttons, an intensity
slider, 3 gaze buttons and a nod. All of them call `affect.setAffect(...)`.

## Vision Pro (headset test)

WebXR needs HTTPS. Use a tunnel:

```bash
cloudflared tunnel --url http://localhost:5173
```

Open the printed `https://….trycloudflare.com` URL in Safari on the headset, tap **ENTER VR**.
Checklist (M3): enter/exit works, patient is life-size, ~1.4 m away, face animates, smooth frame rate.
Note: the debug panel is a 2D page overlay, so it is **not visible inside VR**. Set the mood before
entering, or drive it from the console / track B.

## Code map

| File | Role |
|---|---|
| `src/config.js` | **All tunable numbers**: room, seated pose, per-mood face + body deltas, gaze style |
| `src/scene.js` | Renderer, lights, camera rig, VR button (reference space `local`, eye height 1.2 m) |
| `src/room.js` | Procedural consultation room: window, furniture, canvas textures (no extra assets) |
| `src/patient.js` | Loads the avatar via TalkingHead `avatarOnly` mode into our scene |
| `src/affect.js` | `setAffect({emotion, intensity, gaze, gesture, behavior})` -> TalkingHead moods + pose + look-at |
| `src/bodylang.js` | Procedural body language: fidgeting, foot tap, knee bounce, posture shifts, looking around, breathing, shrug |
| `src/debug.js` | Debug panel |
| `src/vendor/talkinghead/` | Vendored TalkingHead modules (MIT) with 2 small patches, marked `PSYTRAIN PATCH` |
| `public/avatars/avaturn.glb` | Default avatar: photo-based Avaturn model (**non-commercial use only**, from the TalkingHead repo, 14 MB) |
| `public/avatars/mpfb.glb` | Alternative avatar (CC0, from the TalkingHead repo, 36 MB). Open `/?avatar=mpfb` to use it |

Avatars are registered in `AVATARS` in `src/config.js` (URL, retarget, eyelid baseline, seat offset,
eye-rotation range for the gaze code). Add an entry there to try another TalkingHead-compatible GLB.

## The `setAffect` interface (shared with track B)

```js
window.patient.setAffect({
  emotion: 'anxious',    // neutral | tense | anxious | angry | sad | withdrawn | dismissive | relieved
  intensity: 0.7,        // 0..1
  gaze: 'around',        // student | away | down | around   (optional)
  gesture: 'shrug',      // none | nod | shake | shrug       (optional)
  behavior: { fidget: 0.9, lookAround: 0.5, arms: 'clasped' } // optional overrides (see below)
});
```
Omitted fields keep their previous value. Picking a new `emotion` resets `behavior` overrides to that
emotion's profile; `behavior: null` clears overrides. This is the shape for the ElevenLabs `set_affect` tool.

## Body language (configurable)

Every emotion has a movement profile in `BEHAVIOR` (`src/config.js`); the effective values are the neutral
profile blended towards the emotion by `intensity`, then your overrides:

| Key | Effect |
|---|---|
| `fidget` | hands, fingers, forearms keep busy; wringing / thumb rubbing in bursts |
| `footTap`, `legBounce` | foot tapping / knee bouncing in bursts |
| `shift` | posture shifts: lean forward/back, weight to one side, twist, slump |
| `lookAround` | how often the patient looks round the room (sometimes a double glance) |
| `gazeStudent` | probability of keeping eye contact |
| `blink`, `breath`, `headMotion` | rate multipliers / amount of idle head movement |
| `arms` | `rest` (hands on thighs) / `clasped` (lap) / `crossed` |

The debug panel has a slider per key. Faces, micro-expressions and posture per emotion live in `FACE`,
`MICRO` and `BODY_DELTAS`.

## Tuning the seated pose

Edit `SEATED_POSE` in `src/config.js` (radians) and reload, or live in the console:

```js
patient.affect.setSeatedOverrides({ 'Hips.position': { x: 0, y: 0.6, z: 0 } });
```
Known-good so far: hips y 0.60 puts the ankles ~8 cm above the floor and the thighs on the 0.46 m seat;
knees -1.5 and feet 1.4 give vertical shins and flat feet.

## Vendor patches (why)

1. `lipsyncGetProcessor`: static import paths so Vite can bundle the lip-sync modules.
2. Extra delta bones (Spine2, shoulders, feet, toes) so `bodylang.js` can drive them per frame.
3. `opt.hipFeetBalance`: TalkingHead re-centres the hips under the feet each frame assuming the avatar
   stands at the world origin. That drags a seated avatar placed in a room off its chair, so we switch it
   off (`hipFeetBalance: false`). It also saves a per-frame bounding-box pass over the skinned mesh.

## Status

- M1 avatar in our room: done (verified in headless Chromium)
- M2 seated pose: done, hands rest beside the thighs, not on them yet
- M3 headset check: **needs a real Vision Pro**
- M4 moods + buttons: done in desktop view
- M5 movement: breathing, fidgeting, foot tap, knee bounce, posture shifts, look-around, blink rates,
  micro-expressions, nod/shake/shrug; gaze-follows-headset needs checking in XR
- Not started: track B bridge (ElevenLabs audio -> `streamAudio`, `set_affect` -> `setAffect`)
