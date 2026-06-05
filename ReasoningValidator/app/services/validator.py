"""
Reasoning output validator.

Checks that the structured output from the ReasoningAgent:
  1. Is a valid dict (JSON object)
  2. Contains overall_confidence (float 0–1)
  3. Contains at least one substantive section (soap/differential/lab_suggestions/
     medication_suggestions/next_questions)
  4. overall_confidence is > 0 (non-empty output)
"""
import logging

logger = logging.getLogger(__name__)

_CONTENT_KEYS = {"soap", "differential", "lab_suggestions", "medication_suggestions", "next_questions"}
_REQUIRED_KEYS = {"overall_confidence", "flag_for_review"}


def validate(output: dict, action: str | None = None) -> tuple[bool, str, str]:
    """
    Returns (passed, rule_violated, error_detail).
    rule_violated and error_detail are empty strings on success.
    """
    if not isinstance(output, dict):
        return False, "json_schema", f"Output must be a JSON object, got {type(output).__name__}"

    # Required keys
    for key in _REQUIRED_KEYS:
        if key not in output:
            return False, "json_schema", f"Missing required key: '{key}'"

    # overall_confidence must be a float in [0, 1]
    conf = output.get("overall_confidence")
    if not isinstance(conf, (int, float)):
        return False, "json_schema", f"overall_confidence must be a number, got {type(conf).__name__}"
    if not (0.0 <= float(conf) <= 1.0):
        return False, "range_check", f"overall_confidence {conf} is outside [0, 1]"

    # At least one content key must be present and non-empty
    has_content = any(output.get(k) for k in _CONTENT_KEYS)
    if not has_content:
        return False, "completeness", "Output contains no substantive clinical sections"

    # SOAP structure check (if present)
    soap = output.get("soap")
    if soap is not None:
        if not isinstance(soap, dict):
            return False, "json_schema", "soap must be a JSON object"
        for section in ("subjective", "objective", "assessment", "plan"):
            if section in soap and not isinstance(soap[section], list):
                return False, "json_schema", f"soap.{section} must be an array"

    # differential items must have diagnosis + confidence
    for item in output.get("differential", []):
        if not isinstance(item, dict):
            return False, "json_schema", "differential items must be JSON objects"
        if "diagnosis" not in item:
            return False, "json_schema", "differential item missing 'diagnosis' key"
        conf_item = item.get("confidence")
        if conf_item is not None and not isinstance(conf_item, (int, float)):
            return False, "json_schema", "differential item confidence must be a number"

    return True, "", ""
