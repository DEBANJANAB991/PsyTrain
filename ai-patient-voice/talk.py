"""Talk with the patient using your microphone and speakers.

By default the microphone is muted while the patient speaks, so laptop speakers
don't feed her voice back in as a student turn. You can't interrupt her in this
mode. With headphones, run `python talk.py --headphones` to keep the mic open.
"""
import argparse
import json
import os
import queue
import signal
import time
from datetime import datetime
from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import Conversation
from elevenlabs.conversational_ai.default_audio_interface import DefaultAudioInterface

from settings import APP_DIR, api_key

# Keep the mic muted this long after the last audio chunk is written, to cover
# the output device's buffer and room echo.
ECHO_TAIL_SECONDS = 0.6


class EchoGatedAudioInterface(DefaultAudioInterface):
    """Sends silence instead of mic audio while the patient is speaking."""

    def start(self, input_callback):
        self._last_output = 0.0
        super().start(input_callback)

    def _output_thread(self):
        while not self.should_stop.is_set():
            try:
                audio = self.output_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            self._last_output = time.monotonic()
            self.out_stream.write(audio)
            self._last_output = time.monotonic()

    def _patient_speaking(self):
        return (
            not self.output_queue.empty()
            or time.monotonic() - self._last_output < ECHO_TAIL_SECONDS
        )

    def _in_callback(self, in_data, frame_count, time_info, status):
        if self.input_callback:
            self.input_callback(bytes(len(in_data)) if self._patient_speaking() else in_data)
        return (None, self.pyaudio.paContinue)


parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument(
    "--headphones",
    action="store_true",
    help="keep the mic open while the patient speaks (lets you interrupt her)",
)
args = parser.parse_args()
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
    audio_interface=DefaultAudioInterface() if args.headphones else EchoGatedAudioInterface(),
    callback_agent_response=on_patient,
    callback_user_transcript=on_student,
)

print("Patient session ready. Speak into your microphone; your speech appears as text.")
if args.headphones:
    print("Headphone mode: the mic stays open, so you can interrupt the patient. Ctrl+C to stop.")
else:
    print("Speaker mode: the mic is muted while the patient talks; wait for her to finish. Ctrl+C to stop.")
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
