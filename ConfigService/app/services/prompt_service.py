import json
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from app.models.prompt_template import PromptTemplate
from app.schemas.prompt_schema import PromptTemplateCreate, PromptTemplateUpdate


def get_active_prompt(db: Session, action: str) -> PromptTemplate | None:
    """Returns the active prompt template for the given action."""
    return (
        db.query(PromptTemplate)
        .filter(PromptTemplate.action == action, PromptTemplate.is_active.is_(True))
        .order_by(PromptTemplate.version.desc())
        .first()
    )


def get_all_active_prompts(db: Session) -> list[PromptTemplate]:
    """Returns all active prompt templates (latest version per action)."""
    # Subquery to get the max active version per action
    subq = (
        db.query(
            PromptTemplate.action,
            sqlfunc.max(PromptTemplate.version).label("max_version"),
        )
        .filter(PromptTemplate.is_active.is_(True))
        .group_by(PromptTemplate.action)
        .subquery()
    )
    return (
        db.query(PromptTemplate)
        .join(subq, (PromptTemplate.action == subq.c.action) & (PromptTemplate.version == subq.c.max_version))
        .filter(PromptTemplate.is_active.is_(True))
        .all()
    )


def get_prompt_versions(db: Session, action: str) -> list[PromptTemplate]:
    """Returns all versions of a prompt template for the given action."""
    return (
        db.query(PromptTemplate)
        .filter(PromptTemplate.action == action)
        .order_by(PromptTemplate.version.desc())
        .all()
    )


def create_prompt_version(db: Session, data: PromptTemplateCreate) -> PromptTemplate:
    """Creates a new version of a prompt template, deactivating previous versions."""
    # Find the highest existing version for this action
    latest = (
        db.query(PromptTemplate)
        .filter(PromptTemplate.action == data.action)
        .order_by(PromptTemplate.version.desc())
        .first()
    )
    new_version = (latest.version + 1) if latest else 1

    # Deactivate all previous versions for this action
    db.query(PromptTemplate).filter(
        PromptTemplate.action == data.action
    ).update({"is_active": False})

    template = PromptTemplate(
        action=data.action,
        system_prompt=data.system_prompt,
        user_prompt=data.user_prompt,
        input_variables=json.dumps(data.input_variables) if data.input_variables is not None else None,
        output_schema=json.dumps(data.output_schema) if data.output_schema is not None else None,
        version=new_version,
        is_active=True,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def activate_prompt_version(db: Session, action: str, version: int) -> PromptTemplate | None:
    """Activates a specific version and deactivates all others for the same action."""
    target = (
        db.query(PromptTemplate)
        .filter(PromptTemplate.action == action, PromptTemplate.version == version)
        .first()
    )
    if not target:
        return None

    db.query(PromptTemplate).filter(
        PromptTemplate.action == action
    ).update({"is_active": False})

    target.is_active = True
    db.commit()
    db.refresh(target)
    return target
