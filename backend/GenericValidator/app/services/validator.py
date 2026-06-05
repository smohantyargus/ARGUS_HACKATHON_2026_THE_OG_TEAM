"""
Validation logic for GenericValidator.

Supported rule types:
  not_empty         — output must be non-null and non-empty string/dict
  required_fields   — output must be a JSON object with all listed fields present and non-empty
  json_schema       — output must conform to a JSON Schema (uses jsonschema library)
  none              — always passes (passthrough — still gates the *.validated topic)
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def validate(output, rules: dict | None) -> tuple[bool, str, str]:
    """
    Returns (is_valid, rule_violated, error_detail).
    `output` may be a str, dict, or None.
    """
    if rules is None:
        rules = {}

    rule_type = rules.get("type", "not_empty")

    if rule_type == "none":
        return True, "", ""

    # --- not_empty (default) ---
    if rule_type == "not_empty":
        if output is None:
            return False, "empty_output", "Output is null"
        if isinstance(output, str) and not output.strip():
            return False, "empty_output", "Output is an empty string"
        if isinstance(output, dict) and not output:
            return False, "empty_output", "Output is an empty object"
        return True, "", ""

    # --- required_fields ---
    if rule_type == "required_fields":
        fields: list[str] = rules.get("fields", [])
        obj = _to_dict(output)
        if obj is None:
            return False, "not_json", "Expected a JSON object but output could not be parsed"
        missing = [f for f in fields if not obj.get(f)]
        if missing:
            return False, "missing_fields", f"Missing or empty fields: {missing}"
        return True, "", ""

    # --- json_schema ---
    if rule_type == "json_schema":
        schema = rules.get("schema", {})
        obj = _to_dict(output)
        if obj is None:
            return False, "not_json", "Expected a JSON object but output could not be parsed"
        try:
            import jsonschema
            jsonschema.validate(instance=obj, schema=schema)
            return True, "", ""
        except jsonschema.ValidationError as e:
            return False, "schema_violation", e.message
        except Exception as e:
            return False, "schema_error", str(e)

    logger.warning("Unknown validation rule type '%s' — treating as not_empty", rule_type)
    return validate(output, {"type": "not_empty"})


def _to_dict(output) -> dict | None:
    if isinstance(output, dict):
        return output
    if isinstance(output, str):
        try:
            parsed = json.loads(output)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return None
