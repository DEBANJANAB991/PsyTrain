"""Patient personas. Each one is a separate ElevenLabs agent with its own prompt, voice and evaluation.

`avatar` is the patient key of the 3D app (PATIENT_OPTIONS in src/cases.js, PATIENTS in src/config.js) and
`situation` the SITUATIONS key whose body language fits the persona. The 3D app itself still talks to
AGENT_ID (Mary) only. Background and sources for each persona: patients/PERSONAS.md.
"""
from dataclasses import dataclass, field
from pathlib import Path

from agent_config import (
    FIRST_MESSAGE,
    MARY_DATA_COLLECTION,
    MARY_EVALUATION,
    PATIENT_NAME,
    PROMPT_PATH,
    VOICE_ID,
    conversation_config,
    criterion,
    data_field,
    orchestrated_prompt,
    platform_settings,
)

PATIENTS_DIR = Path(__file__).resolve().parent / "patients"


@dataclass(frozen=True)
class Patient:
    key: str
    name: str
    prompt_path: Path
    voice_id: str
    env_key: str          # .env variable that stores this patient's agent ID
    avatar: str
    situation: str
    evaluation: list
    data_collection: dict
    first_message: str = FIRST_MESSAGE
    tts: dict = field(default_factory=dict)
    # True: the answers come from the orchestrator (server/orchestrator.js, prompts in prompts/), which switches
    # between a normal and a distracted prompt during the conversation. False: one fixed prompt (prompt_path).
    orchestrated: bool = False

    @property
    def agent_name(self):
        return f"Patient - {self.name}"

    def conversation_config(self, custom_llm=None):
        prompt = orchestrated_prompt() if self.orchestrated else self.prompt_path.read_text(encoding="utf-8")
        return conversation_config(prompt, self.voice_id, self.first_message, self.tts,
                                   custom_llm=custom_llm if self.orchestrated else None)

    def platform_settings(self):
        return platform_settings(self.evaluation, self.data_collection, orchestrated=self.orchestrated)


def approach_field(name, options):
    return data_field("therapist_approach", "string", f"The primary approach the therapist used with {name}.", options)


def summary_field():
    return data_field("session_outcome_summary", "string", "A brief summary of rapport and the session outcome.")


MARY = Patient(
    key="mary",
    name=PATIENT_NAME,
    prompt_path=PROMPT_PATH,
    voice_id=VOICE_ID,              # Jessica: young, playful, warm
    env_key="AGENT_ID",            # the ID the 3D app uses
    avatar="young-woman",
    situation="distracted",
    evaluation=MARY_EVALUATION,
    data_collection=MARY_DATA_COLLECTION,
    orchestrated=True,              # normal / distracted modes, see prompts/ and server/orchestrator.js
)

RYAN = Patient(
    key="ryan",
    name="Ryan Fischer",
    prompt_path=PATIENTS_DIR / "ryan_fischer.txt",
    voice_id="TX3LPaxmHKxFdv7VOQHJ",  # Liam: young, confident. "Harry" (SOYHLrjzK2X1ezoPC6cr) sounds rougher.
    env_key="AGENT_ID_RYAN",
    avatar="young-man",
    situation="aggressive",
    first_message="Hi.",
    tts={"stability": 0.45},
    evaluation=[
        criterion(
            "de_escalation",
            "De-escalation",
            "Did the therapist stay calm and nonjudgmental when Ryan was sarcastic or hostile, "
            "without arguing, lecturing or becoming defensive?",
        ),
        criterion(
            "autonomy_support",
            "Autonomy Support",
            "Did the therapist acknowledge that Ryan was sent by his employer and give him a say "
            "in what to talk about, for example by asking permission before personal topics?",
        ),
        criterion(
            "depression_exploration",
            "Exploration of Mood",
            "Did the therapist use concrete questions to explore Ryan's sleep, energy, interests "
            "and mood, without labelling him as angry or depressed?",
        ),
        criterion(
            "suicide_risk_screening",
            "Suicide Risk Screening",
            "Did the therapist ask Ryan directly and calmly about thoughts of death or suicide, "
            "and follow up on plans, intent and reasons for living?",
        ),
    ],
    data_collection={
        "therapist_approach": approach_field(
            "Ryan", ["autonomy_supportive", "empathetic_reflection", "lecturing", "confrontational", "passive_listening"]
        ),
        "ryan_final_irritation": data_field(
            "ryan_final_irritation",
            "string",
            "How irritated Ryan was at the end of the session.",
            ["hostile", "curt", "grudging", "open"],
        ),
        "ryan_disclosed_passive_suicidal_thoughts": data_field(
            "ryan_disclosed_passive_suicidal_thoughts",
            "boolean",
            "Whether Ryan told the therapist about his thoughts that it wouldn't matter if he didn't wake up.",
        ),
        "labels_used": data_field(
            "labels_used",
            "boolean",
            "Whether the therapist used labels or jargon such as 'anger issues' or 'depression' about Ryan.",
        ),
        "session_outcome_summary": summary_field(),
    },
)

SOPHIE = Patient(
    key="sophie",
    name="Sophie Lang",
    prompt_path=PATIENTS_DIR / "sophie_lang.txt",
    voice_id="EXAVITQu4vr4xnSDxMaL",  # Sarah: young, soft
    env_key="AGENT_ID_SOPHIE",
    avatar="young-woman",
    situation="anxious",           # not in src/cases.js yet; see patients/PERSONAS.md
    tts={"speed": 0.92, "stability": 0.4},
    evaluation=[
        criterion(
            "safety_and_pacing",
            "Safety and Pacing",
            "Did the therapist keep a calm, unhurried pace and help Sophie feel safe, for example by "
            "explaining what would happen, normalising her nervousness or giving her time?",
        ),
        criterion(
            "open_questions",
            "Open Questions",
            "Did the therapist mostly use simple open questions instead of rapid series of closed questions?",
        ),
        criterion(
            "avoidance_exploration",
            "Exploration of Fear and Avoidance",
            "Did the therapist explore which situations Sophie fears or avoids, what she does to cope "
            "in them, and how this affects her studies?",
        ),
        criterion(
            "no_spotlighting",
            "No Spotlighting",
            "Did the therapist avoid drawing attention to Sophie's blushing or nervousness in a way "
            "that embarrassed her?",
        ),
    ],
    data_collection={
        "therapist_approach": approach_field(
            "Sophie", ["warm_and_paced", "normalising", "rapid_closed_questions", "evaluative", "passive_listening"]
        ),
        "sophie_discussed_avoidance": data_field(
            "sophie_discussed_avoidance",
            "boolean",
            "Whether Sophie described situations she avoids, such as seminars, presentations or phone calls.",
        ),
        "sophie_described_safety_behaviours": data_field(
            "sophie_described_safety_behaviours",
            "boolean",
            "Whether Sophie described things she does to hide her anxiety, such as rehearsing sentences, "
            "writing scripts or hiding her blushing.",
        ),
        "session_outcome_summary": summary_field(),
    },
)

TOM = Patient(
    key="tom",
    name="Tom Becker",
    prompt_path=PATIENTS_DIR / "tom_becker.txt",
    voice_id="bIHbv24MWmeRgasZH58o",  # Will: young, relaxed, low-key
    env_key="AGENT_ID_TOM",
    avatar="man-wheelchair",
    situation="withdrawn",         # not in src/cases.js yet; see patients/PERSONAS.md
    tts={"speed": 0.9, "stability": 0.6},
    evaluation=[
        criterion(
            "person_first",
            "Person, Not Disability",
            "Did the therapist treat Tom as a person rather than a disability, avoiding pity, assumptions "
            "and phrases such as 'confined to a wheelchair'?",
        ),
        criterion(
            "space_and_reflection",
            "Space and Reflection",
            "Did the therapist give Tom room after difficult questions and reflect his feelings, instead of "
            "rushing on, giving advice or cheering him up?",
        ),
        criterion(
            "depression_exploration",
            "Exploration of Mood",
            "Did the therapist explore Tom's mood, loss of interests, sleep, withdrawal from friends and "
            "feeling of being a burden?",
        ),
        criterion(
            "suicide_risk_screening",
            "Suicide Risk Screening",
            "Did the therapist ask Tom directly about past or current thoughts of suicide?",
        ),
    ],
    data_collection={
        "therapist_approach": approach_field(
            "Tom", ["empathetic_reflection", "person_centred_curiosity", "advice_or_cheerleading", "pity", "passive_listening"]
        ),
        "disability_focused_pity": data_field(
            "disability_focused_pity",
            "boolean",
            "Whether the therapist expressed pity or made assumptions about Tom's wheelchair or injury.",
        ),
        "tom_disclosed_burden": data_field(
            "tom_disclosed_burden",
            "boolean",
            "Whether Tom said he feels useless or like a burden to Anna.",
        ),
        "session_outcome_summary": summary_field(),
    },
)

PATIENTS = {p.key: p for p in (MARY, RYAN, SOPHIE, TOM)}
