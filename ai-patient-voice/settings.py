"""Load settings from this folder's .env, falling back to the PsyTrain project's .env one level up."""
import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
ENV_PATH = APP_DIR / ".env"
PROJECT_ENV_PATH = APP_DIR.parent / ".env"
PLACEHOLDER = "sk_your_elevenlabs_api_key_here"

load_dotenv(ENV_PATH)
load_dotenv(PROJECT_ENV_PATH)  # does not override values already set above


def api_key():
    """ELEVENLABS_API_KEY, or the eleven_labs_api spelling used in the project .env."""
    for name in ("ELEVENLABS_API_KEY", "eleven_labs_api", "ELEVEN_LABS_API_KEY"):
        value = os.environ.get(name)
        if value and value != PLACEHOLDER:
            return value
    return None
