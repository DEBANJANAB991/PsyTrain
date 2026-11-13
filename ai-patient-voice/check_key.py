"""Check the API key and account credits."""
import os

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv()
client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])

sub = client.user.subscription.get()
print("Plan:          ", sub.tier)
print("Credits used:  ", sub.character_count)
print("Credits limit: ", sub.character_limit)
print("Credits left:  ", sub.character_limit - sub.character_count)
