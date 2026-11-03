from __future__ import annotations

from functools import lru_cache

from qdrant_client import QdrantClient, models
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Chunk


@lru_cache
def get_qdrant_client() -> QdrantClient:
    settings = get_settings()
    if settings.qdrant_url:
        return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)
    settings.qdrant_path.mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=str(settings.qdrant_path))


def ensure_collection(vector_size: int) -> None:
    client = get_qdrant_client()
    collection_name = get_settings().qdrant_collection
    if not client.collection_exists(collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        )


def upsert_chunks(chunks: list[Chunk], vectors: list[list[float]], owner_id: str) -> None:
    if not chunks:
        return
    ensure_collection(len(vectors[0]))
    client = get_qdrant_client()
    client.upsert(
        collection_name=get_settings().qdrant_collection,
        points=[
            models.PointStruct(
                id=chunk.id,
                vector=vector,
                payload={
                    "chunk_id": chunk.id,
                    "document_id": chunk.document_id,
                    "owner_id": owner_id,
                    "page_number": chunk.page_number,
                },
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ],
        wait=True,
    )


def retrieve_chunks(
    query_vector: list[float],
    owner_id: str,
    document_ids: list[str],
    db: Session,
    limit: int = 8,
) -> list[dict]:
    if not document_ids:
        return []
    client = get_qdrant_client()
    collection_name = get_settings().qdrant_collection
    if not client.collection_exists(collection_name):
        return []
    hits = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        query_filter=models.Filter(
            must=[
                models.FieldCondition(key="owner_id", match=models.MatchValue(value=owner_id)),
                models.FieldCondition(key="document_id", match=models.MatchAny(any=document_ids)),
            ]
        ),
        limit=limit,
        with_payload=True,
    ).points
    chunk_ids = [str(hit.payload.get("chunk_id")) for hit in hits if hit.payload and hit.payload.get("chunk_id")]
    chunks = {chunk.id: chunk for chunk in db.query(Chunk).filter(Chunk.id.in_(chunk_ids)).all()}
    results = []
    for hit in hits:
        chunk_id = str((hit.payload or {}).get("chunk_id", ""))
        chunk = chunks.get(chunk_id)
        if chunk is None:
            continue
        results.append(
            {
                "chunk_id": chunk.id,
                "document_id": chunk.document_id,
                "page_number": chunk.page_number,
                "content": chunk.content,
                "score": float(hit.score),
            }
        )
    return results


def delete_document_vectors(document_id: str) -> None:
    client = get_qdrant_client()
    collection_name = get_settings().qdrant_collection
    if client.collection_exists(collection_name):
        client.delete(
            collection_name=collection_name,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id", match=models.MatchValue(value=document_id)
                        )
                    ]
                )
            ),
            wait=True,
        )
