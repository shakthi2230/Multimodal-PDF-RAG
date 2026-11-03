# Multimodal PDF RAG

A full-stack document question-answering application designed to ground answers in uploaded PDFs and cite page-level evidence. The system targets prose, tables, scanned pages, and figures; the actual extraction quality depends on the PDF and configured AI/OCR services.

> **Assessment note:** No assessment PDF or test link was included. The evaluation questions in [`docs/evaluation.md`](./docs/evaluation.md) are examples only; the application has not been validated against the assessment document.

## Architecture

- **Frontend:** React, TypeScript, Vite, Tailwind CSS.
- **Backend:** FastAPI and SQLAlchemy.
- **Relational database:** PostgreSQL in Docker; SQLite may be used for local development.
- **Vector search:** Qdrant.
- **AI:** OpenAI embeddings, chat, and vision APIs.
- **PDF processing:** page-aware text extraction, table parsing, OCR for scanned pages, and figure descriptions.

See [`docs/architecture.md`](./docs/architecture.md) and [`docs/API.md`](./docs/API.md).

## Configuration

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET_KEY` to a cryptographically random secret.
3. Set `OPENAI_API_KEY` to enable embeddings, grounded answers, and vision descriptions.
4. Review the upload size, allowed browser origins, database URL, and Qdrant settings before deployment.

Do not expose `.env` or API keys to the browser. The Docker Compose defaults are for local assessment/development, not production credentials.

## Run with Docker Compose

Prerequisites: Docker Desktop with Compose enabled, and an `.env` file as above.

```powershell
Copy-Item .env.example .env
# Edit .env and configure JWT_SECRET_KEY and OPENAI_API_KEY.
docker compose up --build
```

Open the frontend at <http://localhost:5173>. The API and interactive schema are at <http://localhost:8000> and <http://localhost:8000/docs>.

To stop the services, run `docker compose down`. Persistent database, vector, and upload data are stored in named volumes.

## Local development

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Set-Location backend
$env:DATABASE_URL = "sqlite:///./data/rag.db"
$env:QDRANT_URL = "http://localhost:6333"
$env:UPLOAD_DIR = ".\data\uploads"
alembic upgrade head
python -m uvicorn app.main:app --reload
```

Start Qdrant separately (for example with Docker) and configure the required environment variables. Set `OPENAI_API_KEY` for AI-backed processing and chat.

### Frontend

```powershell
Set-Location frontend
npm install
npm run dev
```

Set `VITE_API_BASE_URL` to the backend origin when it is not `http://localhost:8000`.

## Tests

Run backend tests from the project root:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest tests
```

Run frontend checks from `frontend`:

```powershell
npm run build
```

Tests that use external AI/vector services should isolate those calls; integration testing requires configured services. Only report results from commands actually executed.

## Operational and evaluation notes

- User-owned documents and chat sessions must remain isolated.
- AI output should be supported by retrieved page-level evidence; absent evidence should result in an explicit abstention.
- PDF content is untrusted input, not an instruction source.
- OCR and vision outputs can be incomplete or incorrect. Validate extracted tables and figures for high-stakes use.
- See [`docs/evaluation.md`](./docs/evaluation.md) for a sample assessment plan and metrics; no assessment results are claimed without a supplied test PDF and verified answers.
