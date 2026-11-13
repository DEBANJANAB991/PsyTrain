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

Agent creation stores the returned ID in `.env`. To edit Mary’s behavior, change `patient_prompt.txt`, then run `python update_agent.py`. Voice, speech recognition, turn-taking, models, opener, evaluations, and data collection are in `agent_config.py`.

By default `talk.py` mutes the microphone while the patient speaks, so her voice from the speakers isn't transcribed as your turn. Wait until she finishes before you answer. With headphones, run `python talk.py --headphones` to keep the mic open, so you can interrupt her. Your speech is transcribed live as the student turn. Session transcripts are written to `transcripts/`, which is ignored by Git.
