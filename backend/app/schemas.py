from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    name: str = Field(default="", max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class DocumentRead(BaseModel):
    id: str
    filename: str
    status: str
    page_count: int
    processed_pages: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class DocumentStatus(BaseModel):
    id: str
    status: str
    page_count: int
    processed_pages: int
    error_message: str | None


class ChatSessionCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class ChatSessionRead(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class Citation(BaseModel):
    source_id: str
    document_id: str
    filename: str
    page_number: int
    excerpt: str
    score: float


class ChatMessageRead(BaseModel):
    id: str
    role: str
    content: str
    citations: list[Citation] = Field(default_factory=list)
    created_at: datetime


class ChatTurnResponse(BaseModel):
    user_message: ChatMessageRead
    assistant_message: ChatMessageRead


class ChatSessionDetail(ChatSessionRead):
    messages: list[ChatMessageRead]


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=10_000)
    document_ids: list[str] | None = None


class PageRead(BaseModel):
    document_id: str
    page_number: int
    text: str
    used_ocr: bool


class SourceRead(BaseModel):
    id: str
    page_number: int
    content: str


class FigureRead(BaseModel):
    id: str
    page_number: int
    description: str | None


class TableRead(BaseModel):
    id: str
    page_number: int
    data: list
    text: str
