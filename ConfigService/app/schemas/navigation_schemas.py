from pydantic import BaseModel
from typing import List, Optional


# ── Frontend read schemas (used by Layout.tsx) ────────────────────────────────

class FrontendNavItem(BaseModel):
    to: str
    label: str
    icon: str
    featureKey: Optional[str] = None
    isExternal: bool = False


class FrontendNavCategory(BaseModel):
    title: str
    items: List[FrontendNavItem]


# ── Admin CRUD schemas ────────────────────────────────────────────────────────

class NavItemCreate(BaseModel):
    label: str
    path: str
    icon_name: str
    feature_key: Optional[str] = None
    order: int = 0
    is_external: bool = False


class NavItemUpdate(BaseModel):
    label: Optional[str] = None
    path: Optional[str] = None
    icon_name: Optional[str] = None
    feature_key: Optional[str] = None
    order: Optional[int] = None
    category_id: Optional[int] = None
    is_external: Optional[bool] = None


class NavItemResponse(BaseModel):
    id: int
    label: str
    path: str
    icon_name: str
    feature_key: Optional[str] = None
    order: int
    is_external: bool
    category_id: int

    model_config = {"from_attributes": True}


class NavCategoryCreate(BaseModel):
    title: str
    order: int = 0
    is_admin_only: bool = False


class NavCategoryUpdate(BaseModel):
    title: Optional[str] = None
    order: Optional[int] = None
    is_admin_only: Optional[bool] = None


class NavCategoryResponse(BaseModel):
    id: int
    title: str
    order: int
    is_admin_only: bool
    items: List[NavItemResponse] = []

    model_config = {"from_attributes": True}
