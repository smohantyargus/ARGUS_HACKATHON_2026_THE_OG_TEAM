from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class NavCategory(Base):
    __tablename__ = "nav_categories"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    order = Column(Integer, default=0)
    is_admin_only = Column(Boolean, default=False)
    
    items = relationship("NavItem", back_populates="category", cascade="all, delete-orphan", order_by="NavItem.order")

class NavItem(Base):
    __tablename__ = "nav_items"

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("nav_categories.id"))
    label = Column(String, nullable=False)
    path = Column(String, nullable=False)
    icon_name = Column(String, nullable=False)
    feature_key = Column(String, nullable=True)
    order = Column(Integer, default=0)
    is_external = Column(Boolean, default=False)

    category = relationship("NavCategory", back_populates="items")
