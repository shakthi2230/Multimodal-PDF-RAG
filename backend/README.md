# Multimodal PDF RAG backend

FastAPI service for account-scoped PDF upload, extraction, search, and cited chat.
Run commands from this directory.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
$env:JWT_SECRET = (python -c "import secrets; print(secrets.token_urlsafe(48))")
$env:OPENAI_API_KEY = "your-key"
alembic upgrade head
uvicorn app.main:app --reload
```

SQLite and the local Qdrant store default to `data\rag.db` and `data\qdrant`.
`JWT_SECRET` is generated ephemerally when omitted; set a persistent secret for
deployments. The API docs are available at `/docs`.

Optional scanned-page OCR requires PaddleOCR and PaddlePaddle:

```powershell
pip install -e ".[ocr]"
```

Without those optional packages, scanned pages fail processing with a clear
error while text PDFs continue normally. Figure descriptions, embeddings, and
chat require a valid `OPENAI_API_KEY`. Qdrant can be local or configured with
`QDRANT_URL` and `QDRANT_API_KEY`.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy database URL | `sqlite:///./data/rag.db` |
| `JWT_SECRET` | HS256 signing secret | Random per process (set persistently in production) |
| `JWT_EXPIRE_MINUTES` | Token lifetime | `60` |
| `UPLOAD_DIR` | Private uploaded PDF storage | `data\uploads` |
| `MAX_UPLOAD_BYTES` | Upload limit | `26214400` |
| `MAX_PDF_PAGES` | Page processing limit | `500` |
| `CORS_ORIGINS` | Comma-separated frontend origins | `http://localhost:3000,http://localhost:5173` |
| `OPENAI_API_KEY` | OpenAI embeddings, vision, and chat | Unset |
| `OPENAI_CHAT_MODEL` | Grounded answer model | `gpt-4o-mini` |
| `OPENAI_VISION_MODEL` | Figure description model | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | Embedding model | `text-embedding-3-small` |
| `QDRANT_URL` | Remote Qdrant URL; unset uses local storage | Unset |
| `QDRANT_API_KEY` | Remote Qdrant API key | Unset |
| `QDRANT_PATH` | Local Qdrant directory | `data\qdrant` |
| `QDRANT_COLLECTION` | Vector collection name | `pdf_chunks` |

## API

All authenticated endpoints use `Authorization: Bearer <access_token>`.
Document upload returns immediately with `status: "queued"`; poll its status
endpoint for `processing`, `completed`, or `failed`. Failed OCR, AI, or indexing
work is visible as `error_message`.

* `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
* `POST /api/documents/upload` (`file` multipart field)
* `GET /api/documents`, `GET /api/documents/{id}`, `DELETE /api/documents/{id}`
* `GET /api/documents/{id}/status`, `GET /api/documents/{id}/file`
* `GET /api/documents/{id}/pages/{page}`, `GET /api/documents/{id}/sources`
* `GET /api/documents/{id}/figures`, `GET /api/documents/{id}/tables`
* `POST /api/chat/sessions`, `GET /api/chat/sessions`
* `GET /api/chat/sessions/{id}`, `DELETE /api/chat/sessions/{id}`
* `POST /api/chat/sessions/{id}/messages`
* `GET /api/health`

Chat message request:

```json
{"content": "What does the report say about revenue?", "document_ids": ["optional-document-uuid"]}
```

The message response contains `user_message` and `assistant_message`; assistant
messages include a `citations` array with source ID, document ID, filename,
page number, excerpt, and relevance score. Omit `document_ids` to search all
of the user's completed documents. Document content is explicitly treated as
untrusted input; when retrieval finds no sufficiently relevant evidence, the
assistant abstains instead of using outside knowledge.

## Schema and tests

`Base.metadata.create_all` initializes a fresh local database automatically.
Use `alembic upgrade head` to apply the initial migration and future migrations.
Run focused tests with `pytest`.
