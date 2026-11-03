from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ChatMessage, ChatSession, Document, User
from app.schemas import (
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionCreate,
    ChatSessionDetail,
    ChatSessionRead,
    ChatTurnResponse,
)
from app.security import get_current_user
from app.services.ai import answer_question

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _owned_session(db: Session, user: User, session_id: str) -> ChatSession:
    session = db.scalar(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.owner_id == user.id)
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
    return session


def _session_read(session: ChatSession) -> ChatSessionRead:
    return ChatSessionRead(
        id=session.id, title=session.title, created_at=session.created_at, updated_at=session.updated_at
    )


def _message_read(message: ChatMessage) -> ChatMessageRead:
    return ChatMessageRead(
        id=message.id,
        role=message.role,
        content=message.content,
        citations=message.citations or [],
        created_at=message.created_at,
    )


@router.post("/sessions", response_model=ChatSessionRead, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: ChatSessionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = ChatSession(owner_id=user.id, title=(payload.title or "New conversation").strip() or "New conversation")
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_read(session)


@router.get("/sessions", response_model=list[ChatSessionRead])
def list_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sessions = db.scalars(
        select(ChatSession).where(ChatSession.owner_id == user.id).order_by(ChatSession.updated_at.desc())
    ).all()
    return [_session_read(session) for session in sessions]


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = _owned_session(db, user, session_id)
    return ChatSessionDetail(
        **_session_read(session).model_dump(),
        messages=[_message_read(message) for message in session.messages],
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = _owned_session(db, user, session_id)
    db.delete(session)
    db.commit()
    return None


@router.post("/sessions/{session_id}/messages", response_model=ChatTurnResponse)
def send_message(
    session_id: str,
    payload: ChatMessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = _owned_session(db, user, session_id)
    if payload.document_ids is None:
        documents = db.scalars(
            select(Document).where(Document.owner_id == user.id, Document.status == "completed")
        ).all()
    else:
        if not payload.document_ids:
            documents = []
        else:
            documents = db.scalars(
                select(Document).where(
                    Document.owner_id == user.id,
                    Document.status == "completed",
                    Document.id.in_(payload.document_ids),
                )
            ).all()
            if len({document.id for document in documents}) != len(set(payload.document_ids)):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="One or more selected documents were not found or are not ready.",
                )

    history = [
        {"role": message.role, "content": message.content}
        for message in session.messages[-10:]
    ]
    user_message = ChatMessage(chat_session_id=session.id, role="user", content=payload.content)
    db.add(user_message)
    if session.title == "New conversation":
        session.title = payload.content[:80].strip() or "New conversation"
    db.commit()
    db.refresh(user_message)

    try:
        answer, citations = answer_question(
            payload.content,
            user.id,
            [document.id for document in documents],
            db,
            history=history,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    assistant_message = ChatMessage(
        chat_session_id=session.id,
        role="assistant",
        content=answer,
        citations=[
            {
                "source_id": item["source_id"],
                "document_id": item["document_id"],
                "filename": next(
                    (document.filename for document in documents if document.id == item["document_id"]),
                    "Document",
                ),
                "page_number": item["page_number"],
                "excerpt": item["content"][:500],
                "score": item["score"],
            }
            for item in citations
        ],
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)
    return ChatTurnResponse(
        user_message=_message_read(user_message),
        assistant_message=_message_read(assistant_message),
    )
