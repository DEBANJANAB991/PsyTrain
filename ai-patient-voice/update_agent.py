"""Update the existing agent with the local prompt and configuration."""
import os
from pathlib import Path

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

from agent_config import AGENT_NAME, PLATFORM_SETTINGS, PROMPT_PATH, conversation_config

APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env")

api_key = os.environ.get("ELEVENLABS_API_KEY")
agent_id = os.environ.get("AGENT_ID")
if not api_key or not agent_id:
    raise SystemExit("ELEVENLABS_API_KEY and AGENT_ID must be set in .env")

client = ElevenLabs(api_key=api_key)
client.conversational_ai.agents.update(
    agent_id=agent_id,
    name=AGENT_NAME,
    conversation_config=conversation_config(PROMPT_PATH.read_text(encoding="utf-8")),
    platform_settings=PLATFORM_SETTINGS,
)
print("Agent configuration updated.")
