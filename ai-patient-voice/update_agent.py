"""Update an existing patient agent with the local prompt and configuration (default patient: Mary)."""
import argparse
import os

from elevenlabs.client import ElevenLabs

from orchestrator_link import custom_llm
from patients import PATIENTS
from settings import api_key

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--patient", choices=PATIENTS, default="mary", help="which patient to update (default: mary)")
patient = PATIENTS[parser.parse_args().patient]

key = api_key()
agent_id = os.environ.get(patient.env_key)
if not key or not agent_id:
    raise SystemExit(f"ELEVENLABS_API_KEY and {patient.env_key} must be set in .env")

client = ElevenLabs(api_key=key)
link = custom_llm(client) if patient.orchestrated else None
client.conversational_ai.agents.update(
    agent_id=agent_id,
    name=patient.agent_name,
    conversation_config=patient.conversation_config(custom_llm=link),
    platform_settings=patient.platform_settings(),
)
print(f"Agent configuration updated: {patient.agent_name}")
if patient.orchestrated:
    print("Answers now come from the orchestrator (prompts/). Run this again whenever the tunnel URL changes.")
