"""List available voices in the configured ElevenLabs account."""
import os

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv()
client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])

result = client.voices.search(page_size=100)
for voice in result.voices:
    labels = voice.labels or {}
    info = ", ".join(f"{key}={value}" for key, value in labels.items())
    print(f"{voice.voice_id}  {voice.name:<25} {info}")
