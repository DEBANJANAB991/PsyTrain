# 3-minute pitch: speaker script

Open `pitch/index.html` in Chrome. Press **F** for fullscreen, **→ / Space** for the next slide (the timer starts on the
first press), **N** to show these notes, **K** or a click to pause or resume a video. Videos play automatically on their slide.

| # | Time | Slide | What you say |
|---|---|---|---|
| 1 | 0:00–0:15 | Title | "Hi, we're [team]. Every medical and psychology student has to learn to take a history from patients who don't cooperate. Today that's learned from a textbook or on real patients. We built a patient you can practise on as often as you like." |
| 2 | 0:15–0:35 | Problem | "The hardest part is the difficult patient: one who keeps drifting off, or one who gets hostile. Actors are expensive, you can't repeat a case ten times, and afterwards nobody tells you which sentence went wrong." |
| 3 | 0:35–0:50 | Build a case | "You build a case in three clicks: the patient, their Big Five personality, and the situation to train. Then you're in a 3D consultation room in the browser, built on WebXR for Vision Pro, with the SKID interview form next to the patient." |
| 4 | 0:50–1:45 | **Video: Mary, distracted** (53 s) | Stay quiet for her first answer. Then, over the second half: "Top left is our orchestrator. It decides her mode before every answer. An open question made her drift, and the light bulb shows three strategies. The student names the drift and repeats the question, and she comes back." |
| 5 | 1:45–2:15 | **Video: Ryan, aggressive** (starts at 0:13, about 29 s) | "Same system, different patient. 'Calm down, you have anger issues' is a classic mistake: he switches to aggressive and crosses his arms. The student names the feeling and gives him control, and he de-escalates." |
| 6 | 2:15–2:40 | Feedback | "Click End session and MIRROR reviews the transcript: ten communication skills, what the patient revealed and what you missed, and the exact turn where it went wrong, with a better sentence to try. Then you press Try again." |
| 7 | 2:40–2:52 | How it works | "ElevenLabs listens and speaks. Our orchestrator on Bedrock uses a fast Claude model to pick the mode and a second model to write the answer, with a running memory. Each answer carries a body cue, so the gesture lands on the first word." |
| 8 | 2:52–3:00 | Close | "Practise, get feedback, try again. Next: more traits, more situations, and a classroom test on Vision Pro. Thank you." |

If you are running long, cut slide 2 to a single sentence. The video slides can't be shortened while you're presenting.

## How the media was made (for judges' questions)

- **Patient answers are real model output.** Both conversations were run through the project's own orchestrator
  (`/api/llm/v1/chat/completions` → Claude on Amazon Bedrock) with the real prompts in `ai-patient-voice/prompts/`.
  The mode labels and the "Why:" lines in the videos are the orchestrator's own decisions and reasons, copied verbatim.
  Raw transcripts: `media/transcript-distracted.json`, `media/transcript-aggressive.json`.
- **The student's lines were typed, not spoken.** The student is voiced by ElevenLabs TTS (voice "George") instead of a
  live microphone, so the clip has clear audio. The patients use the voices the app assigns (Jessica for Mary, Liam for Ryan).
- **The 3D footage is the real app.** It was recorded from the WebGL canvas of `consult.html` (with `&hints=1`) on an
  RTX 5070 Ti. The app's own lip-sync, body states (`set_state`), body cues and hint board are used. The answers were
  replayed into the avatar after they were generated, so the LLM wait between turns is cut out.
- **The distracted run was chosen from 4 runs.** Mary drifted in 1 of the 4 runs with this script; the drift is
  intentionally stochastic. For a **live** demo, saying the word "Bingo" always flips the mode (see README).
- **The feedback screenshots are the built-in sample report** (`src/mirror/demo.js`, labelled "Demo assessment" in the
  UI). The MIRROR assessment backend was not running when these were captured, so they do not show a scored real session.
