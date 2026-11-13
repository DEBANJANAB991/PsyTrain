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

Add your ElevenLabs API key to `.env`. Never commit `.env`.

## Run

```bash
python check_key.py
python create_agent.py
python talk.py
```

Agent creation stores the returned ID in `.env`. To edit Mary’s behavior, change `patient_prompt.txt`, then run `python update_agent.py`. Voice, speech recognition, turn-taking, models, opener, evaluations, and data collection are in `agent_config.py`.

By default `talk.py` mutes the microphone while the patient speaks, so her voice from the speakers isn't transcribed as your turn. Wait until she finishes before you answer. With headphones, run `python talk.py --headphones` to keep the mic open, so you can interrupt her. Your speech is transcribed live as the student turn. Session transcripts are written to `transcripts/`, which is ignored by Git.
