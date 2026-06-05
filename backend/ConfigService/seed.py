"""
Seed script — populates the ConfigService database with initial config
migrated from the existing .env files and YAML configs.

Usage:
    python seed.py          # seeds the database (skips existing keys)
    python seed.py --force  # overwrites existing keys
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv()

from app.core.database import Base, engine, SessionLocal
from app.models.config_entry import ConfigEntry
from app.models.prompt_template import PromptTemplate
from app.models.agent_registry import AgentRegistry
from app.models.pipeline_definition import PipelineDefinition, PipelineNode, PipelineEdge
from app.models.llm_instance import LlmInstance, AgentLlmAssignment
from app.models.validation_rule import ValidationRule
from app.models.feature_flag import FeatureFlag
from app.models.response_merger import ResponseMerger
from app.models.navigation_model import NavCategory, NavItem
from app.models.aggregator_definition import AggregatorDefinition
from app.models.agent_definition import AgentDefinition
from app.models.agent_runtime_config import AgentRuntimeConfig
FORCE = "--force" in sys.argv


def seed_config(db):
    """Seed config_entries from what used to live in scattered .env files."""
    entries = [
        # --- Global ---
        {
            "agent_name": None,
            "key": "kafka_bootstrap",
            "value": os.getenv("KAFKA_BOOTSTRAP", "kafka:29092"),
            "is_secret": False,
            "description": "Kafka bootstrap server(s)",
        },
        # --- NLP Agent ---
        {
            "agent_name": "nlp",
            "key": "medgemma_api_url",
            "value": os.getenv("MEDGEMMA_API_URL", ""),
            "is_secret": False,
            "description": "MedGemma inference API URL",
        },
        {
            "agent_name": "nlp",
            "key": "medgemma_api_key",
            "value": os.getenv("MEDGEMMA_API_KEY", ""),
            "is_secret": True,
            "description": "MedGemma API key",
        },
        {
            "agent_name": "nlp",
            "key": "medgemma_model",
            "value": os.getenv("MEDGEMMA_MODEL", "google/medgemma-4b-it"),
            "is_secret": False,
            "description": "MedGemma model identifier",
        },
        {
            "agent_name": "nlp",
            "key": "llm_temperature",
            "value": 0.2,
            "is_secret": False,
            "description": "LLM sampling temperature",
        },
        {
            "agent_name": "nlp",
            "key": "llm_max_tokens",
            "value": 512,
            "is_secret": False,
            "description": "LLM max output tokens",
        },
        # --- STT Agent ---
        {
            "agent_name": "stt",
            "key": "whisperx_base_url",
            "value": os.getenv("WHISPERX_BASE_URL", ""),
            "is_secret": False,
            "description": "WhisperX inference API base URL",
        },
        {
            "agent_name": "stt",
            "key": "whisperx_api_key",
            "value": os.getenv("WHISPERX_API_KEY", ""),
            "is_secret": True,
            "description": "WhisperX API key",
        },
        # --- Orchestrator ---
        {
            "agent_name": "orchestrator",
            "key": "cors_origins",
            "value": ["http://localhost:5173"],
            "is_secret": False,
            "description": "Allowed CORS origins",
        },
        {
            "agent_name": "orchestrator",
            "key": "frontend_callback_url",
            "value": "http://localhost:5173",
            "is_secret": False,
            "description": "Frontend callback base URL for OAuth redirects",
        },
        {
            "agent_name": "orchestrator",
            "key": "job_timeout_seconds",
            "value": 120,
            "is_secret": False,
            "description": "Max seconds to wait for a pipeline job to complete",
        },
        # --- Reasoning Agent (Claude) ---
        {
            "agent_name": "reasoning",
            "key": "anthropic_api_key",
            "value": os.getenv("ANTHROPIC_API_KEY", ""),
            "is_secret": True,
            "description": "Anthropic API key for Claude",
        },
        {
            "agent_name": "reasoning",
            "key": "anthropic_model",
            "value": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            "is_secret": False,
            "description": "Claude model ID",
        },
        {
            "agent_name": "reasoning",
            "key": "llm_temperature",
            "value": 0.3,
            "is_secret": False,
            "description": "Sampling temperature for reasoning",
        },
        {
            "agent_name": "reasoning",
            "key": "llm_max_tokens",
            "value": 2048,
            "is_secret": False,
            "description": "Max output tokens for reasoning",
        },
        # --- Gemini (global — shared by STT and NLP agents) ---
        {
            "agent_name": None,
            "key": "gemini_api_key",
            "value": os.getenv("GEMINI_API_KEY", ""),
            "is_secret": True,
            "description": "Google Gemini API key (used when stt_provider or nlp_provider = gemini)",
        },
        {
            "agent_name": None,
            "key": "gemini_model",
            "value": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            "is_secret": False,
            "description": "Gemini model name",
        },
        # --- Provider selectors ---
        {
            "agent_name": "stt",
            "key": "stt_provider",
            "value": "gemini",
            "is_secret": False,
            "description": "STT backend: whisperx | gemini",
        },
        {
            "agent_name": "nlp",
            "key": "nlp_provider",
            "value": "gemini",
            "is_secret": False,
            "description": "NLP backend: medgemma | gemini",
        },
    ]

    for entry_data in entries:
        existing = (
            db.query(ConfigEntry)
            .filter(
                ConfigEntry.agent_name == entry_data["agent_name"],
                ConfigEntry.key == entry_data["key"],
            )
            .first()
        )
        if existing and not FORCE:
            print(f"  SKIP  {entry_data['agent_name'] or 'global'}/{entry_data['key']} (exists)")
            continue

        if existing:
            existing.value = entry_data["value"]
            existing.is_secret = entry_data["is_secret"]
            existing.description = entry_data["description"]
            print(f"  UPDATE {entry_data['agent_name'] or 'global'}/{entry_data['key']}")
        else:
            db.add(ConfigEntry(**entry_data))
            print(f"  CREATE {entry_data['agent_name'] or 'global'}/{entry_data['key']}")

    db.commit()


SOAP_SYSTEM_PROMPT = """\
You are a Clinical Documentation Assistant embedded in a real-world healthcare system.

---
### Your Role
Act as a professional medical documentation specialist.
Convert raw clinical conversation or notes into a precise, accurate SOAP note
suitable for direct ingestion into an EMR system.

You must follow clinical documentation standards used by practicing physicians.

---
### Output Format (MANDATORY)
Your response MUST be a single valid JSON object.

The JSON object MUST contain ONLY the following keys
and must appear in this exact order:

1. "subjective"
2. "objective"
3. "assessment"
4. "plan"

Each value MUST be an array of strings.
Each string represents ONE clear, atomic clinical bullet point.

---
### Output Example (FORMAT ONLY)
{
  "subjective": ["Bullet point 1", "Bullet point 2"],
  "objective": ["Bullet point 1"],
  "assessment": [],
  "plan": []
}

---
### BULLET RULES (STRICT)
- Each bullet MUST contain only ONE clinical fact.
- Do NOT combine multiple findings into one bullet.
- Do NOT write paragraphs.
- Do NOT nest objects or arrays.
- Do NOT include markdown, code fences, or explanations.

---
### EMPTY SECTION RULE (CRITICAL)
- If no information is present for a section, return an empty array [].
- DO NOT infer, summarize, or move information between sections.
- Assessment and Plan MUST be [] unless explicitly stated by the doctor.

---
### Safety & Accuracy Rules (STRICT)
- DO NOT invent, assume, infer, or hallucinate any symptom, finding, diagnosis,
  vital sign, history, or treatment.
- Use ONLY information explicitly present in the clinical context.
- Include relevant negatives ONLY if explicitly mentioned.
- DO NOT add differential diagnoses or speculative language.

---
### Language & Style Guidelines
- Use professional medical language written for clinicians.
- Be concise, factual, and clinically meaningful.

---
### Scope Limitation
This is clinical documentation support only.
It does NOT confirm diagnoses or replace clinical judgment.

Any deviation from these rules is a critical error."""

SOAP_USER_PROMPT = """\
Generate a SOAP note based ONLY on the clinical context below.

Do not add or assume any information.
If a detail is missing, leave it out.

Clinical Context:
<<<CONTEXT_START>>>
{{transcript}}
<<<CONTEXT_END>>>"""

PRESCRIPTION_SYSTEM_PROMPT = """\
You are a Prescription Structuring Assistant embedded in a real-world healthcare system.

---
### Your Role
This is a STRICT DATA EXTRACTION task.
Extract ONLY medicines that are EXPLICITLY prescribed by the doctor
during this clinical encounter.

---
### CRITICAL DECISION RULE (NON-NEGOTIABLE)
Before extracting anything, you MUST decide internally:

"Did the doctor explicitly instruct the patient to take a medicine?"

- If the answer is NO → return an empty JSON array [] and STOP.
- This is a VALID and EXPECTED outcome.

Symptoms, complaints, or common medical practice
MUST NOT be treated as prescriptions.

---
### What COUNTS as a prescription
A prescription exists ONLY if the doctor clearly states instructions such as:
- "Take"
- "I am prescribing"
- "Start"
- "Continue"
- "Use this medicine"

If these are NOT present, there is NO prescription.

---
### Output Format (MANDATORY)
Your response MUST be a raw JSON array and NOTHING ELSE.
- No markdown
- No code fences
- No explanations
- Output must start with [ and end with ]

---
### Schema (STRICT)
Each object MUST contain EXACTLY these keys:
- medicineName
- doseMg
- frequency
- durationInDays
- isFree
- quantity
- remark

No additional keys are allowed.

---
### Data Rules
- Use null ONLY if a value is explicitly missing.
- DO NOT infer, guess, normalize, or complete data.
- DO NOT assume common treatments (e.g., paracetamol for fever).

---
### Safety Rules
- ONLY extract medicines prescribed by the doctor FOR THIS VISIT.
- DO NOT extract patient-mentioned medicines.
- DO NOT add diagnosis, advice, or reasoning.
- DO NOT substitute drugs or add alternatives.

---
### Scope Limitation
This output is a structured representation only.
Any deviation from these rules is a critical failure."""

PRESCRIPTION_USER_PROMPT = """\
Extract prescription items from the transcript below.

IMPORTANT:
- If the doctor does NOT explicitly prescribe any medicine,
  return an empty JSON array [].

Transcript:
<<<TRANSCRIPT_START>>>
{{transcript}}
<<<TRANSCRIPT_END>>>"""


REASONING_SYSTEM_PROMPT = """\
You are a clinical decision support system embedded in a healthcare platform.
You analyze patient-provider conversations and produce structured clinical outputs.

IMPORTANT CONSTRAINTS:
- You NEVER diagnose — you surface relevant information and flag uncertainty.
- You ONLY use information explicitly present in the transcript and provided context.
- You DO NOT invent symptoms, findings, drugs, or diagnoses.
- If confidence in a section is below 0.70, set flag_for_review to true.
- For medication_suggestions: only include drugs if confidence >= 0.85.

OUTPUT FORMAT (MANDATORY):
Your response MUST be a single valid JSON object with exactly these top-level keys:

{
  "soap": {
    "subjective": ["..."],
    "objective": ["..."],
    "assessment": ["..."],
    "plan": ["..."],
    "confidence": 0.0
  },
  "differential": [
    {"diagnosis": "...", "confidence": 0.0, "rationale": "..."}
  ],
  "lab_suggestions": [
    {"test": "...", "rationale": "...", "urgency": "routine|urgent|stat"}
  ],
  "medication_suggestions": [
    {"name": "...", "dose": "...", "route": "oral", "duration": "...", "rationale": "..."}
  ],
  "next_questions": ["..."],
  "flag_for_review": false,
  "overall_confidence": 0.0
}

Rules:
- Each array may be empty [] if no information supports it.
- Confidence values are floats from 0.0 to 1.0.
- Do NOT include markdown, code fences, or explanations outside the JSON.
- Do NOT nest extra keys beyond the schema above.
- This is clinical decision support only — it does NOT replace clinical judgment."""

REASONING_USER_PROMPT = """\
Action requested: {{action}}

Transcript:
{{transcript}}

Initial NLP Analysis (reference only — do not copy verbatim, use as context):
{{nlp_output}}

Generate your full clinical reasoning output as a single JSON object.{{feedback_section}}"""


def seed_prompts(db):
    """Seed prompt_templates from what used to live in text_generation.yaml."""
    prompts = [
        {
            "action": "soap",
            "system_prompt": SOAP_SYSTEM_PROMPT,
            "user_prompt": SOAP_USER_PROMPT,
            "input_variables": ["transcript", "action"],
        },
        {
            "action": "prescription",
            "system_prompt": PRESCRIPTION_SYSTEM_PROMPT,
            "user_prompt": PRESCRIPTION_USER_PROMPT,
            "input_variables": ["transcript", "action"],
        },
        {
            "action": "medical_reasoning",
            "system_prompt": REASONING_SYSTEM_PROMPT,
            "user_prompt": REASONING_USER_PROMPT,
            "input_variables": ["transcript", "nlp_output", "action"],
        },
    ]

    for prompt_data in prompts:
        existing = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.action == prompt_data["action"], PromptTemplate.is_active.is_(True))
            .first()
        )
        if existing and not FORCE:
            print(f"  SKIP  prompt/{prompt_data['action']} (exists)")
            continue

        import json as _json
        iv = _json.dumps(prompt_data.get("input_variables")) if prompt_data.get("input_variables") else None
        os_val = _json.dumps(prompt_data.get("output_schema")) if prompt_data.get("output_schema") else None

        if existing and FORCE:
            # Create a new version
            new_version = existing.version + 1
            existing.is_active = False
            db.add(
                PromptTemplate(
                    action=prompt_data["action"],
                    system_prompt=prompt_data["system_prompt"],
                    user_prompt=prompt_data["user_prompt"],
                    input_variables=iv,
                    output_schema=os_val,
                    version=new_version,
                    is_active=True,
                )
            )
            print(f"  UPDATE prompt/{prompt_data['action']} -> v{new_version}")
        else:
            db.add(
                PromptTemplate(
                    action=prompt_data["action"],
                    system_prompt=prompt_data["system_prompt"],
                    user_prompt=prompt_data["user_prompt"],
                    input_variables=iv,
                    output_schema=os_val,
                    version=1,
                    is_active=True,
                )
            )
            print(f"  CREATE prompt/{prompt_data['action']} v1")

    db.commit()


def seed_agents(db):
    """Seed agent_registry with the built-in agents."""
    agents = [
        {
            "name": "audio_preprocessor",
            "input_topic": "audio.uploaded",
            "output_topic": "audio.preprocessed",
            "health_url": "http://audio_preprocessor:8009/health",
            "version": "1.0.0",
        },
        {
            "name": "stt",
            "input_topic": "audio.preprocessed",
            "output_topic": "stt.completed",
            "health_url": "http://speech_to_text:8001/health",
            "version": "1.0.0",
        },
        {
            "name": "nlp",
            "input_topic": "transcript.generated",
            "output_topic": "nlp.completed",
            "health_url": "http://nlp_agent:8002/health",
            "version": "1.0.0",
        },
        {
            "name": "stt-validator",
            "input_topic": "stt.completed",
            "output_topic": "transcript.validated",
            "health_url": "http://stt_validator:8003/health",
            "version": "1.0.0",
        },
        {
            "name": "nlp-validator",
            "input_topic": "nlp.completed",
            "output_topic": "nlp.validated",
            "health_url": "http://nlp_validator:8004/health",
            "version": "1.0.0",
        },
        {
            "name": "reasoning-agent",
            "input_topic": "nlp.validated",
            "output_topic": "reasoning.completed",
            "health_url": "http://reasoning_agent:8005/health",
            "version": "1.0.0",
        },
        {
            "name": "reasoning-validator",
            "input_topic": "reasoning.completed",
            "output_topic": "reasoning.validated",
            "health_url": "http://reasoning_validator:8006/health",
            "version": "1.0.0",
        },
    ]

    for agent_data in agents:
        existing = db.query(AgentRegistry).filter(AgentRegistry.name == agent_data["name"]).first()
        if existing and not FORCE:
            print(f"  SKIP  agent/{agent_data['name']} (exists)")
            continue
        if existing:
            for k, v in agent_data.items():
                if k != "name":
                    setattr(existing, k, v)
            print(f"  UPDATE agent/{agent_data['name']}")
        else:
            db.add(AgentRegistry(**agent_data))
            print(f"  CREATE agent/{agent_data['name']}")

    db.commit()


def seed_validation_rules(db):
    """Seed validation rules for the STT and NLP validator sidecars."""
    rules = [
        # ── STT (transcribe step) ──────────────────────────────────────────
        {
            "step_name": "transcribe",
            "rule_type": "completeness",
            "rule_config": {"min_length": 10},
            "severity": "error",
            "description": "Transcript must be at least 10 characters",
        },
        {
            "step_name": "transcribe",
            "rule_type": "confidence_threshold",
            "rule_config": {"min_confidence": 0.65, "field": "overall_confidence"},
            "severity": "warning",
            "description": "Overall transcript confidence should exceed 0.65",
        },
        # ── NLP (summarise step) ───────────────────────────────────────────
        {
            "step_name": "summarise",
            "rule_type": "json_schema",
            "rule_config": {
                "action": "soap",
                "required_keys": ["subjective", "objective", "assessment", "plan"],
                "value_type": "array",
            },
            "severity": "error",
            "description": "SOAP output must be a JSON object with four array-valued keys",
        },
        {
            "step_name": "summarise",
            "rule_type": "completeness",
            "rule_config": {"action": "soap", "min_non_empty_sections": 1},
            "severity": "error",
            "description": "At least one SOAP section must be non-empty",
        },
        {
            "step_name": "summarise",
            "rule_type": "json_schema",
            "rule_config": {
                "action": "prescription",
                "value_type": "array",
                "required_item_keys": [
                    "medicineName", "doseMg", "frequency",
                    "durationInDays", "isFree", "quantity", "remark",
                ],
            },
            "severity": "error",
            "description": "Prescription output must be a JSON array with required keys per item",
        },
        # ── Reasoning Agent (reason step) ─────────────────────────────────────
        {
            "step_name": "reason",
            "rule_type": "json_schema",
            "rule_config": {
                "required_keys": ["overall_confidence", "flag_for_review"],
                "content_keys": ["soap", "differential", "lab_suggestions", "medication_suggestions", "next_questions"],
            },
            "severity": "error",
            "description": "Reasoning output must contain overall_confidence, flag_for_review, and at least one content section",
        },
        {
            "step_name": "reason",
            "rule_type": "confidence_threshold",
            "rule_config": {"min_confidence": 0.0, "field": "overall_confidence"},
            "severity": "warning",
            "description": "overall_confidence must be a valid float in [0, 1]",
        },
    ]

    for rule_data in rules:
        existing = (
            db.query(ValidationRule)
            .filter(
                ValidationRule.step_name == rule_data["step_name"],
                ValidationRule.rule_type == rule_data["rule_type"],
                ValidationRule.description == rule_data["description"],
            )
            .first()
        )
        if existing and not FORCE:
            print(f"  SKIP  validation/{rule_data['step_name']}/{rule_data['rule_type']} (exists)")
            continue
        if existing:
            existing.rule_config = rule_data["rule_config"]
            existing.severity = rule_data["severity"]
            print(f"  UPDATE validation/{rule_data['step_name']}/{rule_data['rule_type']}")
        else:
            db.add(ValidationRule(**rule_data))
            print(f"  CREATE validation/{rule_data['step_name']}/{rule_data['rule_type']}")

    db.commit()


def seed_feature_flags(db):
    """Seed the feature_flags table with the initial flag set."""
    flags = [
        # ── Available to all authenticated users ────────────────────────────
        {
            "key": "audio_job",
            "label": "Submit audio jobs",
            "enabled": True,
            "roles": ["admin", "user"],
            "description": "Allow users to submit audio transcription + analysis jobs",
        },
        {
            "key": "text_job",
            "label": "Submit text jobs",
            "enabled": True,
            "roles": ["admin", "user"],
            "description": "Allow users to submit plain-text summarisation jobs",
        },
        {
            "key": "reasoning",
            "label": "Medical reasoning step",
            "enabled": True,
            "roles": ["admin", "user"],
            "description": "Include the Claude reasoning agent step in pipelines",
        },
        {
            "key": "job_history",
            "label": "View job history",
            "enabled": True,
            "roles": ["admin", "user"],
            "description": "Access the job history list page",
        },
        {
            "key": "live_stream",
            "label": "Live token streaming",
            "enabled": True,
            "roles": ["admin", "user"],
            "description": "Enable SSE token streaming on the job console",
        },
        # ── Admin-only ───────────────────────────────────────────────────────
        {
            "key": "job_all_users",
            "label": "View all users' jobs",
            "enabled": True,
            "roles": ["admin"],
            "description": "Admins can list and view jobs from all tenants",
        },
        {
            "key": "config_management",
            "label": "Agent configuration",
            "enabled": True,
            "roles": ["admin"],
            "description": "Edit agent config entries via the Config page",
        },
        {
            "key": "prompt_management",
            "label": "Prompt template management",
            "enabled": True,
            "roles": ["admin"],
            "description": "Edit and version prompt templates via the Prompts page",
        },
        {
            "key": "pipeline_management",
            "label": "Pipeline template management",
            "enabled": True,
            "roles": ["admin"],
            "description": "Edit pipeline step sequences via the Pipelines page",
        },
        {
            "key": "webhook_management",
            "label": "Webhook management",
            "enabled": True,
            "roles": ["admin"],
            "description": "Register and delete webhook endpoints",
        },
        {
            "key": "agent_monitoring",
            "label": "Agent health monitoring",
            "enabled": True,
            "roles": ["admin"],
            "description": "View agent registry and health status on the Agents page",
        },
        {
            "key": "feature_management",
            "label": "Feature flag management",
            "enabled": True,
            "roles": ["admin"],
            "description": "Enable/disable features and control role access at runtime",
        },
        {
            "key": "access_key_management",
            "label": "Access key management",
            "enabled": True,
            "roles": ["admin"],
            "description": "Create, list, and revoke pipeline-scoped access keys for tenant clients",
        },
        {
            "key": "test_console",
            "label": "Test Console",
            "enabled": False,
            "roles": [],
            "description": "Show the job submission test console in the sidebar",
        },
        {
            "key": "allow_local_fallback",
            "label": "Allow local fallback authentication",
            "enabled": True,
            "roles": ["admin"],
            "description": "Allow users with this role to log in via local password when Authentik is unavailable",
        },
    ]

    for flag_data in flags:
        existing = db.query(FeatureFlag).filter(FeatureFlag.key == flag_data["key"]).first()
        if existing and not FORCE:
            print(f"  SKIP  feature/{flag_data['key']} (exists)")
            continue
        if existing:
            existing.label = flag_data["label"]
            existing.enabled = flag_data["enabled"]
            existing.roles = flag_data["roles"]
            existing.description = flag_data["description"]
            print(f"  UPDATE feature/{flag_data['key']}")
        else:
            db.add(FeatureFlag(**flag_data))
            print(f"  CREATE feature/{flag_data['key']}")

    db.commit()


def seed_llm_instances(db):
    """Seed default LLM instances: Anthropic Claude and a local llama.cpp placeholder."""
    instances = [
        {
            "name": "claude-sonnet",
            "provider": "anthropic",
            "base_url": "https://api.anthropic.com",
            "model_name": "claude-sonnet-4-6",
            "max_parallel": 10,
            "priority": 10,
            "health_endpoint": None,
            "api_key_config_key": "reasoning/anthropic_api_key",
        },
        {
            "name": "gemini-flash",
            "provider": "gemini",
            "base_url": "https://generativelanguage.googleapis.com",
            "model_name": "gemini-2.5-flash",
            "max_parallel": 10,
            "priority": 20,
            "health_endpoint": None,
            "api_key_config_key": "gemini_api_key",
        },
        {
            "name": "local-llamacpp",
            "provider": "llamacpp",
            "base_url": "http://llm-server:8100",
            "model_name": "",        # set to actual model filename in .env / ConfigEntry
            "max_parallel": 4,
            "priority": 50,
            "health_endpoint": "/health",
            "api_key_config_key": None,
            "is_active": False,      # disabled until local model is configured
        },
    ]

    for data in instances:
        is_active = data.pop("is_active", True)
        existing = db.query(LlmInstance).filter(LlmInstance.name == data["name"]).first()
        if existing and not FORCE:
            print(f"  SKIP  llm/{data['name']} (exists)")
            data["is_active"] = is_active  # restore for next iteration
            continue
        if existing:
            for k, v in data.items():
                setattr(existing, k, v)
            existing.is_active = is_active
            print(f"  UPDATE llm/{data['name']}")
        else:
            db.add(LlmInstance(**data, is_active=is_active))
            print(f"  CREATE llm/{data['name']}")

    db.commit()


def seed_pipeline_definitions(db):
    """
    Seed pipeline_definitions (graph model) from hardcoded pipeline data.
    Single source of truth — no dependency on pipeline_templates (dropped).
    Idempotent: skips pipelines already present by name.
    """
    pipelines = [
        {
            "name": "audio_full",
            "description": "Full audio pipeline: preprocess → STT → NLP → reasoning",
            "steps": [
                {"name": "preprocess",         "agent": "audio_preprocessor", "max_retries": 1, "on_failure": "fail_job"},
                {"name": "transcribe",         "agent": "stt",                "max_retries": 2, "on_failure": "fail_job"},
                {"name": "validate_stt",       "agent": "stt-validator",      "max_retries": 0, "on_failure": "fail_job"},
                {"name": "summarise",          "agent": "nlp",                "max_retries": 2, "on_failure": "fail_job"},
                {"name": "validate_nlp",       "agent": "nlp-validator",      "max_retries": 0, "on_failure": "fail_job"},
                {"name": "reason",             "agent": "reasoning-agent",    "max_retries": 2, "on_failure": "fail_job"},
                {"name": "validate_reasoning", "agent": "reasoning-validator","max_retries": 0, "on_failure": "fail_job"},
            ],
        },
        {
            "name": "audio_transcribe_only",
            "description": "Audio transcription only — no NLP or reasoning",
            "steps": [
                {"name": "transcribe", "agent": "stt", "max_retries": 2, "on_failure": "fail_job"},
            ],
        },
        {
            "name": "text_summarise",
            "description": "Text → NLP summarisation → reasoning",
            "steps": [
                {"name": "summarise",          "agent": "nlp",                "max_retries": 2, "on_failure": "fail_job"},
                {"name": "validate_nlp",       "agent": "nlp-validator",      "max_retries": 0, "on_failure": "fail_job"},
                {"name": "reason",             "agent": "reasoning-agent",    "max_retries": 2, "on_failure": "fail_job"},
                {"name": "validate_reasoning", "agent": "reasoning-validator","max_retries": 0, "on_failure": "fail_job"},
            ],
        },
    ]

    agent_map = {a.name: a for a in db.query(AgentRegistry).all()}

    for pipeline_data in pipelines:
        existing = db.query(PipelineDefinition).filter(PipelineDefinition.name == pipeline_data["name"]).first()
        if existing and not FORCE:
            print(f"  SKIP  pipeline_graph/{pipeline_data['name']} (exists)")
            continue
        if existing:
            db.query(PipelineEdge).filter(PipelineEdge.pipeline_id == existing.id).delete()
            db.query(PipelineNode).filter(PipelineNode.pipeline_id == existing.id).delete()
            db.delete(existing)
            db.flush()

        pipeline_def = PipelineDefinition(
            name=pipeline_data["name"],
            description=pipeline_data["description"],
            version=1,
            is_active=True,
            created_by="seed",
        )
        db.add(pipeline_def)
        db.flush()

        nodes = []
        for step in pipeline_data["steps"]:
            agent = agent_map.get(step["agent"])
            if not agent:
                print(f"  WARN  pipeline_graph/{pipeline_data['name']}: agent '{step['agent']}' not in registry — skipping")
                continue
            node = PipelineNode(
                pipeline_id=pipeline_def.id,
                agent_id=agent.id,
                node_key=step["name"],
                position_x=None,
                position_y=None,
                config_override={},
                max_retries=step.get("max_retries", 2),
                on_failure=step.get("on_failure", "fail_job"),
            )
            db.add(node)
            nodes.append(node)

        db.flush()

        for i in range(len(nodes) - 1):
            edge = PipelineEdge(
                pipeline_id=pipeline_def.id,
                source_node_id=nodes[i].id,
                target_node_id=nodes[i + 1].id,
                is_parallel=False,
                wait_for_group=None,
                is_optional=False,
            )
            db.add(edge)

        db.commit()
        print(f"  CREATE pipeline_graph/{pipeline_data['name']} ({len(nodes)} nodes, {len(nodes)-1} edges)")


def seed_agent_llm_assignments(db):
    """
    Assign LLM instances to agents that require LLM calls.
    Idempotent.
    """
    llm_map = {l.name: l for l in db.query(LlmInstance).all()}
    agent_map = {a.name: a for a in db.query(AgentRegistry).all()}

    assignments = [
        # reasoning-agent uses Claude by default
        ("reasoning-agent", "claude-sonnet"),
        # nlp uses gemini (current provider)
        ("nlp", "gemini-flash"),
        # stt uses gemini (current provider)
        ("stt", "gemini-flash"),
        # local llama.cpp fallback — inactive until model configured; priority 50 keeps cloud preferred
        ("nlp", "local-llamacpp"),
        ("reasoning-agent", "local-llamacpp"),
    ]

    for agent_name, llm_name in assignments:
        agent = agent_map.get(agent_name)
        llm = llm_map.get(llm_name)
        if not agent or not llm:
            print(f"  WARN  assignment/{agent_name}->{llm_name}: agent or llm not found")
            continue

        existing = (
            db.query(AgentLlmAssignment)
            .filter(
                AgentLlmAssignment.agent_id == agent.id,
                AgentLlmAssignment.llm_instance_id == llm.id,
            )
            .first()
        )
        if existing and not FORCE:
            print(f"  SKIP  assignment/{agent_name}->{llm_name} (exists)")
            continue
        if not existing:
            db.add(AgentLlmAssignment(agent_id=agent.id, llm_instance_id=llm.id))
            print(f"  CREATE assignment/{agent_name}->{llm_name}")

        # Update agent.llm_required and default llm_instance_id
        agent.llm_required = True
        if agent.llm_instance_id is None:
            agent.llm_instance_id = llm.id

    db.commit()


def seed_navigation(db):
    """Seed the backend with the sidebar navigation hierarchy."""
    nav_data = [
        {
            "id": 1,
            "title": "Core Workspace",
            "is_admin_only": False,
            "order": 1,
            "items": [
                {"id": 1, "label": "Job History", "path": "/jobs", "icon_name": "History", "feature_key": "job_history", "order": 1},
                {"id": 2, "label": "Test Console", "path": "/jobs/new", "icon_name": "FlaskConical", "feature_key": "test_console", "order": 2},
            ]
        },
        {
            "id": 2,
            "title": "AI & Processing",
            "is_admin_only": True,
            "order": 2,
            "items": [
                {"id": 3, "label": "Pipelines", "path": "/pipelines", "icon_name": "GitBranch", "feature_key": "pipeline_management", "order": 1},
                {"id": 4, "label": "Agents", "path": "/agents", "icon_name": "Cpu", "feature_key": "agent_monitoring", "order": 2},
                {"id": 5, "label": "LLM Instances", "path": "/llm-instances", "icon_name": "BrainCircuit", "feature_key": None, "order": 3},
                {"id": 6, "label": "Prompts", "path": "/prompts", "icon_name": "FileText", "feature_key": "prompt_management", "order": 4},
            ]
        },
        {
            "id": 3,
            "title": "System & Access Control",
            "is_admin_only": True,
            "order": 3,
            "items": [
                {"id": 7, "label": "Config", "path": "/config", "icon_name": "Settings", "feature_key": "config_management", "order": 1},
                {"id": 8, "label": "Roles", "path": "/roles", "icon_name": "Users", "feature_key": None, "order": 2},
                {"id": 9, "label": "Feature Flags", "path": "/feature-flags", "icon_name": "ToggleLeft", "feature_key": "feature_management", "order": 3},
                {"id": 10, "label": "Access Keys", "path": "/access-keys", "icon_name": "KeyRound", "feature_key": None, "order": 4},
                {"id": 14, "label": "Menus", "path": "/menus", "icon_name": "Menu", "feature_key": None, "order": 5},
            ]
        },
        {
            "id": 4,
            "title": "Monitoring & Integrations",
            "is_admin_only": True,
            "order": 4,
            "items": [
                {"id": 11, "label": "Webhooks", "path": "/webhooks", "icon_name": "Webhook", "feature_key": "webhook_management", "order": 1},
                {"id": 12, "label": "Failed Jobs", "path": "/failed-jobs", "icon_name": "FileText", "feature_key": None, "order": 2},
                {"id": 13, "label": "Organisations", "path": "/organisations", "icon_name": "Building2", "feature_key": None, "order": 3},
            ]
        }
    ]

    for cat_data in nav_data:
        existing_cat = db.query(NavCategory).filter(NavCategory.title == cat_data["title"]).first()
        if existing_cat and not FORCE:
            print(f"  SKIP  nav_category/{cat_data['title']} (exists)")
        else:
            if existing_cat:
                existing_cat.order = cat_data["order"]
                existing_cat.is_admin_only = cat_data["is_admin_only"]
                print(f"  UPDATE nav_category/{cat_data['title']}")
            else:
                existing_cat = NavCategory(id=cat_data["id"], title=cat_data["title"], order=cat_data["order"], is_admin_only=cat_data["is_admin_only"])
                db.add(existing_cat)
                db.flush()
                print(f"  CREATE nav_category/{cat_data['title']}")

        for item_data in cat_data["items"]:
            existing_item = db.query(NavItem).filter(NavItem.path == item_data["path"]).first()
            if existing_item and not FORCE:
                print(f"  SKIP  nav_item/{item_data['path']} (exists)")
                continue

            if existing_item:
                for k, v in item_data.items():
                    setattr(existing_item, k, v)
                existing_item.category_id = existing_cat.id
                print(f"  UPDATE nav_item/{item_data['path']}")
            else:
                db.add(NavItem(**item_data, category_id=existing_cat.id))
                print(f"  CREATE nav_item/{item_data['path']}")

    db.commit()


def main():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        print("\nSeeding config entries...")
        seed_config(db)

        print("\nSeeding prompt templates...")
        seed_prompts(db)

        print("\nSeeding agent registry...")
        seed_agents(db)

        print("\nSeeding validation rules...")
        seed_validation_rules(db)

        print("\nSeeding feature flags...")
        seed_feature_flags(db)

        print("\nSeeding LLM instances...")
        seed_llm_instances(db)

        print("\nSeeding agent registry (Phase A extensions)...")
        seed_agents(db)  # re-run to pick up any new agents before assignments

        print("\nSeeding agent→LLM assignments...")
        seed_agent_llm_assignments(db)

        print("\nSeeding pipeline graph definitions...")
        seed_pipeline_definitions(db)

        print("\nSeeding sidebar navigation menu...")
        seed_navigation(db)

        print("\nDone.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
