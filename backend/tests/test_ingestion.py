from pathlib import Path

import pytest
import pymupdf

from app.services import ai
from app.models import Chunk, Document, DocumentPage, User
from app.services import ingestion
from app.services.ingestion import chunk_text


def test_chunk_text_normalizes_and_overlaps():
    result = chunk_text("alpha beta  gamma delta epsilon", chunk_size=16, overlap=4)
    assert result[0] == "alpha beta"
    assert result[1].startswith("beta")
    assert "gamma" in " ".join(result)


def test_chunk_text_validates_overlap():
    with pytest.raises(ValueError):
        chunk_text("some text", chunk_size=10, overlap=10)


def test_chat_abstains_without_any_ready_documents(monkeypatch):
    def fail_if_called(_texts):
        raise AssertionError("Embedding should not run when there are no eligible documents.")

    monkeypatch.setattr(ai, "embed_texts", fail_if_called)
    assert ai.answer_question("What is in this report?", "owner-id", [], None) == (
        ai.ABSTENTION,
        [],
    )


def test_text_pdf_processing_persists_pages_and_indexes_chunks(client, monkeypatch):
    _test_client, session_factory = client
    test_dir = Path(__file__).parent
    pdf_path = test_dir / "processing-fixture.pdf"
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text(
        (72, 72),
        "The annual report states that revenue increased by twelve percent during the fiscal year.",
    )
    pdf.save(pdf_path)
    pdf.close()

    db = session_factory()
    user = User(email="processing@example.com", password_hash="unused")
    db.add(user)
    db.commit()
    document = Document(
        owner_id=user.id,
        filename=pdf_path.name,
        storage_path=str(pdf_path),
        status="queued",
    )
    db.add(document)
    db.commit()
    document_id = document.id
    db.close()

    monkeypatch.setattr(ingestion, "SessionLocal", session_factory)
    monkeypatch.setattr(ingestion, "embed_texts", lambda texts: [[0.1, 0.2] for _ in texts])
    monkeypatch.setattr(ingestion, "upsert_chunks", lambda chunks, vectors, owner_id: None)
    monkeypatch.setattr(ingestion, "delete_document_vectors", lambda document_id: None)
    try:
        ingestion.process_document(document_id)
        db = session_factory()
        processed = db.get(Document, document_id)
        assert processed.status == "completed"
        assert processed.processed_pages == 1
        assert db.query(DocumentPage).filter_by(document_id=document_id).count() == 1
        assert db.query(Chunk).filter_by(document_id=document_id).count() >= 1
        db.close()
    finally:
        pdf_path.unlink(missing_ok=True)
