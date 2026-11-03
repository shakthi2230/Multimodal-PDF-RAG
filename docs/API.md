# API reference

The API is served by FastAPI under `/api`. Interactive OpenAPI documentation is available at `/docs` when the service is running.

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Authenticate and obtain a bearer token |
| GET | `/api/auth/me` | Return the authenticated profile |

Use `Authorization: Bearer <token>` for protected endpoints.

## Documents

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Upload a PDF for processing |
| GET | `/api/documents` | List the current user's documents |
| GET | `/api/documents/{document_id}` | Get document details |
| DELETE | `/api/documents/{document_id}` | Delete an owned document |
| GET | `/api/documents/{document_id}/status` | Get processing state and error details |
| GET | `/api/documents/{document_id}/file` | Stream the owned PDF for authenticated preview |
| GET | `/api/documents/{document_id}/pages/{page_number}` | Get page content |
| GET | `/api/documents/{document_id}/sources` | List extracted source items |
| GET | `/api/documents/{document_id}/figures` | List figure descriptions |
| GET | `/api/documents/{document_id}/tables` | List extracted tables |

## Chat

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat/sessions` | Start a conversation for an owned document |
| GET | `/api/chat/sessions` | List the current user's conversations |
| GET | `/api/chat/sessions/{session_id}` | Read conversation history |
| POST | `/api/chat/sessions/{session_id}/messages` | Ask a question and receive grounded evidence |
| DELETE | `/api/chat/sessions/{session_id}` | Delete an owned conversation |

## Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Check API availability |

Exact response schemas and validation errors are published by the running application's OpenAPI schema. Protected resources must not be accessible across users.
