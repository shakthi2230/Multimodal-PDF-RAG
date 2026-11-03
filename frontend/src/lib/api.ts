export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
export const TOKEN_KEY = "folium_access_token";

export type User = { id?: string | number; name?: string; email: string };
export type DocumentItem = {
  id: string | number;
  filename: string;
  status?: string;
  pages?: number;
  page_count?: number;
  created_at?: string;
  file_size?: number;
  [key: string]: unknown;
};
export type ChatSession = {
  id: string | number;
  title?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};
export type Citation = {
  document_id?: string | number;
  documentId?: string | number;
  filename?: string;
  document_name?: string;
  page?: number;
  page_number?: number;
  quote?: string;
  text?: string;
  [key: string]: unknown;
};
export type ChatMessage = {
  id?: string | number;
  role?: string;
  content?: string;
  message?: string;
  citations?: Citation[];
  sources?: Citation[];
  created_at?: string;
  [key: string]: unknown;
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new Error(`Couldn't reach the API at ${API_BASE}. Check that the backend is running.`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail ?? body?.message ?? body?.error;
    const message = Array.isArray(detail) ? detail.map((item) => item.msg).join(", ") : detail;
    if (response.status === 401) localStorage.removeItem(TOKEN_KEY);
    const error = new Error(message || `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function unwrap<T>(value: unknown, keys: string[] = []): T {
  let current = value as any;
  for (let i = 0; i < 3 && current && typeof current === "object"; i += 1) {
    if (Array.isArray(current)) return current as T;
    const key = keys.find((candidate) => current[candidate] !== undefined);
    if (key) return current[key] as T;
    if (current.data !== undefined) current = current.data;
    else break;
  }
  return current as T;
}

export function asList<T>(value: unknown, keys: string[] = []): T[] {
  const result = unwrap<unknown>(value, keys);
  return Array.isArray(result) ? result as T[] : [];
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<any>("/api/auth/register", { method: "POST", body: JSON.stringify({ name, full_name: name, email, password }) }),
  login: async (email: string, password: string) => {
    try {
      return await request<any>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, username: email, password }) });
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (![400, 404, 405, 415, 422].includes(status ?? 0)) throw error;
      const form = new URLSearchParams({ username: email, password });
      return request<any>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
    }
  },
  me: () => request<any>("/api/auth/me"),
  documents: async () => {
    try {
      return await request<any>("/api/documents");
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 404) throw error;
      return request<any>("/api/documents/list");
    }
  },
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>("/api/documents/upload", { method: "POST", body });
  },
  documentStatus: (id: string | number) => request<any>(`/api/documents/${encodeURIComponent(id)}/status`),
  deleteDocument: (id: string | number) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  documentPage: (id: string | number, page: number) =>
    request<any>(`/api/documents/${encodeURIComponent(id)}/pages/${page}`),
  documentFile: (id: string | number) =>
    `${API_BASE}/api/documents/${encodeURIComponent(id)}/file`,
  sessions: () => request<any>("/api/chat/sessions"),
  createSession: (title?: string) =>
    request<any>("/api/chat/sessions", { method: "POST", body: JSON.stringify(title ? { title } : {}) }),
  messages: (id: string | number) => request<any>(`/api/chat/sessions/${encodeURIComponent(id)}`),
  sendMessage: (id: string | number, content: string, documentIds?: string[]) =>
    request<any>(`/api/chat/sessions/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message: content, ...(documentIds?.length ? { document_ids: documentIds } : {}) }),
    }),
};

export function accessToken(response: any): string | undefined {
  return response?.access_token ?? response?.token ?? response?.data?.access_token ?? response?.data?.token;
}

export function userFrom(response: any): User {
  const value = response?.user ?? response?.data?.user ?? response?.data ?? response;
  return {
    id: value?.id,
    name: value?.name ?? value?.full_name ?? value?.username,
    email: value?.email ?? "",
  };
}
