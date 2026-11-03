# Architecture

## System overview

The application separates the browser UI, REST API, relational data, vector search, and uploaded files:

```text
React + TypeScript
        | bearer-token HTTP requests
        v
FastAPI API and PDF/RAG services
   |         |           |
   v         v           v
PostgreSQL  Qdrant   Private upload storage
                       |
                       v
                OpenAI services
```

The relational database is the source of truth for users, document status, extracted page content, and chat history. Qdrant stores chunk vectors and metadata used to locate relevant evidence. PDF files are stored outside the web root and associated with their owning user.

## Ingestion and retrieval

1. Authenticate the user and validate the uploaded file and size.
2. Record a pending document, then extract page-aware text, tables, and figures.
3. Use OCR for pages without useful embedded text; retain extracted content and original page numbers.
4. Describe supported visual content with a vision model, and create separate, typed chunks for prose, tables, and figures.
5. Embed chunks and persist their metadata for document-scoped retrieval.
6. Retrieve evidence for a question, construct an instruction-isolated prompt, and return an answer with source IDs, page numbers, excerpts, and content types.
7. Abstain when the available evidence does not support an answer.

The document processing state is exposed to the UI so failed processing is visible rather than silently treated as success. A conversation is bound to an authorized user and document.

## Security boundaries

- Passwords are stored as hashes; API credentials and signing secrets are configuration, not frontend constants.
- Every document and conversation lookup must be scoped to its owner.
- Retrieved PDF text, including text that resembles instructions, is untrusted evidence and cannot override system instructions.
- Upload limits and file-type checks reduce exposure to unexpected inputs. Production deployments should additionally use malware scanning, private object storage, TLS, backups, and rate limiting.

## Assumptions and limitations

- PostgreSQL and Qdrant are the containerized deployment defaults. Local development may use a SQLite database if configured by the backend.
- OpenAI API access is needed for embeddings, generated answers, and vision descriptions. The assessment PDF was not supplied, so no assessment-document evaluation is claimed.
- OCR and visual understanding depend on the configured optional/native libraries and external services. Their availability and accuracy must be checked in the target deployment environment.
