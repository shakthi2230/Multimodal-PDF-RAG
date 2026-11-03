from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Chunk, Document, DocumentPage, ExtractedTable, Figure, User
from app.schemas import DocumentRead, DocumentStatus, FigureRead, PageRead, SourceRead, TableRead
from app.security import get_current_user
from app.services.ingestion import process_document
from app.services.vector_store import delete_document_vectors

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])


def _owned_document(db: Session, user: User, document_id: str) -> Document:
    document = db.scalar(
        select(Document).where(Document.id == document_id, Document.owner_id == user.id)
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def _document_response(document: Document) -> DocumentRead:
    return DocumentRead(
        id=document.id,
        filename=document.filename,
        status=document.status,
        page_count=document.page_count,
        processed_pages=document.processed_pages,
        error_message=document.error_message,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.post("/upload", response_model=DocumentRead, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    settings = get_settings()
    original_name = Path(file.filename or "document.pdf").name
    safe_filename = re.sub(r"[^A-Za-z0-9._ -]", "_", original_name).strip(" .") or "document.pdf"
    if Path(safe_filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only PDF files are accepted.")
    if file.content_type not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The uploaded file must have a PDF media type.",
        )

    content = await file.read(settings.max_upload_bytes + 1)
    await file.close()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF exceeds the upload size limit.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="The uploaded file is not a valid PDF.")

    document_id = str(uuid.uuid4())
    directory = settings.upload_dir / user.id / document_id
    directory.mkdir(parents=True, exist_ok=True)
    storage_path = directory / "source.pdf"
    try:
        storage_path.write_bytes(content)
        document = Document(
            id=document_id,
            owner_id=user.id,
            filename=safe_filename,
            storage_path=str(storage_path),
            status="queued",
        )
        db.add(document)
        db.commit()
        db.refresh(document)
    except Exception:
        storage_path.unlink(missing_ok=True)
        raise

    background_tasks.add_task(process_document, document.id)
    return _document_response(document)


@router.get("", response_model=list[DocumentRead])
def list_documents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    documents = db.scalars(
        select(Document).where(Document.owner_id == user.id).order_by(Document.created_at.desc())
    ).all()
    return [_document_response(document) for document in documents]


@router.get("/{document_id}", response_model=DocumentRead)
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _document_response(_owned_document(db, user, document_id))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    document = _owned_document(db, user, document_id)
    try:
        delete_document_vectors(document.id)
    except Exception:
        logger.exception("Could not remove vectors for document %s", document.id)
    storage_path = Path(document.storage_path)
    db.delete(document)
    db.commit()
    try:
        storage_path.parent.resolve().relative_to(get_settings().upload_dir.resolve())
        import shutil

        shutil.rmtree(storage_path.parent, ignore_errors=True)
    except (ValueError, OSError):
        logger.warning("Skipped cleanup of document storage outside configured upload directory.")
    return None


@router.get("/{document_id}/status", response_model=DocumentStatus)
def document_status(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    document = _owned_document(db, user, document_id)
    return DocumentStatus(
        id=document.id,
        status=document.status,
        page_count=document.page_count,
        processed_pages=document.processed_pages,
        error_message=document.error_message,
    )


@router.get("/{document_id}/file")
def get_document_file(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = _owned_document(db, user, document_id)
    storage_path = Path(document.storage_path)
    if not storage_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file not found.")
    return FileResponse(
        storage_path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/{document_id}/pages/{page_number}", response_model=PageRead)
def get_page(
    document_id: str,
    page_number: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _owned_document(db, user, document_id)
    page = db.scalar(
        select(DocumentPage).where(
            DocumentPage.document_id == document_id, DocumentPage.page_number == page_number
        )
    )
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found.")
    return page


@router.get("/{document_id}/sources", response_model=list[SourceRead])
def get_sources(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _owned_document(db, user, document_id)
    chunks = db.scalars(
        select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.page_number, Chunk.ordinal)
    ).all()
    return [
        SourceRead(id=chunk.id, page_number=chunk.page_number, content=chunk.content)
        for chunk in chunks
    ]


@router.get("/{document_id}/figures", response_model=list[FigureRead])
def get_figures(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _owned_document(db, user, document_id)
    figures = db.scalars(
        select(Figure).where(Figure.document_id == document_id).order_by(Figure.page_number)
    ).all()
    return [
        FigureRead(id=figure.id, page_number=figure.page_number, description=figure.description)
        for figure in figures
    ]


@router.get("/{document_id}/tables", response_model=list[TableRead])
def get_tables(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _owned_document(db, user, document_id)
    tables = db.scalars(
        select(ExtractedTable).where(ExtractedTable.document_id == document_id).order_by(ExtractedTable.page_number)
    ).all()
    return [
        TableRead(id=table.id, page_number=table.page_number, data=table.data, text=table.text)
        for table in tables
    ]
