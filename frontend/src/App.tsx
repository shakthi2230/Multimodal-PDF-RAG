import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, FileText, Files, Filter, LayoutDashboard,
  LoaderCircle, LogOut, Menu, MessageSquareText, MoreHorizontal, Plus, Search,
  Send, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, X, Zap,
} from "lucide-react";
import {
  accessToken, api, asList, API_BASE, ChatMessage, ChatSession, Citation, DocumentItem, TOKEN_KEY,
  unwrap, User, userFrom,
} from "./lib/api";

type View = "overview" | "documents" | "chat";
type Notice = { kind: "error" | "success"; text: string } | null;

const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const idOf = (item: any) => item?.id ?? item?.document_id ?? item?.session_id ?? item?.uuid;
const docName = (doc: DocumentItem) => doc.filename ?? text((doc as any).name, "Untitled document");
const statusOf = (doc: DocumentItem) => text(doc.status, "ready").toLowerCase();
const messageContent = (message: ChatMessage) => text(message.content ?? message.message);
const citationList = (message: ChatMessage): Citation[] => {
  const found = message.citations ?? message.sources ?? [];
  return Array.isArray(found) ? found : [];
};
const readableDate = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Recently added";
const formatSize = (value?: number) => value == null ? "PDF document" : value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<DocumentItem | null>(null);
  const [pdfData, setPdfData] = useState<any>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [chatBusy, setChatBusy] = useState(false);

  const refreshWorkspace = useCallback(async () => {
    setLoadingWorkspace(true);
    try {
      const [documentResult, sessionResult] = await Promise.all([api.documents(), api.sessions()]);
      setDocs(asList<DocumentItem>(documentResult, ["documents", "items", "results"]));
      setSessions(asList<ChatSession>(sessionResult, ["sessions", "items", "results"]));
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't load your workspace." });
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setBooting(false);
      return;
    }
    api.me().then((result) => {
      setUser(unwrap<User>(result, ["user"]));
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    }).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (user) void refreshWorkspace();
  }, [user, refreshWorkspace]);

  useEffect(() => {
    if (!docs.some((doc) => ["pending", "queued", "processing", "in_progress"].includes(statusOf(doc)))) return;
    const timer = window.setInterval(() => {
      void Promise.all(docs.filter((doc) => ["pending", "queued", "processing", "in_progress"].includes(statusOf(doc))).map(async (doc) => {
        try {
          const result = await api.documentStatus(idOf(doc));
          const update = unwrap<any>(result, ["document", "status"]);
          setDocs((items) => items.map((item) => idOf(item) === idOf(doc) ? { ...item, ...(typeof update === "string" ? { status: update } : update) } : item));
        } catch { /* keep the last known status; a later refresh can retry */ }
      }));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [docs]);

  const openSession = async (session: ChatSession) => {
    setActiveSession(session);
    setView("chat");
    setMessages([]);
    try {
      const result = await api.messages(idOf(session));
      setMessages(asList<ChatMessage>(result, ["messages", "items", "results"]));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't load this conversation." });
    }
  };

  const createSession = async () => {
    setChatBusy(true);
    try {
      const result = await api.createSession();
      const session = unwrap<ChatSession>(result, ["session"]);
      if (idOf(session) == null) throw new Error("The API created a session but didn't return its ID.");
      setSessions((old) => [session, ...old.filter((item) => idOf(item) !== idOf(session))]);
      setActiveSession(session);
      setMessages([]);
      setView("chat");
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't start a conversation." });
    } finally {
      setChatBusy(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!accepted.length) {
      setNotice({ kind: "error", text: "Choose a PDF file to upload." });
      return;
    }
    for (const file of accepted) {
      try {
        await api.upload(file);
      } catch (error) {
        setNotice({ kind: "error", text: `${file.name}: ${error instanceof Error ? error.message : "Upload failed."}` });
        return;
      }
    }
    setNotice({ kind: "success", text: `${accepted.length === 1 ? accepted[0].name : `${accepted.length} PDFs`} added to your library.` });
    await refreshWorkspace();
  };

  const deleteDocument = async (doc: DocumentItem) => {
    if (!window.confirm(`Delete "${docName(doc)}" from your library?`)) return;
    try {
      await api.deleteDocument(idOf(doc));
      setDocs((items) => items.filter((item) => idOf(item) !== idOf(doc)));
      setNotice({ kind: "success", text: "Document deleted." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't delete this document." });
    }
  };

  const viewDocument = async (doc: DocumentItem, page = 1) => {
    setPdfDocument(doc);
    setPdfPage(page);
    setPdfData(null);
    setPdfLoading(true);
    try {
      const result = await api.documentPage(idOf(doc), page);
      setPdfData({ ...unwrap<any>(result, ["document", "data"]), pdf_url: api.documentFile(idOf(doc)) });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't load this document." });
    } finally {
      setPdfLoading(false);
    }
  };

  const navigatePdfPage = async (page: number) => {
    setPdfPage(page);
    if (!pdfDocument) return;
    try {
      const result = await api.documentPage(idOf(pdfDocument), page);
      setPdfData({ ...unwrap<any>(result, ["document", "data"]), pdf_url: api.documentFile(idOf(pdfDocument)) });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't load this page." });
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setDocs([]);
    setSessions([]);
    setActiveSession(null);
  };

  if (booting) return <div className="boot-screen"><span className="brand-mark"><BookOpen size={19} /></span><LoaderCircle className="spin" size={20} /></div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><BookOpen size={19} /></span><span>folium</span><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="workspace-picker"><div className="workspace-avatar">F</div><div className="workspace-label"><strong>My workspace</strong><span>Personal plan</span></div><ChevronDown size={15} /></div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="main-nav">
          <button className={view === "overview" ? "nav-link selected" : "nav-link"} onClick={() => { setView("overview"); setMobileNav(false); }}><LayoutDashboard size={17} />Overview</button>
          <button className={view === "documents" ? "nav-link selected" : "nav-link"} onClick={() => { setView("documents"); setMobileNav(false); }}><Files size={17} />Documents<span className="nav-count">{docs.length}</span></button>
          <button className={view === "chat" ? "nav-link selected" : "nav-link"} onClick={() => { setView("chat"); setMobileNav(false); }}><MessageSquareText size={17} />Ask your PDFs</button>
        </nav>
        <div className="nav-divider" />
        <div className="recent-header"><span className="nav-section-label">RECENT CHATS</span><button className="icon-button subtle" onClick={() => void createSession()} aria-label="New chat"><Plus size={16} /></button></div>
        <div className="recent-list">
          {sessions.slice(0, 7).map((session) => <button key={String(idOf(session))} className={`recent-chat ${idOf(activeSession) === idOf(session) ? "active" : ""}`} onClick={() => void openSession(session)}><MessageSquareText size={15} /><span>{text(session.title, "New conversation")}</span></button>)}
          {!sessions.length && <div className="sidebar-empty">Your conversations will appear here.</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><CircleHelp size={17} /></span><div><strong>Need a hand?</strong><small>Explore the getting started guide</small></div><ArrowUpRight size={14} /></div>
          <div className="profile-row"><div className="user-avatar">{(user.name || user.email || "U").slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{user.name || user.email.split("@")[0]}</strong><span>{user.email}</span></div><button className="icon-button subtle" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="breadcrumb"><span>My workspace</span><ChevronRight size={14} /><strong>{view === "overview" ? "Overview" : view === "documents" ? "Documents" : "Ask your PDFs"}</strong></div>
          <div className="topbar-actions"><div className="api-indicator"><span className="online-dot" />Connected</div><button className="topbar-avatar" title={user.email}>{(user.name || user.email).slice(0, 1).toUpperCase()}</button></div>
        </header>
        <div className="content-wrap">
          {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "error" ? "Something needs your attention" : "All set"}</span><p>{notice.text}</p><button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}
          {view === "overview" && <Overview docs={docs} sessions={sessions} loading={loadingWorkspace} user={user} onUpload={uploadFiles} onOpenDocs={() => setView("documents")} onOpenChat={() => void createSession()} onViewDocument={viewDocument} onOpenSession={openSession} />}
          {view === "documents" && <Documents docs={docs} loading={loadingWorkspace} onUpload={uploadFiles} onDelete={deleteDocument} onView={viewDocument} onRefresh={refreshWorkspace} />}
          {view === "chat" && <ChatView docs={docs} sessions={sessions} activeSession={activeSession} messages={messages} busy={chatBusy} onNew={createSession} onOpen={openSession} onOpenDocuments={() => setView("documents")} onSend={async (message, documentIds) => {
            if (!activeSession) return;
            setChatBusy(true);
            setMessages((items) => [...items, { role: "user", content: message, id: `pending-${Date.now()}` }]);
            try {
              const result = await api.sendMessage(idOf(activeSession), message, documentIds);
              const sent = unwrap<any>(result, ["message", "response"]);
              if (Array.isArray(result?.messages)) setMessages(result.messages);
              else if (sent && typeof sent === "object" && (sent.content || sent.message || sent.role) && sent.role !== "user") {
                setMessages((items) => [...items, sent]);
              } else {
                const refreshed = await api.messages(idOf(activeSession));
                setMessages(asList<ChatMessage>(refreshed, ["messages", "items", "results"]));
              }
              setNotice(null);
              const refreshedSessions = await api.sessions().catch(() => null);
              if (refreshedSessions) setSessions(asList<ChatSession>(refreshedSessions, ["sessions", "items", "results"]));
            } catch (error) {
              setMessages((items) => items.filter((item) => !String(item.id ?? "").startsWith("pending-")));
              setNotice({ kind: "error", text: error instanceof Error ? error.message : "Message wasn't sent." });
            } finally { setChatBusy(false); }
          }} onCitation={viewDocument} />}
        </div>
      </main>
      {pdfDocument && <PdfViewer document={pdfDocument} data={pdfData} page={pdfPage} loading={pdfLoading} onPage={navigatePdfPage} onClose={() => setPdfDocument(null)} />}
    </div>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      let result: any;
      if (mode === "register") {
        result = await api.register(name, email, password);
        const token = accessToken(result);
        if (!token) {
          result = await api.login(email, password);
        }
      } else {
        result = await api.login(email, password);
      }
      let token = accessToken(result);
      if (!token) {
        const form = new URLSearchParams({ username: email, password });
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail ?? "Unable to sign in with those details.");
        result = data;
        token = accessToken(data);
      }
      if (!token) throw new Error("The authentication response didn't include an access token.");
      localStorage.setItem(TOKEN_KEY, token);
      const responseUser = userFrom(result);
      if (!responseUser.email) {
        try { onAuthenticated(userFrom(await api.me())); return; } catch { /* use the submitted identity if /me isn't available yet */ }
      }
      onAuthenticated({ ...responseUser, name: responseUser.name ?? name, email: responseUser.email || email });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-brand"><span className="brand-mark"><BookOpen size={19} /></span><span>folium</span></div>
        <div className="auth-hero"><span className="eyebrow"><Sparkles size={14} /> YOUR DOCUMENTS, IN CONTEXT</span><h1>Make every page<br />part of the conversation.</h1><p>Bring your PDFs together. Ask questions, uncover insights, and trace every answer back to its source.</p>
          <div className="auth-quote"><div className="quote-lines"><span /><span /><span /></div><div className="quote-copy"><strong>“What are the key findings?”</strong><span>Grounded answers. Clear citations. No guesswork.</span></div><div className="quote-sparkle"><Sparkles size={20} /></div></div>
          <div className="auth-proof"><span><ShieldCheck size={15} /> Private by design</span><span><Zap size={14} /> Answers in seconds</span></div>
        </div>
        <div className="auth-footer">© 2025 Folium AI <span>Thoughtful tools for thoughtful work</span></div>
      </div>
      <div className="auth-right">
        <div className="auth-mobile-brand"><span className="brand-mark"><BookOpen size={19} /></span><span>folium</span></div>
        <div className="auth-form-wrap">
          <div className="form-heading"><span className="eyebrow">WELCOME {mode === "login" ? "BACK" : "ABOARD"}</span><h2>{mode === "login" ? "Sign in to Folium" : "Create your account"}</h2><p>{mode === "login" ? "Pick up right where you left off." : "Your document library starts here."}</p></div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && <label>Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Smith" required /></label>}
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
            <label className="password-label"><span>Password</span>{mode === "login" && <button type="button" className="text-button" onClick={() => setError("Password recovery isn't configured. Contact your workspace administrator.")}>Forgot password?</button>}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></label>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="button primary auth-submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17} />Working…</> : <>{mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={16} /></>}</button>
          </form>
          <div className="auth-switch">{mode === "login" ? "New to Folium?" : "Already have an account?"}<button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in instead"}</button></div>
          <div className="auth-terms">By continuing, you agree to our <a href="#terms" onClick={(event) => event.preventDefault()}>Terms of Service</a> and <a href="#privacy" onClick={(event) => event.preventDefault()}>Privacy Policy</a>.</div>
        </div>
        <div className="auth-right-footer"><span>Secure, source-grounded document intelligence</span><span><ShieldCheck size={14} /> Your data stays yours</span></div>
      </div>
    </div>
  );
}

function Overview({ docs, sessions, loading, user, onUpload, onOpenDocs, onOpenChat, onViewDocument, onOpenSession }: {
  docs: DocumentItem[]; sessions: ChatSession[]; loading: boolean; user: User;
  onUpload: (files: FileList | File[]) => void; onOpenDocs: () => void; onOpenChat: () => void;
  onViewDocument: (doc: DocumentItem, page?: number) => void; onOpenSession: (session: ChatSession) => void;
}) {
  const readyDocs = docs.filter((doc) => ["ready", "processed", "completed", "complete"].includes(statusOf(doc))).length;
  const firstName = user.name?.split(" ")[0] || user.email.split("@")[0] || "there";
  return <section className="dashboard fade-in">
    <div className="page-heading overview-heading"><div><div className="greeting">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</div><h1>Good afternoon, {firstName}<span className="wave">✳</span></h1><p>Your knowledge workspace is ready when you are.</p></div><button className="button primary" onClick={onOpenChat}><Plus size={17} />New conversation</button></div>
    <div className="welcome-panel"><div className="welcome-copy"><span className="welcome-kicker"><Sparkles size={14} /> YOUR AI RESEARCH PARTNER</span><h2>Find the signal in<br />your documents.</h2><p>Ask a question across your PDFs. Folium connects the dots and shows you exactly where the answers came from.</p><button className="button dark-button" onClick={onOpenChat}>Start asking <ArrowRight size={16} /></button></div><div className="welcome-art" aria-hidden="true"><div className="art-glow" /><div className="art-document doc-back"><div /><div /><div /></div><div className="art-document doc-front"><div className="art-doc-icon"><FileText size={16} /></div><span className="art-title-line" /><span /><span /><span className="short-line" /><div className="art-highlight" /></div><div className="art-chat"><Sparkles size={14} /><span>Three themes emerge across your reports…</span></div><div className="art-orbit orbit-a" /><div className="art-orbit orbit-b" /></div><div className="welcome-scribble">Answers you can trust, down to the page.</div></div>
    <div className="stats-row"><StatCard icon={<Files size={17} />} label="In your library" value={loading ? "—" : docs.length.toString()} meta="PDF documents" tone="blue" /><StatCard icon={<Check size={17} />} label="Ready to explore" value={loading ? "—" : readyDocs.toString()} meta="Processed and searchable" tone="green" /><StatCard icon={<MessageSquareText size={17} />} label="Conversations" value={loading ? "—" : sessions.length.toString()} meta="Across your workspace" tone="purple" /><StatCard icon={<Clock3 size={17} />} label="Recently added" value={docs.length ? readableDate(docs[0].created_at) : "—"} meta="Latest document" tone="amber" /></div>
    <div className="dashboard-columns"><section className="panel library-panel"><div className="panel-heading"><div><h3>Your library</h3><p>Documents ready for a closer look</p></div><button className="link-button" onClick={onOpenDocs}>View all <ArrowRight size={14} /></button></div>{docs.length ? <div className="compact-doc-list">{docs.slice(0, 4).map((doc) => <button className="compact-doc" key={String(idOf(doc))} onClick={() => onViewDocument(doc)}><span className="pdf-badge">PDF</span><span className="compact-doc-name"><strong>{docName(doc)}</strong><small>{formatSize(doc.file_size)} <i /> {readableDate(doc.created_at)}</small></span><StatusPill status={statusOf(doc)} /><ChevronRight className="row-chevron" size={16} /></button>)}</div> : <EmptyState icon={<Files size={20} />} title="Your library is waiting" copy="Upload your first PDF to get started." action={<UploadButton onUpload={onUpload} compact />} />}</section>
    <section className="panel activity-panel"><div className="panel-heading"><div><h3>Recent conversations</h3><p>Pick up where you left off</p></div><span className="activity-icon"><MessageSquareText size={16} /></span></div>{sessions.length ? <div className="recent-session-list">{sessions.slice(0, 4).map((session, index) => <button key={String(idOf(session))} className="session-row" onClick={() => onOpenSession(session)}><span className={`session-dot dot-${index % 3}`}><MessageSquareText size={14} /></span><span><strong>{text(session.title, "New conversation")}</strong><small>{readableDate(session.updated_at ?? session.created_at)}</small></span><ChevronRight size={15} /></button>)}</div> : <EmptyState icon={<MessageSquareText size={20} />} title="No conversations yet" copy="Ask a question about your documents." action={<button className="link-button" onClick={onOpenChat}>Start a conversation <ArrowRight size={14} /></button>} />}</section></div>
    <div className="upload-strip"><div className="upload-strip-icon"><UploadCloud size={19} /></div><div><strong>Bring your research together</strong><span>Upload reports, papers, and other PDFs to your library.</span></div><UploadButton onUpload={onUpload} /></div>
  </section>;
}

function StatCard({ icon, label, value, meta, tone }: { icon: React.ReactNode; label: string; value: string; meta: string; tone: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-meta">{meta}</span></div>;
}

function UploadButton({ onUpload, compact = false }: { onUpload: (files: FileList | File[]) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return compact ? <><input ref={ref} className="visually-hidden" type="file" accept=".pdf,application/pdf" multiple onChange={(event) => { if (event.target.files) onUpload(event.target.files); event.target.value = ""; }} /><button className="button small-button" onClick={() => ref.current?.click()}><Plus size={15} />Add PDF</button></> :
    <div className={`upload-dropzone ${drag ? "drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(event) => { event.preventDefault(); setDrag(false); onUpload(event.dataTransfer.files); }}>
      <input ref={ref} className="visually-hidden" type="file" accept=".pdf,application/pdf" multiple onChange={(event) => { if (event.target.files) onUpload(event.target.files); event.target.value = ""; }} />
      <span className="upload-icon"><UploadCloud size={20} /></span><div><strong>Drop PDFs here, or <button className="text-button" onClick={() => ref.current?.click()}>browse files</button></strong><span>PDF files up to 50 MB each</span></div><button className="button small-button" onClick={() => ref.current?.click()}><Plus size={15} />Upload PDF</button>
    </div>;
}

function StatusPill({ status }: { status: string }) {
  const style = status.includes("fail") || status.includes("error") ? "status-error" : ["ready", "completed", "complete", "processed"].includes(status) ? "status-ready" : "status-processing";
  const label = style === "status-ready" ? "Ready" : style === "status-error" ? "Failed" : status === "pending" ? "Queued" : "Processing";
  return <span className={`status-pill ${style}`}><i />{label}</span>;
}

function EmptyState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{copy}</p>{action}</div>;
}

function Documents({ docs, loading, onUpload, onDelete, onView, onRefresh }: {
  docs: DocumentItem[]; loading: boolean; onUpload: (files: FileList | File[]) => void;
  onDelete: (doc: DocumentItem) => void; onView: (doc: DocumentItem) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => docs.filter((doc) => docName(doc).toLowerCase().includes(query.toLowerCase())), [docs, query]);
  return <section className="documents-page fade-in"><div className="page-heading"><div><div className="eyebrow">YOUR KNOWLEDGE BASE</div><h1>Documents</h1><p>Manage your PDFs and see what's ready to explore.</p></div><UploadButton onUpload={onUpload} compact /></div>
    <div className="document-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search documents…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></div><button className="button outline-button" onClick={onRefresh}><Filter size={15} />Refresh</button><span className="item-count">{docs.length} {docs.length === 1 ? "document" : "documents"}</span></div>
    <div className="document-table panel"><div className="table-header"><span>NAME</span><span>STATUS</span><span>ADDED</span><span>SIZE</span><span /></div>
      {loading ? <div className="table-empty"><LoaderCircle className="spin" size={20} />Loading your documents…</div> : filtered.length ? filtered.map((doc) => <div className="document-row" key={String(idOf(doc))}><button className="document-name" onClick={() => onView(doc)}><span className="pdf-badge">PDF</span><span><strong>{docName(doc)}</strong><small>{doc.pages ?? doc.page_count ?? (doc as any).num_pages ?? "—"} pages</small></span></button><span><StatusPill status={statusOf(doc)} /></span><span className="table-date">{readableDate(doc.created_at)}</span><span className="table-size">{formatSize(doc.file_size)}</span><div className="row-actions"><button className="icon-button" title="Open document" onClick={() => onView(doc)}><ArrowUpRight size={16} /></button><button className="icon-button danger-hover" title="Delete document" onClick={() => onDelete(doc)}><Trash2 size={16} /></button></div></div>) : <div className="table-empty"><EmptyState icon={<FileText size={21} />} title={query ? "No matching documents" : "No documents yet"} copy={query ? "Try another search." : "Upload a PDF and it will appear here."} action={!query ? <UploadButton onUpload={onUpload} compact /> : null} /></div>}
    </div><p className="privacy-note"><ShieldCheck size={14} /> Documents are private to your workspace.</p>
  </section>;
}

function ChatView({ docs, sessions, activeSession, messages, busy, onNew, onOpen, onOpenDocuments, onSend, onCitation }: {
  docs: DocumentItem[]; sessions: ChatSession[]; activeSession: ChatSession | null; messages: ChatMessage[];
  busy: boolean; onNew: () => void; onOpen: (session: ChatSession) => void; onOpenDocuments: () => void;
  onSend: (message: string, documentIds?: string[]) => void;
  onCitation: (doc: DocumentItem, page?: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<string[] | null>(null);
  const [showSources, setShowSources] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const send = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;
    if (!docs.length || selectedDocs?.length === 0) return;
    if (!activeSession) {
      onNew();
      setDraft(value);
      return;
    }
    onSend(value, selectedDocs ?? undefined);
    setDraft("");
  };
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  const starters = ["Summarize the key findings", "What evidence supports the main claim?", "Compare the conclusions across these reports"];
  return <section className="chat-page fade-in"><div className="chat-sidebar"><div className="chat-sidebar-top"><div><span className="eyebrow">YOUR RESEARCH</span><h2>Conversations</h2></div><button className="icon-button new-chat-icon" onClick={onNew} aria-label="New conversation"><Plus size={17} /></button></div><button className="button primary new-chat-button" onClick={onNew}><Plus size={16} />New conversation</button><div className="chat-session-label">RECENT</div><div className="chat-session-list">{sessions.map((session, index) => <button key={String(idOf(session))} className={`chat-session ${idOf(activeSession) === idOf(session) ? "current" : ""}`} onClick={() => onOpen(session)}><span className={`chat-session-mark m-${index % 3}`}><MessageSquareText size={14} /></span><span><strong>{text(session.title, "New conversation")}</strong><small>{readableDate(session.updated_at ?? session.created_at)}</small></span></button>)}{sessions.length === 0 && <p className="sidebar-empty">Start a conversation to see it here.</p>}</div><div className="chat-library-box"><div className="library-box-head"><span className="library-mini-icon"><Files size={15} /></span><strong>Using your library</strong><button className="icon-button" onClick={() => setShowSources(!showSources)} aria-label="Choose documents"><Settings2 size={15} /></button></div><p>{docs.length ? `${selectedDocs === null ? docs.length : selectedDocs.length} of ${docs.length} documents included` : "Add PDFs to start asking questions."}</p>  {showSources && docs.length > 0 && <div className="source-select-list">{docs.map((doc) => {
    const ids = docs.map((item) => String(idOf(item)));
    const isChecked = selectedDocs === null || selectedDocs.includes(String(idOf(doc)));
    return <label key={String(idOf(doc))}><input type="checkbox" checked={isChecked} onChange={(event) => setSelectedDocs((old) => {
      const current = old ?? ids;
      const updated = event.target.checked ? [...new Set([...current, String(idOf(doc))])] : current.filter((id) => id !== String(idOf(doc)));
      return updated.length === ids.length ? null : updated;
    })} /><span>{docName(doc)}</span></label>;
  })}</div>}</div></div>
    <div className="chat-main"><div className="chat-topline"><div><span className="eyebrow">FOLIUM ASSISTANT</span><span className="assistant-live"><i />Grounded in your PDFs</span></div><button className="icon-button" title="More options"><MoreHorizontal size={19} /></button></div>
      <div className="message-scroll">
        {!activeSession && messages.length === 0 && <div className="chat-welcome"><div className="chat-orb"><span><Sparkles size={22} /></span><i /><i /></div><div className="eyebrow">YOUR DOCUMENTS, CONNECTED</div><h1>What would you like<br />to understand?</h1><p>Ask a question and I'll find relevant passages across your PDFs, with citations you can verify.</p>        {docs.length ? <div className="starter-grid">{starters.map((starter, index) => <button key={starter} onClick={() => setDraft(starter)}><span>{index === 0 ? <BookOpen size={16} /> : index === 1 ? <Search size={16} /> : <Files size={16} />}</span>{starter}<ArrowUpRight size={14} /></button>)}</div> : <div className="chat-no-docs"><Files size={18} /><span>Upload a PDF in <button className="text-button" onClick={onOpenDocuments}>Documents</button> to begin.</span></div>}</div>}
        {messages.map((message, index) => {
          const isUser = (message.role ?? "").toLowerCase() === "user";
          const citations = citationList(message);
          return <div className={`message-row ${isUser ? "from-user" : "from-assistant"}`} key={String(message.id ?? index)}>{!isUser && <span className="message-avatar"><Sparkles size={14} /></span>}<div className="message-body"><div className="message-author">{isUser ? "You" : "Folium"}<span>{message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span></div><div className="message-content">{messageContent(message) || "…"}</div>{!isUser && <MessageExtras message={message} />}{!isUser && citations.length > 0 && <div className="citation-list"><div className="citation-heading"><BookOpen size={14} />Sources <span>{citations.length}</span></div>{citations.map((citation, citationIndex) => {
            const doc = docs.find((item) => String(idOf(item)) === String(citation.document_id ?? citation.documentId) || docName(item) === (citation.filename ?? citation.document_name));
            const page = Number(citation.page ?? citation.page_number ?? 1);
            return <button className="citation-card" key={citationIndex} onClick={() => doc && onCitation(doc, page)}><span className="citation-ref">{citationIndex + 1}</span><span><strong>{citation.filename ?? citation.document_name ?? (doc ? docName(doc) : "Source document")}</strong><small>Page {page}{citation.quote || citation.text ? ` · “${text(citation.quote ?? citation.text).slice(0, 118)}${text(citation.quote ?? citation.text).length > 118 ? "…" : ""}”` : ""}</small></span><ArrowUpRight size={14} /></button>;
          })}</div>}{!isUser && !citations.length && messageContent(message) && <div className="no-citation-note"><ShieldCheck size={13} />No source citations were returned for this answer.</div>}</div></div>;
        })}
        {busy && <div className="message-row from-assistant"><span className="message-avatar"><Sparkles size={14} /></span><div className="message-body"><div className="message-author">Folium <span>Thinking</span></div><div className="thinking"><i /><i /><i /></div></div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="composer-wrap"><form className="composer" onSubmit={send}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(event as unknown as FormEvent); } }} placeholder={docs.length ? "Ask a question about your documents…" : "Add a PDF to start a conversation…"} rows={1} disabled={!docs.length || busy} /><div className="composer-tools"><div className="composer-left"><span className="grounded-indicator"><ShieldCheck size={13} />Source-grounded</span><span className="composer-context">{selectedDocs === null ? `${docs.length} docs` : `${selectedDocs.length} docs`}</span></div><span className="enter-hint">↵ to send</span><button className="send-button" type="submit" disabled={!draft.trim() || busy || !docs.length || selectedDocs?.length === 0} aria-label="Send message">{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={16} />}</button></div></form><div className="composer-disclaimer">Folium can make mistakes. Verify important information with the cited source documents.</div></div>
    </div>
  </section>;
}

function MessageExtras({ message }: { message: ChatMessage }) {
  const tables = Array.isArray(message.tables) ? message.tables : message.table ? [message.table] : [];
  const figures = Array.isArray(message.figures) ? message.figures : message.figure ? [message.figure] : [];
  const cellText = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : value == null ? "" : JSON.stringify(value);
  return <>
    {tables.map((table: any, index: number) => {
      const rows = Array.isArray(table?.rows) ? table.rows : Array.isArray(table?.data) ? table.data : [];
      const headers = Array.isArray(table?.headers) ? table.headers : Array.isArray(table?.columns) ? table.columns : rows.length && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [];
      return <div className="answer-table-wrap" key={`table-${index}`}><div className="answer-visual-title"><Files size={13} />{text(table?.title ?? table?.caption, `Table ${index + 1}`)}{table?.page ?? table?.page_number ? <span>Page {table.page ?? table.page_number}</span> : null}</div><div className="answer-table-scroll"><table className="answer-table">{headers.length > 0 && <thead><tr>{headers.map((header: unknown, column: number) => <th key={column}>{cellText(header)}</th>)}</tr></thead>}<tbody>{rows.map((row: any, rowIndex: number) => <tr key={rowIndex}>{(Array.isArray(row) ? row : headers.map((header: unknown) => row?.[String(header)])).map((cell: unknown, column: number) => <td key={column}>{cellText(cell)}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="visual-empty">Table data wasn't included in the response.</div>}</div></div>;
    })}
    {figures.map((figure: any, index: number) => {
      const image = figure?.image_url ?? figure?.url ?? figure?.src ?? figure?.image ?? figure?.data_url;
      const imageSrc = typeof image === "string" && image.length && !image.startsWith("http") && !image.startsWith("/") && !image.startsWith("data:") ? `data:image/png;base64,${image}` : image;
      return <figure className="answer-figure" key={`figure-${index}`}>{imageSrc && <img src={imageSrc} alt={text(figure?.alt ?? figure?.caption, `Figure ${index + 1}`)} />}<figcaption><span className="answer-visual-title"><FileText size={13} />{text(figure?.title ?? figure?.caption, `Figure ${index + 1}`)}{figure?.page ?? figure?.page_number ? <span>Page {figure.page ?? figure.page_number}</span> : null}</span>{figure?.description && <span className="figure-description">{text(figure.description)}</span>}{!imageSrc && !figure?.description && <span className="visual-empty">Figure content wasn't included in the response.</span>}</figcaption></figure>;
    })}
  </>;
}

function PdfViewer({ document, data, page, loading, onPage, onClose }: {
  document: DocumentItem; data: any; page: number; loading: boolean; onPage: (page: number) => void; onClose: () => void;
}) {
  const [pdfSrc, setPdfSrc] = useState("");
  const [pdfError, setPdfError] = useState("");
  const pages = Array.isArray(data) ? data : Array.isArray(data?.pages) ? data.pages : [];
  const pdfUrl = data?.pdf_url ?? data?.url ?? data?.file_url ?? data?.download_url ?? (document as any).pdf_url ?? (document as any).url;
  const pageItem = pages[page - 1] ?? (data?.page_number === page ? data : null);
  const total = Number(data?.page_count ?? data?.total_pages ?? document.pages ?? document.page_count ?? pages.length ?? 0);
  const token = localStorage.getItem(TOKEN_KEY);
  const authenticatedUrl = typeof pdfUrl === "string" && pdfUrl.startsWith("http")
    ? pdfUrl : pdfUrl ? `${API_BASE}${String(pdfUrl).startsWith("/") ? "" : "/"}${pdfUrl}` : "";
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setPdfSrc("");
    setPdfError("");
    if (!authenticatedUrl) return;
    const loadPdf = async () => {
      try {
        const headers = new Headers();
        if (token && new URL(authenticatedUrl).origin === new URL(API_BASE).origin) headers.set("Authorization", `Bearer ${token}`);
        const response = await fetch(authenticatedUrl, { headers });
        if (!response.ok) throw new Error(`The PDF preview couldn't be loaded (${response.status}).`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPdfSrc(objectUrl);
      } catch (error) {
        if (active) setPdfError(error instanceof Error ? error.message : "The PDF preview couldn't be loaded.");
      }
    };
    void loadPdf();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authenticatedUrl, token]);
  return <div className="pdf-overlay" role="dialog" aria-modal="true" aria-label="Document viewer"><button className="pdf-scrim" onClick={onClose} aria-label="Close document viewer" /><div className="pdf-panel"><div className="pdf-toolbar"><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button><span className="pdf-toolbar-icon"><FileText size={16} /></span><strong>{docName(document)}</strong><span className="pdf-toolbar-spacer" /><button className="icon-button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={17} /></button><span className="page-count">{page}{total ? ` / ${total}` : ""}</span><button className="icon-button" onClick={() => onPage(total ? Math.min(total, page + 1) : page + 1)} disabled={!!total && page >= total} aria-label="Next page"><ChevronRight size={17} /></button><button className="icon-button pdf-close" onClick={onClose} aria-label="Close viewer"><X size={18} /></button></div><div className="pdf-view-area">{loading || (authenticatedUrl && !pdfSrc && !pdfError) ? <div className="pdf-loading"><LoaderCircle className="spin" size={24} /><span>Loading document…</span></div> : pdfSrc ? <iframe key={pdfSrc} className="pdf-frame" src={`${pdfSrc}#page=${page}`} title={docName(document)} /> : pageItem ? <div className="page-paper"><div className="page-meta">{docName(document)} <span>Page {page}</span></div>{pageItem.image_url || pageItem.image ? <img className="page-image" src={pageItem.image_url ?? pageItem.image} alt={`Page ${page}`} /> : <div className="page-text-content">{text(pageItem.text ?? pageItem.content ?? pageItem.markdown, "No extracted page text was provided by the API.")}</div>}</div> : <div className="pdf-unavailable"><span className="pdf-empty-icon"><FileText size={25} /></span><h3>{pdfError ? "Preview couldn't load" : "Preview unavailable"}</h3><p>{pdfError || "The API didn't return a PDF URL or extracted page content for this document."}</p></div>}</div></div></div>;
}

export default App;
