from pathlib import Path

PATIENT_NAME = "Mary Keller"
AGENT_NAME = "Patient - Mary Keller"
VOICE_ID = "cgSgspJ2msm6clMCkdW9"
FIRST_MESSAGE = "Hello"
PROMPT_PATH = Path(__file__).resolve().parent / "patient_prompt.txt"


def conversation_config(system_prompt):
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
            "voice_id": VOICE_ID,
            "agent_output_audio_format": "pcm_16000",
            "stability": 0.5,
            "speed": 1,
            "similarity_boost": 0.8,
            "text_normalisation_type": "system_prompt",
            "enable_phoneme_tags": True,
        },
        "conversation": {
            "text_only": False,
            "max_duration_seconds": 600,
        },
        "vad": {
            "background_voice_detection": True,
        },
        "agent": {
            "first_message": FIRST_MESSAGE,
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
            },
        },
    }


PLATFORM_SETTINGS = {
    "evaluation": {
        "criteria": [
            {
                "id": "rapport_and_de_escalation",
                "name": "Rapport and De-escalation",
                "type": "prompt",
                "conversation_goal_prompt": (
                    "Did the therapist respond empathetically to Mary's tangents "
                    "and stay engaged with her without being judgmental?"
                ),
                "use_knowledge_base": False,
                "scope": "conversation",
                "scoring_mode": "binary",
                "max_score": 100,
            },
            {
                "id": "empathy_and_validation",
                "name": "Empathy and Validation",
                "type": "prompt",
                "conversation_goal_prompt": (
                    "Did the therapist validate Mary's feelings and avoid "
                    "clinical jargon?"
                ),
                "use_knowledge_base": False,
                "scope": "conversation",
                "scoring_mode": "binary",
                "max_score": 100,
            },
            {
                "id": "vulnerability_unlocked",
                "name": "Unlocked Vulnerability",
                "type": "prompt",
                "conversation_goal_prompt": (
                    "Did the therapist use concrete, nonjudgmental follow-up "
                    "questions to explore Mary's drinking patterns, attempts to "
                    "cut down, and arguments with Lena?"
                ),
                "use_knowledge_base": False,
                "scope": "conversation",
                "scoring_mode": "binary",
                "max_score": 100,
            },
        ]
    },
    "widget": {
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
    },
    "data_collection": {
        "therapist_approach": {
            "type": "string",
            "description": "The primary approach the therapist used with Mary.",
            "enum": [
                "empathetic_validation",
                "logical_explanation",
                "confrontational",
                "passive_listening",
            ],
            "name": "therapist_approach",
        },
        "mary_discussed_drinking": {
            "type": "boolean",
            "description": (
                "Whether Mary discussed her drinking patterns or attempts to "
                "cut down in response to specific questions."
            ),
            "name": "mary_discussed_drinking",
        },
        "jargon_used": {
            "type": "boolean",
            "description": "Whether the therapist used jargon that confused Mary.",
            "name": "jargon_used",
        },
        "session_outcome_summary": {
            "type": "string",
            "description": "A brief summary of rapport and the session outcome.",
            "name": "session_outcome_summary",
        },
    },
    "data_collection_scopes": {
        "therapist_approach": "conversation",
        "mary_discussed_drinking": "conversation",
        "jargon_used": "conversation",
        "session_outcome_summary": "conversation",
    },
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