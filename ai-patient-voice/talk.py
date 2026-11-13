"""Talk with the patient using your microphone and speakers."""
import json
import os
import signal
from datetime import datetime
from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import Conversation
from elevenlabs.conversational_ai.default_audio_interface import DefaultAudioInterface

from settings import APP_DIR, api_key

client = ElevenLabs(api_key=api_key())
agent_id = os.environ["AGENT_ID"]

transcript = []


def on_patient(text):
    print(f"\nPATIENT: {text}")
    transcript.append({"role": "patient", "text": text})


def on_student(text):
    print(f"\nYOU (speech-to-text): {text}")
    transcript.append({"role": "student", "text": text})


conversation = Conversation(
    client,
    agent_id,
    requires_auth=True,
    audio_interface=DefaultAudioInterface(),
    callback_agent_response=on_patient,
    callback_user_transcript=on_student,
)

print("Patient session ready. Speak into your microphone; your speech appears as text.")
print("Use headphones to prevent the microphone from picking up the patient's audio. Ctrl+C to stop.")
conversation.start_session()
signal.signal(signal.SIGINT, lambda sig, frame: conversation.end_session())
conversation_id = conversation.wait_for_session_end()

transcript_dir = APP_DIR / "transcripts"
transcript_dir.mkdir(exist_ok=True)
out = transcript_dir / f"{datetime.now():%Y%m%d_%H%M%S}.json"
out.write_text(
    json.dumps({"conversation_id": conversation_id, "turns": transcript}, indent=2),
    encoding="utf-8",
)
print(f"\nSession ended. Transcript saved to {out}")
