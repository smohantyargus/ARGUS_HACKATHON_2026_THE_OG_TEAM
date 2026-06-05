from fastapi import APIRouter
from app.api.routes import upload_router, users
from app.api.routes.job_router import router as job_router
from app.api.routes.webhook_router import router as webhook_router
from app.api.routes.access_key_router import router as access_key_router
from app.api.routes.process_router import router as process_router
from app.api.routes.role_router import router as role_router
from app.api.routes.dlq_router import router as dlq_router
from app.api.routes.org_router import router as org_router
from app.api.routes.agent_lag_router import router as agent_lag_router

api_router = APIRouter()

# Legacy endpoints (kept for backward compatibility)
api_router.include_router(upload_router.routes)
api_router.include_router(users.router)

# v1 async API
api_router.include_router(job_router)
api_router.include_router(webhook_router)
api_router.include_router(access_key_router)
api_router.include_router(process_router)
api_router.include_router(role_router)
api_router.include_router(dlq_router)
api_router.include_router(org_router)
api_router.include_router(agent_lag_router)
