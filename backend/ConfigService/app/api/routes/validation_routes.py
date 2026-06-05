from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.validation_rule import ValidationRule

router = APIRouter(prefix="/validations", tags=["validation-rules"])


@router.get("/{step_name}")
def get_rules_for_step(step_name: str, db: Session = Depends(get_db)):
    """Return all active validation rules for a given step."""
    rules = (
        db.query(ValidationRule)
        .filter(
            ValidationRule.step_name == step_name,
            ValidationRule.is_active.is_(True),
        )
        .all()
    )
    return [
        {
            "id": r.id,
            "step_name": r.step_name,
            "rule_type": r.rule_type,
            "rule_config": r.rule_config,
            "severity": r.severity,
            "description": r.description,
        }
        for r in rules
    ]
