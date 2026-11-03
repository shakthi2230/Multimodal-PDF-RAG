from fastapi.testclient import TestClient

from app.main import app
from app.models import Document


def register(client: TestClient, email: str) -> tuple[str, str]:
    response = client.post("/api/auth/register", json={"email": email, "password": "valid-password"})
    assert response.status_code == 201
    body = response.json()
    return body["access_token"], body["user"]["id"]


def test_register_login_and_me(client):
    test_client, _ = client
    token, user_id = register(test_client, "reader@example.com")
    me_response = test_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_response.status_code == 200
    assert me_response.json()["id"] == user_id

    login_response = test_client.post(
        "/api/auth/login", json={"email": "reader@example.com", "password": "valid-password"}
    )
    assert login_response.status_code == 200
    assert login_response.json()["token_type"] == "bearer"


def test_registration_persists_display_name(client):
    test_client, _ = client
    response = test_client.post(
        "/api/auth/register",
        json={"name": "Jane Smith", "email": "jane@example.com", "password": "valid-password"},
    )
    assert response.status_code == 201
    assert response.json()["user"]["name"] == "Jane Smith"


def test_documents_and_chat_sessions_are_owner_isolated(client):
    test_client, test_session = client
    owner_token, owner_id = register(test_client, "owner@example.com")
    other_token, _ = register(test_client, "other@example.com")

    db = test_session()
    document = Document(
        owner_id=owner_id,
        filename="private.pdf",
        storage_path="missing.pdf",
        status="completed",
    )
    db.add(document)
    db.commit()
    document_id = document.id
    db.close()

    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    other_headers = {"Authorization": f"Bearer {other_token}"}
    assert test_client.get("/api/documents", headers=owner_headers).json()[0]["id"] == document_id
    assert test_client.get("/api/documents", headers=other_headers).json() == []
    assert test_client.get(f"/api/documents/{document_id}", headers=other_headers).status_code == 404

    session_response = test_client.post("/api/chat/sessions", headers=owner_headers, json={"title": "Notes"})
    session_id = session_response.json()["id"]
    assert test_client.get(f"/api/chat/sessions/{session_id}", headers=other_headers).status_code == 404


def test_pdf_file_stream_requires_document_ownership(client, tmp_path):
    test_client, test_session = client
    owner_token, owner_id = register(test_client, "file-owner@example.com")
    other_token, _ = register(test_client, "file-other@example.com")
    pdf_path = tmp_path / "source.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 test")

    db = test_session()
    document = Document(
        owner_id=owner_id,
        filename="source.pdf",
        storage_path=str(pdf_path),
        status="completed",
    )
    db.add(document)
    db.commit()
    document_id = document.id
    db.close()

    response = test_client.get(
        f"/api/documents/{document_id}/file",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == b"%PDF-1.7 test"
    assert test_client.get(
        f"/api/documents/{document_id}/file",
        headers={"Authorization": f"Bearer {other_token}"},
    ).status_code == 404


def test_chat_without_ready_documents_abstains_and_keeps_history(client):
    test_client, _ = client
    token, _ = register(test_client, "chat@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    session_id = test_client.post("/api/chat/sessions", headers=headers, json={}).json()["id"]

    response = test_client.post(
        f"/api/chat/sessions/{session_id}/messages",
        headers=headers,
        json={"content": "What does the report say?"},
    )
    assert response.status_code == 200
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["content"] == "Insufficient evidence in the uploaded documents to answer this question."
    assert assistant_message["citations"] == []

    history = test_client.get(f"/api/chat/sessions/{session_id}", headers=headers).json()["messages"]
    assert [message["role"] for message in history] == ["user", "assistant"]


def test_upload_requires_pdf_extension_and_pdf_signature(client):
    test_client, _ = client
    token, _ = register(test_client, "upload@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    wrong_extension = test_client.post(
        "/api/documents/upload", headers=headers, files={"file": ("notes.txt", b"%PDF-1.7")}
    )
    assert wrong_extension.status_code == 415

    invalid_pdf = test_client.post(
        "/api/documents/upload", headers=headers, files={"file": ("notes.pdf", b"not a pdf")}
    )
    assert invalid_pdf.status_code == 415


def test_health_and_documented_routes(client):
    test_client, _ = client
    assert test_client.get("/api/health").json() == {"status": "ok", "database": "ok"}
    paths = app.openapi()["paths"]
    assert "/api/auth/me" in paths
    assert "/api/documents/{document_id}/pages/{page_number}" in paths
    assert "/api/chat/sessions/{session_id}/messages" in paths
