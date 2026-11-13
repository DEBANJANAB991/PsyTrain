# Meet Your AI Patient (track A: visual patient)

A life-size, seated virtual patient in a three.js room, runnable in desktop Chrome and (via WebXR)
on Apple Vision Pro. Face, lip-sync and skeleton are driven by [TalkingHead](https://github.com/met4citizen/TalkingHead) (MIT).
Voice / LLM (ElevenLabs, track B) plugs into one function: `setAffect()`.

## Run

```bash
npm install
npm run dev          # http://localhost:5173  (Node 18+)
```

The root URL opens the **landing page**: pick a patient and a behaviour, then **Enter consultation room** opens
the 3D room (`/consult.html?case=extrovert&behavior=shy&patient=young-woman`). For now only the extrovert patient
(the Avaturn young woman) is enabled, with two behaviours: **shy** and **aggressive**. The other patients show as
"coming soon". Patients and behaviours are defined in `src/cases.js`. Each behaviour is a personality definition
(Big Five traits, behaviour ranges, starting emotion, arm posture) that is registered with `Personality.define()`
when the room loads. It changes face, posture, gaze and body language, not the voice.

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
| `index.html`, `src/landing.js` | Landing page: choose a patient and a behaviour (no three.js loaded) |
| `consult.html` | The 3D consultation room page (loads `src/main.js`) |
| `src/cases.js` | Patients on the landing page and their behaviours (personality definitions) |
| `src/photoroom.js` | Default room: a real 360° photo projected onto the floor (`GroundedSkybox`), lit by the same room's HDR, plus a real chair model |
| `src/room.js` | Procedural consultation room (`/consult.html?room=procedural`): window, furniture, wheelchair, canvas textures |
| `public/rooms/` | Poly Haven "Reading Room": 6K tonemapped photo (background) + 1K HDR (lighting). CC0 |
| `public/models/dining_chair_02.glb` | Poly Haven "Dining Chair 02" (2K textures). CC0 |
| `public/landing/` | Landing-page portraits (rendered from the app) and the hero image |
| `src/patient.js` | Loads the avatar via TalkingHead `avatarOnly` mode into our scene |
| `src/conditions.js` | Visible conditions painted into the avatar's textures: face paint / blood presets (`FACE_PAINT`), logo covers |
| `src/affect.js` | `setAffect({emotion, intensity, gaze, gesture, behavior})` -> TalkingHead moods + pose + look-at |
| `src/bodylang.js` | Procedural body language: fidgeting, foot tap, knee bounce, posture shifts, looking around, breathing, shrug |
| `src/debug.js` | Debug panel |
| `src/vendor/talkinghead/` | Vendored TalkingHead modules (MIT) with 2 small patches, marked `PSYTRAIN PATCH` |
| `public/avatars/avaturn.glb` | Default avatar: photo-based Avaturn model (**non-commercial use only**, from the TalkingHead repo, 14 MB) |
| `public/avatars/avatarsdk.glb` | Young man: AvatarSDK / MetaPerson model (**non-commercial use only**, from the TalkingHead repo, 12 MB). The printed shirt logo is hidden at load time |
| `public/avatars/mpfb.glb` | Alternative avatar (CC0, from the TalkingHead repo, 4 MB). Open `/?avatar=mpfb` to use it |

Avatars are registered in `AVATARS` in `src/config.js` (URL, retarget, eyelid baseline, seat offset,
eye-rotation range for the gaze code). Add an entry there to try another TalkingHead-compatible GLB.

### Room

The default room is a real place: Poly Haven's "Reading Room" 360° photo, projected onto a dome with a flat floor so
the patient's chair stands on the photo's floor. Her shadow falls on an invisible `ShadowMaterial` floor. The
settings are in `PHOTO_ROOM` in `src/config.js`. `backU` picks which part of the photo is behind the patient,
and `cameraHeight` sets the floor scale. Add `?room=procedural` to get the modelled room back. A photo has no
parallax, so in the headset the room looks right from the seat but does not shift if you lean far to the side.

### Patients

A patient is an avatar plus optional visible conditions, listed in `PATIENTS` in `src/config.js`. Pick one with
`/?patient=<key>` or the **Patient** dropdown at the top of the debug panel (it reloads the page).

| Key | Avatar | Conditions |
|---|---|---|
| `young-woman` (default) | avaturn | none |
| `young-man` | avatarsdk | none |
| `man-wheelchair` | avatarsdk | `seat: 'wheelchair'`: manual wheelchair, footrests fitted to his feet after load |
| `young-woman-face-paint`, `young-man-face-paint` | avaturn / avatarsdk | `facePaint: 'red-paint'`: red paint finger-smeared on cheeks and forehead |
| `young-woman-head-wound`, `young-man-head-wound` | avaturn / avatarsdk | `facePaint: 'forehead-wound'`: bleeding cut above the left brow, blood wiped on the cheek |
| `mpfb-woman` | mpfb | none |

Face paint is drawn into the head's own base-colour texture once at load, so it moves with every expression and
costs nothing per frame. Presets (`red-paint`, `forehead-wound`, `nosebleed`) are in `FACE_PAINT` in
`src/conditions.js`. Marks are given in metres in a frame centred between the eyes and projected onto the
posed head, so one preset fits every avatar. `/?avatar=<key>` still works and means that avatar with no conditions.

Children and older adults need new base GLBs: TalkingHead needs a Mixamo-style rig plus the 52 ARKit and
15 Oculus viseme blendshapes, and none of the bundled models can be aged convincingly at runtime.

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

## Voice + lip-sync (ElevenLabs)

Put your key in `.env` (copy `.env.example`; `ELEVENLABS_API_KEY=...`), restart `npm run dev`, then use the **Voice**
box at the top of the debug panel, or from the console: `await patient.say('Hello doctor, my chest hurts.')`.

How it works:
1. The browser calls `POST /api/voice/speak` on the dev server (`server/elevenlabs.js`). The server adds the key
   (it never reaches the browser) and calls ElevenLabs text-to-speech **with timestamps**: audio + start/end time of
   every character.
2. `src/voice.js` groups the characters into words with millisecond timings. `src/lipsync.js` then schedules the mouth:
   TalkingHead's English rules turn each word into visemes (mouth shapes), spread over that word's real time span at
   near full strength, and the jaw (`jawOpen`) follows the loudness of the actual audio plus a little extra on open
   vowels. The audio and this schedule go to TalkingHead together. (TalkingHead's own `speakAudio()` drives shapes at
   only ~0.6, which looked like barely moving lips.) Tune `LIPSYNC` in `src/config.js`: `gain`, `jawFromVoice`,
   `jawFromVowel`, `anticipation`.
3. Without a key a built-in demo voice (synthetic buzz timed from the text) is used, so the mouth pipeline can still be tried.

Settings in `.env`: `ELEVENLABS_VOICE_ID` (default: premade voice "Sarah"), `ELEVENLABS_MODEL`
(default `eleven_flash_v2_5`; `eleven_multilingual_v2` is higher quality). Requests are capped at 500 characters and
20 per minute, because a public tunnel link would otherwise let anyone spend your credits. Stop the tunnel when you
are not testing. Only English lip-sync is loaded (`lipsyncModules: ['en']` in `src/patient.js`). TalkingHead caps its animation step at
two frames, so below ~15 fps the mouth would lag the audio; on a normal laptop or the Vision Pro this does not happen.

For the full conversation (ElevenLabs Agents: speech in, LLM, speech out) the same two calls are the join point:
stream the agent's audio + alignment into `head.streamAudio()` and map `set_affect` tool calls to `setAffect()`.

## Agent control: personality, ranges, events, director

Everything on the body-language panel can be driven by an agent. The control surface is defined once in
`shared/agent-tools.js` (tool schemas in the Anthropic tool format) and executed by `src/agent.js`
(`window.patient.agent.execute(name, args)`, errors come back as `{ok:false, error}` with the valid values so the agent can
correct itself). `src/personality.js` is the layer behind it.

| Tool | What it does |
|---|---|
| `get_state`, `list_options` | current state / every valid value (emotions, personalities, behaviors with ranges, events) |
| `set_personality` | preset and/or Big Five traits (openness, conscientiousness, extraversion, agreeableness, neuroticism, 0..1), variability, start emotion |
| `define_personality` | create and save a NEW named personality type (traits, ranges, variability, default emotion, arms) and activate it |
| `set_behavior` | set fidget, footTap, legBounce, shift, lookAround, gazeStudent, blink, breath, headMotion, arms. Becomes the center; `exact: true` pins it |
| `set_behavior_range` | min/max per behavior. The live value drifts and reacts only inside it (min = max freezes it; `null` resets) |
| `set_affect` | emotion, intensity, gaze, gesture |
| `trigger_event` | sensitive_question, reassurance, accusation, interruption, long_silence, good_news, bad_news, rapport_built: she reacts according to her personality, then settles back |

How the numbers combine: emotion profile -> + traits -> + agent centers -> + event reactions (fade out) -> + slow drift
(`variability` x range width) -> clamped to the ranges. Slider pins in the panel win over all of it.
Presets: default, cooperative, anxious, guarded, hostile, depressed, talkative, evasive, distractible, stoic.
Personalities an agent defines are kept in the browser (localStorage).

**Director** (panel section "Director"): type what you want in plain language ("a guarded middle-aged man who avoids eye
contact and gets angry when asked about alcohol"). Claude decides which tools to call (`server/agent.js`, low effort, with a
safety-refusal fallback); the tools run in the browser and their results go back to Claude until it finishes. Two providers
(see `.env.example`):

- **Amazon Bedrock** (used automatically when AWS credentials are in `.env`): `@anthropic-ai/bedrock-sdk`
  (`AnthropicBedrockMantle`, the `bedrock-mantle` Messages API endpoint), model `anthropic.claude-opus-5-5` (override with
  `BEDROCK_MODEL`). Needs `AWS_REGION` or `AWS_DEFAULT_REGION` plus `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (and
  `AWS_SESSION_TOKEN` for temporary credentials), `AWS_BEARER_TOKEN_BEDROCK`, or `AWS_PROFILE`. A declined request is
  retried on `BEDROCK_FALLBACK_MODEL` (default `anthropic.claude-opus-4-8`) by the SDK's refusal-fallback middleware.
- **Claude API**: `ANTHROPIC_API_KEY`, model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`), server-side fallback.

`AGENT_PROVIDER=bedrock|anthropic` forces one; `ANTHROPIC_FALLBACKS=off` disables the fallback for both. Without
credentials a small offline rule set understands simple phrases. The endpoint is capped (12 requests per minute, size limits), as with the voice endpoint.

**Other agents:** the ElevenLabs conversation agent can register the same tools as client tools (same names and
parameters) and call `patient.agent.execute` from its handler. The schemas are plain JSON in `AGENT_TOOLS`.

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
