# AI Patient Voice (ElevenLabs)

Standalone microphone-based voice patient for the PsyTrain project.

## Setup (macOS)

```bash
brew install portaudio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Add your ElevenLabs API key to `.env`. Never commit `.env`. If this folder's `.env` has no key, the scripts use the
one in the PsyTrain project's `.env` (`ELEVENLABS_API_KEY` or `eleven_labs_api`).

The 3D app (project root) uses this agent for live conversations: after `create_agent.py`, pick a patient and
situation on the landing page, enter the room and click "Talk to the patient". Mary speaks through the avatar, and a
separate director agent changes her body language to match what she says. See the project README, "Live conversation".

## Run

```bash
python check_key.py
python create_agent.py
python talk.py
```

Agent creation stores the returned ID in `.env`. Voice, speech recognition, turn-taking, opener, evaluations, and data collection are in `agent_config.py`.

**The 3D app's agent is orchestrated.** The `AGENT_ID` agent uses a custom LLM: the orchestrator in the 3D app (`server/orchestrator.js`) writes every answer and switches the patient between a normal mode and the situation's behaviour mode during the conversation. Who the patient is depends on the landing-page choice (`prompts/personas.json`):

| Landing page | Distracted | Aggressive | Voice |
|---|---|---|---|
| Woman | Mary Keller | Lisa Fischer | Jessica |
| Man | Mark Keller | Ryan Fischer | Liam |
| Man in a wheelchair | Mark Keller | Ryan Fischer | Will |

The app sets the voice and the opener per conversation (ElevenLabs overrides, enabled by `update_agent.py`). Each situation has its own prompt folder, with `{{placeholders}}` filled from `personas.json`:

| `prompts/distracted/` | `prompts/aggressive/` | What it is |
|---|---|---|
| `guardrails.txt` | `guardrails.txt` | Who the patient is, what they share and when, the rules for every mode |
| `normal.txt` | `normal.txt` | Answering directly / guarded but answering |
| `distracted.txt` | `aggressive.txt` | The behaviour mode: tangents / irritated and confrontational |
| `orchestrator.txt` | `orchestrator.txt` | When to switch (into the behaviour on natural triggers, back after interventions or de-escalation) |
| `memory.txt` | `memory.txt` | The running summary both modes get |
| `distractions.txt` | | Things that can catch the patient's attention; 5 are picked at random per conversation |

The aggressive prompts are built from `aggressive_patient_prompt.txt` (its template fields are in `personas.json`) and the Ryan persona. A new situation = a new folder with these files plus an entry in `personas.json` and in `SITUATIONS` (`src/cases.js`). The orchestrator reads the prompts on every answer, so edits apply right away. So the agent can reach the orchestrator, the 3D app's dev server and the Cloudflare tunnel must be running when you run `update_agent.py` / `create_agent.py` (they find the tunnel URL, create `ORCHESTRATOR_TOKEN` here and store it as an ElevenLabs secret) and while you talk, also with `talk.py`. A quick tunnel gets a new URL on every restart: run `python update_agent.py` again then. Say "Bingo" to flip the mode when testing. `patient_prompt.txt` is Mary's earlier single prompt, kept for reference only. `talk.py` talks to the default (woman, distracted).

## More patients

Besides Mary there are three more patients, each its own agent with its own prompt, voice, evaluation and data collection
(`patients.py`, prompts in `patients/`). Background, sources and the matching avatar and body language are in
`patients/PERSONAS.md`.

| `--patient` | Patient | Avatar in the 3D app | Prompt |
|---|---|---|---|
| `mary` (default) | Mary Keller, talkative, minimises her drinking | `young-woman` | `patient_prompt.txt` |
| `ryan` | Ryan Fischer, irritable, depressed, sent by his employer | `young-man` | `patients/ryan_fischer.txt` |
| `sophie` | Sophie Lang, socially anxious | `young-woman` | `patients/sophie_lang.txt` |
| `tom` | Tom Becker, withdrawn after a spinal cord injury | `man-wheelchair` | `patients/tom_becker.txt` |

```bash
python create_agent.py --patient ryan     # saves AGENT_ID_RYAN in .env
python talk.py --patient ryan
python update_agent.py --patient ryan     # after editing the prompt or patients.py
```

The 3D app still uses `AGENT_ID` (Mary) only; `patients/PERSONAS.md` lists what wiring the others in would take.

By default `talk.py` mutes the microphone while the patient speaks, so her voice from the speakers isn't transcribed as your turn. Wait until she finishes before you answer. With headphones, run `python talk.py --headphones` to keep the mic open, so you can interrupt her. Your speech is transcribed live as the student turn. Session transcripts are written to `transcripts/`, which is ignored by Git.
