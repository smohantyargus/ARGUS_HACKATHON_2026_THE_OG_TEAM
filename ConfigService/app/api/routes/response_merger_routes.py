from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.response_merger import ResponseMerger

router = APIRouter(prefix="/internal/response-mergers", tags=["response-mergers"])


def _row(m: ResponseMerger) -> dict:
    return {
        "id": str(m.id),
        "name": m.name,
        "display_name": m.display_name,
        "description": m.description,
        "input_topic_map": m.input_topic_map or {},
        "output_topic": m.output_topic,
        "timeout_seconds": m.timeout_seconds,
        "is_active": m.is_active,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


@router.get("/")
def list_mergers(db: Session = Depends(get_db)):
    return [_row(m) for m in db.query(ResponseMerger).order_by(ResponseMerger.name).all()]


@router.get("/{name}")
def get_merger(name: str, db: Session = Depends(get_db)):
    m = db.query(ResponseMerger).filter(ResponseMerger.name == name).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"ResponseMerger '{name}' not found")
    return _row(m)


@router.post("/", status_code=201)
def create_merger(payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    if db.query(ResponseMerger).filter(ResponseMerger.name == payload.get("name")).first():
        raise HTTPException(status_code=409, detail="ResponseMerger with this name already exists")
    allowed = {"id", "name", "display_name", "description", "input_topic_map", "output_topic", "timeout_seconds", "is_active"}
    init_payload = {k: v for k, v in payload.items() if k in allowed}
    if "id" in init_payload and init_payload["id"]:
        import uuid
        init_payload["id"] = uuid.UUID(str(init_payload["id"]))
    m = ResponseMerger(**init_payload)
    db.add(m)
    db.commit()
    db.refresh(m)
    return _row(m)


@router.patch("/{name}")
def update_merger(name: str, payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    m = db.query(ResponseMerger).filter(ResponseMerger.name == name).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"ResponseMerger '{name}' not found")
    allowed = {"display_name", "description", "input_topic_map", "output_topic", "timeout_seconds", "is_active"}
    for k, v in payload.items():
        if k in allowed:
            setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return _row(m)


@router.delete("/{name}", status_code=204)
def delete_merger(name: str, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    m = db.query(ResponseMerger).filter(ResponseMerger.name == name).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"ResponseMerger '{name}' not found")
    db.delete(m)
    db.commit()
