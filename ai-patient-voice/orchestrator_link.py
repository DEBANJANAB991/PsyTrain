"""Connect an orchestrated ElevenLabs agent to the orchestrator (server/orchestrator.js in the 3D app).

ElevenLabs calls the orchestrator as its custom LLM, so it needs:
  - a public URL: ORCHESTRATOR_URL in .env, or else the running Cloudflare quick tunnel (found automatically).
    A quick tunnel gets a new address on every restart: run update_agent.py again after restarting cloudflared.
  - a shared token: ORCHESTRATOR_TOKEN in .env (created on first use). ElevenLabs stores it as a workspace secret
    and sends it as "Authorization: Bearer ..."; the orchestrator rejects calls without it.
"""
import json
import os
import secrets
import urllib.error
import urllib.request

from dotenv import set_key

from settings import ENV_PATH

SECRET_NAME = "psytrain_orchestrator_token"
ROUTE = "/api/llm/v1"          # ElevenLabs appends /chat/completions


def _get_json(url):
    """GET a local cloudflared metrics endpoint; its /ready answers 503 with a JSON body when not connected."""
    try:
        with urllib.request.urlopen(url, timeout=1) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {}
    except Exception:
        return None


def _quick_tunnel_url():
    """A running cloudflared quick tunnel that is connected to Cloudflare, from its local metrics server
    (ports 20241-20250). A tunnel with 0 connections is skipped: its address no longer resolves."""
    for port in range(20241, 20251):
        info = _get_json(f"http://127.0.0.1:{port}/quicktunnel")
        if not info or not info.get("hostname"):
            continue
        ready = _get_json(f"http://127.0.0.1:{port}/ready") or {}
        if ready.get("readyConnections", 0) > 0:
            return f"https://{info['hostname']}"
        print(f"Skipping tunnel {info['hostname']}: not connected to Cloudflare")
    return None


def public_url():
    base = os.environ.get("ORCHESTRATOR_URL") or _quick_tunnel_url()
    if not base:
        raise SystemExit(
            "No public URL for the orchestrator. Start the tunnel (cloudflared tunnel --url http://localhost:5173) "
            "or set ORCHESTRATOR_URL in .env, then run this again."
        )
    return base.rstrip("/").removesuffix(ROUTE) + ROUTE


def token():
    value = os.environ.get("ORCHESTRATOR_TOKEN")
    if not value:
        value = secrets.token_urlsafe(32)
        ENV_PATH.touch(exist_ok=True)
        set_key(str(ENV_PATH), "ORCHESTRATOR_TOKEN", value)
        os.environ["ORCHESTRATOR_TOKEN"] = value
        print("Created ORCHESTRATOR_TOKEN in ai-patient-voice/.env")
    return value


def _secret_id(client, value):
    """Create or update the ElevenLabs workspace secret that holds the token."""
    existing = next((s for s in client.conversational_ai.secrets.list(search=SECRET_NAME).secrets if s.name == SECRET_NAME), None)
    if existing:
        client.conversational_ai.secrets.update(existing.secret_id, name=SECRET_NAME, value=value)
        return existing.secret_id
    return client.conversational_ai.secrets.create(name=SECRET_NAME, value=value).secret_id


def custom_llm(client):
    """The custom_llm block for the agent config (and prints where the agent will send its requests)."""
    url = public_url()
    print(f"Orchestrator endpoint: {url}/chat/completions")
    return {
        "url": url,
        "model_id": "psytrain-orchestrator",
        "api_key": {"secret_id": _secret_id(client, token())},
        "api_type": "chat_completions",
    }
