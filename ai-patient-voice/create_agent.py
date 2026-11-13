"""Create the Mary patient agent and save its ID in .env."""
import os
from pathlib import Path

from dotenv import load_dotenv, set_key
from elevenlabs.client import ElevenLabs

from agent_config import AGENT_NAME, PLATFORM_SETTINGS, PROMPT_PATH, conversation_config

APP_DIR = Path(__file__).resolve().parent
ENV_PATH = APP_DIR / ".env"
load_dotenv(ENV_PATH)

api_key = os.environ.get("ELEVENLABS_API_KEY")
if not api_key:
    raise SystemExit("ELEVENLABS_API_KEY is missing from .env")
if os.environ.get("AGENT_ID"):
    raise SystemExit("AGENT_ID already exists in .env; use update_agent.py instead")

client = ElevenLabs(api_key=api_key)
agent = client.conversational_ai.agents.create(
    name=AGENT_NAME,
    conversation_config=conversation_config(PROMPT_PATH.read_text(encoding="utf-8")),
    platform_settings=PLATFORM_SETTINGS,
)

set_key(str(ENV_PATH), "AGENT_ID", agent.agent_id)
print("Agent created.")
print("AGENT_ID =", agent.agent_id)
print("Agent ID saved to .env.")
