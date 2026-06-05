from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.schemas.prompt_schema import PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateResponse
from app.services import prompt_service

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.get("/", response_model=list[PromptTemplateResponse])
def list_active_prompts(db: Session = Depends(get_db)):
    """Returns all active prompt templates (latest active version per action)."""
    return prompt_service.get_all_active_prompts(db)


@router.get("/{action}", response_model=PromptTemplateResponse)
def get_prompt(action: str, db: Session = Depends(get_db)):
    """Returns the active prompt template for the given action."""
    template = prompt_service.get_active_prompt(db, action)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No active prompt for action '{action}'")
    return template


@router.get("/{action}/versions", response_model=list[PromptTemplateResponse])
def get_prompt_versions(action: str, db: Session = Depends(get_db)):
    """Returns all versions of a prompt template."""
    versions = prompt_service.get_prompt_versions(db, action)
    if not versions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No prompts found for action '{action}'")
    return versions


@router.put("/{action}", response_model=PromptTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_new_version(action: str, data: PromptTemplateUpdate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    """Creates a new version of the prompt, automatically deactivating previous versions."""
    create_data = PromptTemplateCreate(
        action=action,
        system_prompt=data.system_prompt,
        user_prompt=data.user_prompt,
    )
    return prompt_service.create_prompt_version(db, create_data)


@router.post("/{action}/activate/{version}", response_model=PromptTemplateResponse)
def activate_version(action: str, version: int, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    """Activates a specific version, deactivating all others for this action."""
    template = prompt_service.activate_prompt_version(db, action, version)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt '{action}' version {version} not found",
        )
    return template
