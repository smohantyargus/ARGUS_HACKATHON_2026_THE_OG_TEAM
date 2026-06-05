"""Phase 2 tests — conflict detection covers both clinical and policy fields."""
import pytest
from app.services.aggregator_service import _detect_conflicts, _CONFLICT_FIELDS


DEFINITION = {
    "input_sources": [
        {"agent_name": "Epidemiologist", "base_weight": 1.0, "label": "Epidemiologist"},
        {"agent_name": "EconomicImpact", "base_weight": 1.0, "label": "Economist"},
        {"agent_name": "CitizenCompliance", "base_weight": 1.0, "label": "Behavioral"},
    ]
}


def test_conflict_fields_include_policy_domain():
    """_CONFLICT_FIELDS must include epidemic policy field names."""
    for f in ["recommendation", "action", "amendment", "proposal", "policy_stance"]:
        assert f in _CONFLICT_FIELDS, f"Missing policy conflict field: {f}"


def test_conflict_detected_on_recommendation():
    """Epidemiologist vs EconomicImpact disagree on recommendation → conflict flagged."""
    inputs = {
        "Epidemiologist": {
            "output": {"recommendation": "21-day hard lockdown"},
            "confidence": 0.95,
        },
        "EconomicImpact": {
            "output": {"recommendation": "30% transit capacity ceiling"},
            "confidence": 0.92,
        },
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    assert any(c["field"] == "recommendation" for c in conflicts)


def test_conflict_detected_on_action():
    """VETO vs ACCEPT on 'action' field surfaces as a conflict."""
    inputs = {
        "Epidemiologist": {"output": {"action": "ACCEPT"}, "confidence": 0.9},
        "EconomicImpact": {"output": {"action": "VETO_HARD_LOCKDOWN"}, "confidence": 0.92},
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    assert any(c["field"] == "action" for c in conflicts)


def test_no_conflict_when_all_agree():
    """No conflict if all agents agree on a field."""
    inputs = {
        "Epidemiologist": {"output": {"recommendation": "partial transit"}, "confidence": 0.9},
        "EconomicImpact": {"output": {"recommendation": "partial transit"}, "confidence": 0.92},
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    rec_conflicts = [c for c in conflicts if c["field"] == "recommendation"]
    assert rec_conflicts == []


def test_single_agent_field_not_flagged():
    """Only one agent has 'recommendation' → no conflict (need at least 2 sources)."""
    inputs = {
        "Epidemiologist": {"output": {"recommendation": "lockdown"}, "confidence": 0.9},
        "EconomicImpact": {"output": {"different_field": "something"}, "confidence": 0.8},
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    rec_conflicts = [c for c in conflicts if c["field"] == "recommendation"]
    assert rec_conflicts == []


def test_clinical_conflict_still_detected():
    """Adding policy fields must not break existing clinical conflict detection."""
    inputs = {
        "Epidemiologist": {"output": {"diagnosis": "influenza A"}, "confidence": 0.9},
        "EconomicImpact": {"output": {"diagnosis": "influenza B"}, "confidence": 0.8},
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    assert any(c["field"] == "diagnosis" for c in conflicts)


def test_conflict_contains_effective_weight():
    """Each agent entry in a conflict includes effective_weight = base_weight * confidence."""
    inputs = {
        "Epidemiologist": {"output": {"recommendation": "lockdown"}, "confidence": 0.8},
        "EconomicImpact": {"output": {"recommendation": "open"}, "confidence": 0.5},
    }
    conflicts = _detect_conflicts(inputs, DEFINITION)
    rec = next(c for c in conflicts if c["field"] == "recommendation")
    epi_entry = next(a for a in rec["agents"] if a["name"] == "Epidemiologist")
    assert epi_entry["effective_weight"] == pytest.approx(1.0 * 0.8, abs=1e-3)
