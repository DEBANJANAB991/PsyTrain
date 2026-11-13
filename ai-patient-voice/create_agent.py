"""Create the Mary patient agent and save its ID in .env."""
import os

from dotenv import set_key
from elevenlabs.client import ElevenLabs

from agent_config import AGENT_NAME, PLATFORM_SETTINGS, PROMPT_PATH, conversation_config
from settings import ENV_PATH, api_key

key = api_key()
if not key:
    raise SystemExit("ELEVENLABS_API_KEY is missing from .env (here or in the project .env)")
if os.environ.get("AGENT_ID"):
    raise SystemExit("AGENT_ID already exists in .env; use update_agent.py instead")

client = ElevenLabs(api_key=key)
agent = client.conversational_ai.agents.create(
    name=AGENT_NAME,
    conversation_config=conversation_config(PROMPT_PATH.read_text(encoding="utf-8")),
    platform_settings=PLATFORM_SETTINGS,
)

ENV_PATH.touch(exist_ok=True)
set_key(str(ENV_PATH), "AGENT_ID", agent.agent_id)
print("Agent created.")
print("AGENT_ID =", agent.agent_id)
print("Agent ID saved to .env (the 3D app reads it from there).")
