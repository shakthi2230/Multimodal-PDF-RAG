from __future__ import annotations

import logging
import re
import uuid
from functools import lru_cache
from pathlib import Path

import pymupdf as fitz
import pdfplumber
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Chunk, Document, DocumentPage, ExtractedTable, Figure
from app.services.ai import describe_image, embed_texts
from app.services.vector_store import delete_document_vectors, upsert_chunks

logger = logging.getLogger(__name__)
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 180
OCR_TEXT_THRESHOLD = 50


@lru_cache
def _get_ocr_engine():
    from paddleocr import PaddleOCR

    try:
        return PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    except (TypeError, ValueError):
        return PaddleOCR(use_textline_orientation=True, lang="en")


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("chunk_size must be positive and overlap must be smaller than chunk_size")
    result = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start, end)
            if boundary > start + chunk_size // 2:
                end = boundary
        result.append(normalized[start:end].strip())
        if end == len(normalized):
            break
        start = max(start + 1, end - overlap)
    return [item for item in result if item]


def _ocr_page(page: fitz.Page, page_number: int) -> str:
    try:
        ocr = _get_ocr_engine()
    except ImportError as exc:
        raise RuntimeError(
            f"Scanned page {page_number} requires OCR. Install the optional backend OCR dependencies "
            "(paddleocr and paddlepaddle) and retry."
        ) from exc
    try:
        import numpy as np
        from PIL import Image

        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        image_array = np.asarray(image)
        if hasattr(ocr, "predict"):
            result = ocr.predict(image_array)
        else:
            result = ocr.ocr(image_array, cls=True)
        words = []

        def collect(value) -> None:
            if isinstance(value, dict):
                for key in ("rec_texts", "texts"):
                    texts = value.get(key)
                    if isinstance(texts, (list, tuple)):
                        words.extend(text for text in texts if isinstance(text, str))
                        return
                for child in value.values():
                    collect(child)
                return
            if hasattr(value, "to_dict"):
                collect(value.to_dict())
                return
            if isinstance(value, (list, tuple)):
                if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1] and isinstance(value[1][0], str):
                    words.append(value[1][0])
                else:
                    for child in value:
                        collect(child)

        collect(result)
        return " ".join(words).strip()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"OCR failed on scanned page {page_number}: {exc}") from exc


def _image_extension(image_info: dict) -> str:
    extension = str(image_info.get("ext", "png")).lower()
    return extension if extension in {"png", "jpg", "jpeg"} else "png"


def _extract_figure_images(pdf_page: fitz.Page, document_dir: Path, page_number: int) -> list[tuple[Path, str]]:
    images = []
    seen_xrefs = set()
    for image_info in pdf_page.get_images(full=True):
        xref = image_info[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)
        rects = pdf_page.get_image_rects(xref)
        page_area = max(pdf_page.rect.width * pdf_page.rect.height, 1)
        if any(rect.width * rect.height / page_area >= 0.8 for rect in rects):
            continue
        extracted = pdf_page.parent.extract_image(xref)
        image_bytes = extracted.get("image")
        if not image_bytes:
            continue
        extension = _image_extension(extracted)
        image_path = document_dir / f"page-{page_number}-{uuid.uuid4().hex}.{extension}"
        image_path.write_bytes(image_bytes)
        images.append((image_path, extension))
    return images


def process_document(document_id: str) -> None:
    """Extract, enrich, embed, and index one queued PDF in a background task."""
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if document is None:
            return
        document.status = "processing"
        document.error_message = None
        db.commit()
        source = Path(document.storage_path)
        if not source.is_file():
            raise RuntimeError("Uploaded PDF file is missing from storage.")

        settings = get_settings()
        document_dir = source.parent
        extracted_chunks: list[tuple[int, str]] = []
        with fitz.open(source) as pdf:
            page_count = len(pdf)
            if page_count == 0:
                raise RuntimeError("The PDF contains no pages.")
            if page_count > settings.max_pages:
                raise RuntimeError(f"PDF has {page_count} pages; the configured limit is {settings.max_pages}.")
            document.page_count = page_count
            db.commit()

            with pdfplumber.open(source) as table_pdf:
                for index, pdf_page in enumerate(pdf, start=1):
                    text = pdf_page.get_text("text").strip()
                    used_ocr = False
                    if len(text) < OCR_TEXT_THRESHOLD and pdf_page.get_images(full=True):
                        text = _ocr_page(pdf_page, index)
                        used_ocr = bool(text)

                    page = DocumentPage(
                        document_id=document.id, page_number=index, text=text, used_ocr=used_ocr
                    )
                    db.add(page)
                    page_content = [text] if text else []

                    table_page = table_pdf.pages[index - 1]
                    for table_data in table_page.extract_tables() or []:
                        rows = [[cell or "" for cell in row] for row in table_data if row]
                        if not rows:
                            continue
                        table_text = "\n".join(" | ".join(row) for row in rows)
                        db.add(
                            ExtractedTable(
                                document_id=document.id,
                                page_number=index,
                                data=rows,
                                text=table_text,
                            )
                        )
                        page_content.append(f"Table on page {index}:\n{table_text}")

                    for image_path, _extension in _extract_figure_images(pdf_page, document_dir, index):
                        description = describe_image(image_path)
                        figure = Figure(
                            document_id=document.id,
                            page_number=index,
                            image_path=str(image_path),
                            description=description,
                        )
                        db.add(figure)
                        if description:
                            page_content.append(f"Figure on page {index}: {description}")

                    for content in page_content:
                        extracted_chunks.extend((index, piece) for piece in chunk_text(content))
                    document.processed_pages = index
                    db.commit()

        chunks = [
            Chunk(document_id=document.id, page_number=page_number, ordinal=ordinal, content=content)
            for ordinal, (page_number, content) in enumerate(extracted_chunks)
        ]
        db.add_all(chunks)
        db.flush()
        for start in range(0, len(chunks), 64):
            batch = chunks[start : start + 64]
            embeddings = embed_texts([chunk.content for chunk in batch])
            if len(embeddings) != len(batch):
                raise RuntimeError("Embedding service returned an unexpected number of vectors.")
            upsert_chunks(batch, embeddings, document.owner_id)
        document.status = "completed"
        document.error_message = None
        db.commit()
    except Exception as exc:
        logger.exception("Document processing failed for %s", document_id)
        db.rollback()
        try:
            delete_document_vectors(document_id)
        except Exception:
            logger.exception("Unable to clean vector records for failed document %s", document_id)
        document = db.get(Document, document_id)
        if document is not None:
            for model in (DocumentPage, ExtractedTable, Figure, Chunk):
                db.query(model).filter(model.document_id == document_id).delete(synchronize_session=False)
            document.status = "failed"
            document.error_message = str(exc)[:2000]
            db.commit()
    finally:
        db.close()
