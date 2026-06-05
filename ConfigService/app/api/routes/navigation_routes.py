import os
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.navigation_model import NavCategory, NavItem
from app.schemas.navigation_schemas import (
    FrontendNavCategory, FrontendNavItem,
    NavCategoryCreate, NavCategoryUpdate, NavCategoryResponse,
    NavItemCreate, NavItemUpdate, NavItemResponse,
)

_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")

router = APIRouter(prefix="/navigation", tags=["navigation"])


def _role_from_jwt(authorization: Optional[str] = Header(default=None)) -> str:
    """Role derived from JWT — never trust client headers or query params."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            from jose import jwt as _jwt
            payload = _jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
            return payload.get("role", "user")
        except Exception:
            pass
    return "user"


# ── Frontend read (no write-auth — called on every page load) ─────────────────

@router.get("", response_model=List[FrontendNavCategory])
def get_navigation(
    db: Session = Depends(get_db),
    role: str = Depends(_role_from_jwt),
):
    query = db.query(NavCategory).order_by(NavCategory.order)
    if role not in ("admin", "superadmin"):
        query = query.filter(NavCategory.is_admin_only == False)
    categories = query.all()

    return [
        FrontendNavCategory(
            title=cat.title,
            items=[
                FrontendNavItem(
                    to=item.path,
                    label=item.label,
                    icon=item.icon_name,
                    featureKey=item.feature_key,
                    isExternal=item.is_external or False,
                )
                for item in cat.items
            ],
        )
        for cat in categories
    ]


# ── Admin CRUD — categories ───────────────────────────────────────────────────

@router.get("/admin/categories", response_model=List[NavCategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    return db.query(NavCategory).order_by(NavCategory.order).all()


@router.post("/admin/categories", response_model=NavCategoryResponse, status_code=201)
def create_category(data: NavCategoryCreate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    cat = NavCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/admin/categories/{cat_id}", response_model=NavCategoryResponse)
def update_category(cat_id: int, data: NavCategoryUpdate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    cat = db.get(NavCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/admin/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    cat = db.get(NavCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(cat)
    db.commit()


# ── Admin CRUD — items ────────────────────────────────────────────────────────

@router.post("/admin/categories/{cat_id}/items", response_model=NavItemResponse, status_code=201)
def create_item(cat_id: int, data: NavItemCreate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    if not db.get(NavCategory, cat_id):
        raise HTTPException(status_code=404, detail="Category not found")
    item = NavItem(**data.model_dump(), category_id=cat_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/admin/items/{item_id}", response_model=NavItemResponse)
def update_item(item_id: int, data: NavItemUpdate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    item = db.get(NavItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/admin/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    item = db.get(NavItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
