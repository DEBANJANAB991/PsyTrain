"""Create a patient agent and save its ID in .env (default patient: Mary)."""
import argparse
import os

from dotenv import set_key
from elevenlabs.client import ElevenLabs

from orchestrator_link import custom_llm
from patients import PATIENTS
from settings import ENV_PATH, api_key

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--patient", choices=PATIENTS, default="mary", help="which patient to create (default: mary)")
patient = PATIENTS[parser.parse_args().patient]

key = api_key()
if not key:
    raise SystemExit("ELEVENLABS_API_KEY is missing from .env (here or in the project .env)")
if os.environ.get(patient.env_key):
    raise SystemExit(f"{patient.env_key} already exists in .env; use update_agent.py --patient {patient.key} instead")

client = ElevenLabs(api_key=key)
agent = client.conversational_ai.agents.create(
    name=patient.agent_name,
    conversation_config=patient.conversation_config(custom_llm=custom_llm(client) if patient.orchestrated else None),
    platform_settings=patient.platform_settings(),
)

ENV_PATH.touch(exist_ok=True)
set_key(str(ENV_PATH), patient.env_key, agent.agent_id)
print(f"Agent created: {patient.agent_name}")
print(f"{patient.env_key} =", agent.agent_id)
if patient.env_key == "AGENT_ID":
    print("Agent ID saved to .env (the 3D app reads it from there).")
else:
    print(f"Agent ID saved to .env. Talk to it with: python talk.py --patient {patient.key}")
