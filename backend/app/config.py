from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_expire_minutes: int
    upload_dir: Path
    max_upload_bytes: int
    max_pages: int
    cors_origins: tuple[str, ...]
    openai_api_key: str | None
    openai_chat_model: str
    openai_vision_model: str
    openai_embedding_model: str
    qdrant_url: str | None
    qdrant_api_key: str | None
    qdrant_path: Path
    qdrant_collection: str


@lru_cache
def get_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL", "sqlite:///./data/rag.db")
    default_upload_dir = BACKEND_DIR / "data" / "uploads"
    qdrant_path = Path(os.getenv("QDRANT_PATH", str(BACKEND_DIR / "data" / "qdrant")))
    origins = tuple(
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
        if origin.strip()
    )
    return Settings(
        database_url=database_url,
        jwt_secret=os.getenv("JWT_SECRET") or secrets.token_urlsafe(48),
        jwt_expire_minutes=int(os.getenv("JWT_EXPIRE_MINUTES", "60")),
        upload_dir=Path(os.getenv("UPLOAD_DIR", str(default_upload_dir))),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))),
        max_pages=int(os.getenv("MAX_PDF_PAGES", "500")),
        cors_origins=origins,
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_chat_model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
        openai_vision_model=os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
        openai_embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        qdrant_url=os.getenv("QDRANT_URL"),
        qdrant_api_key=os.getenv("QDRANT_API_KEY"),
        qdrant_path=qdrant_path,
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "pdf_chunks"),
    )
