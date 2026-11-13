import json
import re
from pathlib import Path

PATIENT_NAME = "Mary Keller"
AGENT_NAME = "Patient - Mary Keller"
VOICE_ID = "cgSgspJ2msm6clMCkdW9"
FIRST_MESSAGE = "Hello"
# Mary's earlier single prompt: only used if MARY.orchestrated is set to False in patients.py
PROMPT_PATH = Path(__file__).resolve().parent / "patient_prompt.txt"
# Mary's prompts for the orchestrator (server/orchestrator.js): shared guardrails, one prompt per mode,
# the orchestrator's decision rules and the memory saver. The server reads them on every answer.
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def orchestrated_prompt():
    """What the ElevenLabs dashboard shows for an orchestrated agent (the first situation's normal prompt, as the
    first persona). The orchestrator replaces it on every answer, per patient and situation (prompts/personas.json)."""
    personas = json.loads((PROMPTS_DIR / "personas.json").read_text(encoding="utf-8"))
    situation, sit = next(iter(personas["situations"].items()))
    person = next(iter(sit["personas"].values()))
    values = {"about": "", "she": "she", "her": "her", "hers": "her", "She": "She", **person}
    parts = [(PROMPTS_DIR / situation / f"{name}.txt").read_text(encoding="utf-8").strip() for name in ("guardrails", "normal")]
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(values.get(m.group(1), m.group(0))), "\n\n".join(parts))


def conversation_config(system_prompt, voice_id=VOICE_ID, first_message=FIRST_MESSAGE, tts=None, custom_llm=None):
    """Agent conversation settings. `tts` overrides voice settings such as speed or stability.
    `custom_llm` = {url, ...}: the agent's answers come from that endpoint (the orchestrator) instead of a hosted LLM."""
    return {
        "asr": {
            "quality": "high",
            "provider": "scribe_realtime",
            "user_input_audio_format": "pcm_16000",
        },
        "turn": {
            "turn_timeout": 30,
            "turn_eagerness": "normal",  # "eager" can cut the student off mid-question
            "mode": "turn",
            "speculative_turn": True,
            "turn_model": "turn_v3",
            "retranscribe_on_turn_timeout": False,
        },
        "tts": {
            "model_id": "eleven_flash_v2",
            "voice_id": voice_id,
            "agent_output_audio_format": "pcm_16000",
            "stability": 0.5,
            "speed": 1,
            "similarity_boost": 0.8,
            "text_normalisation_type": "system_prompt",
            "enable_phoneme_tags": True,
            **(tts or {}),
        },
        "conversation": {
            "text_only": False,
            "max_duration_seconds": 600,
        },
        "vad": {
            "background_voice_detection": True,
        },
        "agent": {
            "first_message": first_message,
            "language": "en",
            "disable_first_message_interruptions": False,
            "prompt": {
                "prompt": system_prompt,
                # gpt-4o-mini ignores the disclosure rules too easily.
                # This model name worked in your earlier agent config.
                "llm": "claude-sonnet-5-5",
                "service_tier": "standard",
                "temperature": 0.6,  # 0 makes every tangent the same
                "max_tokens": 180,
                "tool_ids": [],
                "tool_ids_strict": False,
                "ignore_default_personality": True,
                "enable_parallel_tool_calls": True,
                **({"llm": "custom-llm", "custom_llm": custom_llm} if custom_llm else {}),
            },
        },
    }


def criterion(id, name, goal):
    """One binary ElevenLabs evaluation criterion, judged over the whole conversation."""
    return {
        "id": id,
        "name": name,
        "type": "prompt",
        "conversation_goal_prompt": goal,
        "use_knowledge_base": False,
        "scope": "conversation",
        "scoring_mode": "binary",
        "max_score": 100,
    }


def data_field(name, type, description, enum=None):
    """One ElevenLabs data collection field."""
    field = {"type": type, "description": description}
    if enum:
        field["enum"] = enum
    field["name"] = name
    return field


MARY_EVALUATION = [
    criterion(
        "rapport_and_de_escalation",
        "Rapport and De-escalation",
        "Did the therapist respond empathetically to Mary's tangents "
        "and stay engaged with her without being judgmental?",
    ),
    criterion(
        "empathy_and_validation",
        "Empathy and Validation",
        "Did the therapist validate Mary's feelings and avoid "
        "clinical jargon?",
    ),
    criterion(
        "vulnerability_unlocked",
        "Unlocked Vulnerability",
        "Did the therapist use concrete, nonjudgmental follow-up "
        "questions to explore Mary's drinking patterns, attempts to "
        "cut down, and arguments with Lena?",
    ),
]

MARY_DATA_COLLECTION = {
    "therapist_approach": data_field(
        "therapist_approach",
        "string",
        "The primary approach the therapist used with Mary.",
        ["empathetic_validation", "logical_explanation", "confrontational", "passive_listening"],
    ),
    "mary_discussed_drinking": data_field(
        "mary_discussed_drinking",
        "boolean",
        "Whether Mary discussed her drinking patterns or attempts to "
        "cut down in response to specific questions.",
    ),
    "jargon_used": data_field(
        "jargon_used", "boolean", "Whether the therapist used jargon that confused Mary."
    ),
    "session_outcome_summary": data_field(
        "session_outcome_summary", "string", "A brief summary of rapport and the session outcome."
    ),
}

WIDGET = {
    "variant": "full",
    "placement": "bottom-right",
    "expandable": "never",
    "avatar": {"type": "orb", "color_1": "#2792dc", "color_2": "#9ce6e6"},
    "feedback_mode": "none",
    "end_feedback": {"type": "rating"},
    "bg_color": "#ffffff",
    "text_color": "#000000",
    "btn_color": "#000000",
    "btn_text_color": "#ffffff",
    "border_color": "#e1e1e1",
    "focus_color": "#000000",
    "show_conversation_id": True,
    "mic_muting_enabled": True,
    "transcript_enabled": True,
    "text_input_enabled": True,
    "show_resize_button": True,
    "mobile_fullscreen": True,
    "supports_text_only": True,
}


def platform_settings(evaluation, data_collection, orchestrated=False):
    """Platform settings shared by every patient agent; only evaluation and data collection differ.
    `orchestrated`: let the app pass its session (id, patient, situation) to the orchestrator
    (custom_llm_extra_body) and set the voice and the opener per conversation (prompts/personas.json)."""
    return {
        **({"overrides": {
            "custom_llm_extra_body": True,
            "conversation_config_override": {"tts": {"voice_id": True}, "agent": {"first_message": True}},
        }} if orchestrated else {}),
        "evaluation": {"criteria": evaluation},
        "widget": WIDGET,
        "data_collection": data_collection,
        "data_collection_scopes": {key: "conversation" for key in data_collection},
        "auth": {"enable_auth": False, "require_origin_header": False},
        "call_limits": {"agent_concurrency_limit": -1, "daily_limit": 100000, "bursting_enabled": True},
        "queueing_config": {"enabled": True, "wait_timeout_seconds": 180},
        "privacy": {
            "record_voice": True,
            "retention_days": -1,
            "delete_transcript_and_pii": False,
            "delete_audio": False,
            "zero_retention_mode": False,
        },
        "trust_context": "high",
        "analysis_llm": "gemini-2.5-flash",
        "topic_discovery": {"enabled": True},
        "sentiment_analysis": {"enabled": True},
    }


PLATFORM_SETTINGS = platform_settings(MARY_EVALUATION, MARY_DATA_COLLECTION)
