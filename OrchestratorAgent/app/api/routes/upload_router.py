from fastapi import APIRouter, UploadFile,Form,Depends
from typing import List, Optional
from app.services.upload_service import upload_service
from app.core.auth import get_current_user

routes = APIRouter()    

@routes.post("/upload")
async def upload(
    file: Optional[UploadFile] = None,
    text: Optional[str] = Form(""),
    job: List[str] = Form(...),
    action: Optional[List[str]] = Form(None),
    model_name: str = Form("whisperx"),
    target_lang: Optional[str] = Form("en"),
    _user: dict = Depends(get_current_user),
):
    return await upload_service(
        file, text, job, action, model_name, target_lang
    )