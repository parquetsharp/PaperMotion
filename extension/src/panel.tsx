import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Link2, Unplug, ExternalLink, Upload, FileText, Send, Plus, Trash2, ChevronLeft, ChevronRight, RefreshCw, MessageSquare, Layers, ListChecks, Network, Check, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { ChatThread, FlashcardSession, QuizSession } from "../../lib/work-context-types";
import type { KnowledgeGraph } from "../../lib/kg-types";
import { masteryScore } from "../../lib/kg-types";
import { api, ApiError, engineOrigin, fetchPdf, pdfHash, type Connection, type StudyDocument } from "./api";
import "katex/dist/katex.min.css";
import "./panel.css";

type SourceTab = { id: number; url: string; title: string };
type Binding = { origin: string; url: string; document: StudyDocument };
type DocumentCache = Record<string, StudyDocument>;
type Tool = "chat" | "flashcards" | "quizzes" | "concepts";

function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The operation failed. Please retry."); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, error, setError, run };
}

function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>{children}</ReactMarkdown></div>;
}

function Notice({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="notice">{children}</p> : null;
}

function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [origin, setOrigin] = useState("http://127.0.0.1:3000");
  const [settings, setSettings] = useState(false);
  const [source, setSource] = useState<SourceTab | null>(null);
  const sourceRef = useRef<SourceTab | null>(null);
  const [document, setDocument] = useState<StudyDocument | null>(null);
  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const task = useTask();

  useEffect(() => {
    const apply = (value?: Connection) => {
      setConsent(false);
      setConnection(value ?? null);
      if (value) { setOrigin(value.origin); setSettings(false); setPending(false); }
      setReady(true);
    };
    void chrome.storage.local.get("connection").then(result => apply(result.connection as Connection | undefined));
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.connection) apply(changes.connection.newValue as Connection | undefined);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  useEffect(() => {
    let epoch = 0;
    let disposed = false;
    const refresh = async () => {
      const currentEpoch = ++epoch;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const next = tab?.id ? { id: tab.id, url: tab.url ?? "", title: tab.title ?? "Current tab" } : null;
      const result = next ? await chrome.storage.session.get(`binding:${next.id}`) : {};
      if (disposed || currentEpoch !== epoch) return;
      const binding = next ? result[`binding:${next.id}`] as Binding | undefined : undefined;
      const sourceChanged = sourceRef.current?.id !== next?.id || sourceRef.current?.url !== next?.url;
      sourceRef.current = next;
      setSource(next);
      if (sourceChanged) setConsent(false);
      setDocument(binding && binding.origin === connection?.origin && binding.url === next?.url ? binding.document : null);
    };
    const updated = (_tabId: number, info: { url?: string; status?: string }) => { if (info.url || info.status === "complete") void refresh(); };
    void refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(updated);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, [connection]);

  async function pair() {
    await task.run(async () => {
      const localOrigin = engineOrigin(origin);
      await chrome.storage.session.set({ pendingPair: { origin: localOrigin, createdAt: Date.now() } });
      await chrome.tabs.create({ url: `${localOrigin}/extension/pair?extensionId=${chrome.runtime.id}` });
      setPending(true);
    });
  }

  async function importDocument(pdf: Blob, filename: string, tab: SourceTab | null) {
    if (!connection || !consent) return;
    setProgress("Importing document...");
    const digest = await pdfHash(pdf);
    const cacheKey = `${connection.origin}:${digest}`;
    const stored = await chrome.storage.local.get("documents");
    const cache = (stored.documents as DocumentCache | undefined) ?? {};
    let imported: StudyDocument | undefined = cache[cacheKey];
    if (imported) {
      try {
        const result = await api<StudyDocument>(connection, `doc/${imported.docId}`);
        imported = { docId: result.docId, filename: result.filename, numPages: result.numPages };
      }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; imported = undefined; }
    }
    if (!imported) {
      const form = new FormData();
      form.set("file", pdf, filename);
      const result = await api<StudyDocument>(connection, "upload", form);
      imported = { docId: result.docId, filename: result.filename, numPages: result.numPages };
      const fresh = await chrome.storage.local.get("documents");
      await chrome.storage.local.set({ documents: { ...(fresh.documents as DocumentCache | undefined), [cacheKey]: imported } });
    }
    if (tab) {
      await chrome.storage.session.set({ [`binding:${tab.id}`]: { origin: connection.origin, url: tab.url, document: imported } satisfies Binding });
    }
    if (sourceRef.current?.id === tab?.id && sourceRef.current?.url === tab?.url) setDocument(imported);
    setProgress("");
  }

  function studyTab() {
    const tab = source;
    void task.run(async () => {
      if (!tab?.url) throw new Error("The browser did not expose this tab's address. Reload PaperMotion on the browser's Extensions page and accept its tab-access permission, then reopen the sidebar on the PDF tab. If access is managed, ask your administrator.");
      const url = new URL(tab.url);
      const localFile = url.protocol === "file:";
      if (["https:", "http:"].includes(url.protocol)) {
        const allowed = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
        if (!allowed) throw new Error("Site access was not granted. Choose the PDF file instead.");
      }
      const fileAccessAllowed = localFile && await chrome.extension.isAllowedFileSchemeAccess();
      setProgress(localFile ? "Reading open PDF..." : "Downloading PDF...");
      const pdf = await fetchPdf(tab.url, fileAccessAllowed);
      const filename = decodeURIComponent(url.pathname.split("/").pop() || "document.pdf");
      await importDocument(pdf, /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`, tab);
    });
  }

  const openViewer = () => { if (connection && document) void chrome.tabs.create({ url: `${connection.origin}/viewer/${encodeURIComponent(document.docId)}` }); };
  if (!ready) return <main className="loading" role="status">Loading PaperMotion...</main>;
  return (
    <div className="app">
      <header className="brand"><BookOpen size={24} /><div><h1>PaperMotion</h1><span className="eyebrow">PDF STUDY COMPANION</span></div><button className="icon-button" title="Connection settings" aria-label="Connection settings" onClick={() => setSettings(!settings)}><Link2 size={19} /></button></header>
      {(!connection || settings) && <section className="connection">
        <h2>Local Engine</h2>
        <label htmlFor="engine">Engine address</label><input id="engine" type="url" value={origin} onChange={event => setOrigin(event.target.value)} />
        <div className="actions"><button className="primary" disabled={task.busy} onClick={() => void pair()}><Link2 size={16} />{connection ? "Manage Connection" : "Connect"}</button>{connection && <button title="Disconnect this browser" onClick={() => void chrome.storage.local.remove("connection")}><Unplug size={16} />Disconnect</button>}</div>
        {pending && <p role="status">Awaiting approval on the local engine page.</p>}
      </section>}
      {connection && <>
        <section className="import">
          <div className="connection-state"><span className="status-dot" />{new URL(connection.origin).host}<button className="icon-button" title="Check engine connection" aria-label="Check engine connection" disabled={task.busy} onClick={() => void task.run(async () => { await api(connection, "status"); setProgress("Engine connected."); })}><RefreshCw size={14} /></button></div>
          <p className="source-title" title={source?.url}><FileText size={16} /><span>{source?.title || "Current PDF"}</span></p>
          <label className="consent"><input type="checkbox" checked={consent} disabled={task.busy} onChange={event => setConsent(event.target.checked)} /><span>I agree to send this document&apos;s text to my configured AI provider when studying.</span></label>
          <div className="actions"><button className="primary" disabled={!consent || task.busy} onClick={studyTab}><BookOpen size={16} />Study This PDF</button><button disabled={!consent || task.busy} onClick={() => fileInput.current?.click()}><Upload size={16} />Choose File</button></div>
          <input ref={fileInput} aria-label="Choose PDF file" className="file-input" type="file" accept="application/pdf,.pdf" onChange={event => {
            const file = event.target.files?.[0];
            const tab = source;
            event.target.value = "";
            if (file) void task.run(() => importDocument(file, file.name, tab));
          }} />
        </section>
        {task.busy && <p className="status" role="status">{progress || "Working..."}</p>}
        {!task.busy && progress === "Engine connected." && <p className="status" role="status">{progress}</p>}
      </>}
      <Notice>{task.error}</Notice>
      {connection && document ? <>
        <section className="document"><div><h2>{document.filename}</h2><span>{document.numPages} pages</span></div><button className="icon-button" title="Open interactive viewer" aria-label="Open interactive viewer" onClick={openViewer}><ExternalLink size={18} /></button></section>
        <Study key={`${connection.origin}:${document.docId}`} connection={connection} document={document} openViewer={openViewer} />
      </> : connection && <div className="empty"><FileText size={36} /><h2>No Document Selected</h2></div>}
      <footer><ShieldCheck size={13} />Local storage. Your AI provider.</footer>
    </div>
  );
}

function Study({ connection, document, openViewer }: { connection: Connection; document: StudyDocument; openViewer: () => void }) {
  const [tool, setTool] = useState<Tool>("chat");
  const tabs = [{ id: "chat", label: "Chat", icon: MessageSquare }, { id: "flashcards", label: "Cards", icon: Layers }, { id: "quizzes", label: "Quiz", icon: ListChecks }, { id: "concepts", label: "Concepts", icon: Network }] as const;
  return <section className="study"><nav role="tablist" aria-label="Study tools">{tabs.map(tab => <button key={tab.id} id={`tab-${tab.id}`} role="tab" aria-selected={tool === tab.id} aria-controls="tool-panel" onClick={() => setTool(tab.id)}><tab.icon size={17} /><span>{tab.label}</span></button>)}</nav><div id="tool-panel" role="tabpanel" aria-labelledby={`tab-${tool}`}>
    {tool === "chat" && <Chat connection={connection} docId={document.docId} />}
    {(tool === "flashcards" || tool === "quizzes") && <Cards key={tool} connection={connection} docId={document.docId} tool={tool} />}
    {tool === "concepts" && <Concepts connection={connection} docId={document.docId} openViewer={openViewer} />}
  </div></section>;
}

type ToolProps = { connection: Connection; docId: string };

function Chat({ connection, docId }: ToolProps) {
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const task = useTask();
  const current = chats.find(chat => chat.id === selected);
  const lastMessage = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const { setError } = task;
  useEffect(() => {
    const controller = new AbortController();
    void api<{ chats: ChatThread[] }>(connection, `chat/${docId}`, undefined, "GET", controller.signal).then(result => {
      setChats(result.chats); setSelected(result.chats[0]?.id ?? "");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => setLoading(false));
    return () => { controller.abort(); if (dirty.current) void api(connection, `kg/${docId}/evaluate`, {}).catch(() => {}); };
  }, [connection, docId, setError]);
  useEffect(() => { lastMessage.current?.scrollIntoView({ block: "nearest" }); }, [current?.messages.length]);

  const update = (chat: ChatThread) => { setChats(previous => [chat, ...previous.filter(item => item.id !== chat.id)]); setSelected(chat.id); };
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    await task.run(async () => {
      let chat = current;
      if (!chat) { chat = (await api<{ chat: ChatThread }>(connection, `chat/${docId}`, { action: "create" })).chat; update(chat); }
      const result = await api<{ chat: ChatThread }>(connection, `chat/${docId}`, { action: "send", chatId: chat.id, message: text });
      update(result.chat); setMessage(""); dirty.current = true; setFinished(false);
    });
  }
  return <div className="tool-content">
    <div className="toolbar"><select aria-label="Chat history" value={selected} disabled={task.busy || loading} onChange={event => { setSelected(event.target.value); setFinished(false); }}><option value="">New chat</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select><button className="icon-button" title="New chat" aria-label="New chat" disabled={task.busy} onClick={() => { setSelected(""); setMessage(""); setFinished(false); }}><Plus size={18} /></button><button className="icon-button" title="Delete chat" aria-label="Delete chat" disabled={!current || task.busy} onClick={() => { if (current && confirm("Delete this chat?")) void task.run(async () => { await api(connection, `chat/${docId}?chatId=${current.id}`, undefined, "DELETE"); setChats(previous => previous.filter(chat => chat.id !== current.id)); setSelected(""); }); }}><Trash2 size={17} /></button></div>
    <Notice>{task.error}</Notice>
    <div className="messages" aria-live="polite">{loading ? <p role="status">Loading chats...</p> : !current?.messages.length ? <p className="empty-copy">New Conversation</p> : current.messages.map((entry, index) => <article key={`${entry.ts}:${index}`} className={`message ${entry.role}`}><span className="message-role">{entry.role === "user" ? "You" : "PaperMotion"}</span><Markdown>{entry.content}</Markdown></article>)}<div ref={lastMessage} /></div>
    <form className="composer" onSubmit={send}><textarea aria-label="Message" placeholder="Ask about this document" maxLength={16000} value={message} disabled={task.busy || loading} onChange={event => setMessage(event.target.value)} /><button className="primary icon-button" type="submit" title="Send message" aria-label="Send message" disabled={task.busy || loading || !message.trim()}><Send size={18} /></button></form>
    {task.busy && <p role="status" className="status">Working...</p>}
    {!!current?.messages.length && <button className="text-button" disabled={task.busy || finished} onClick={() => void task.run(async () => { await api(connection, `kg/${docId}/evaluate`, {}); dirty.current = false; setFinished(true); })}><Check size={15} />{finished ? "Progress saved" : "Finish Chat"}</button>}
  </div>;
}

type Session = FlashcardSession | QuizSession;

function Cards({ connection, docId, tool }: ToolProps & { tool: "flashcards" | "quizzes" }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState("");
  const [topic, setTopic] = useState("");
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const task = useTask();
  const { setError } = task;
  const session = sessions.find(item => item.id === selected);
  const cards = session && "cards" in session ? session.cards : undefined;
  const questions = session && "questions" in session ? session.questions : undefined;
  const card = cards?.[position];
  const question = questions?.[position];
  const count = cards?.length ?? questions?.length ?? 0;

  useEffect(() => {
    const controller = new AbortController();
    void api<{ sessions: Session[] }>(connection, `${tool}/${docId}`, undefined, "GET", controller.signal).then(result => {
      setSessions(result.sessions); setSelected(result.sessions[0]?.id ?? "");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [connection, docId, tool, setError]);

  const update = (next: Session) => { setSessions(previous => [next, ...previous.filter(item => item.id !== next.id)]); setSelected(next.id); };
  function move(next: number) { setPosition(next); setRevealed(false); }
  async function answer(value: number) {
    if (!session) return;
    await task.run(async () => {
      const body = tool === "flashcards" ? { action: "rate", sessionId: session.id, cardIndex: position, rating: value } : { action: "answer", sessionId: session.id, questionIndex: position, chosenIndex: value };
      let next = (await api<{ session: Session }>(connection, `${tool}/${docId}`, body)).session;
      update(next);
      const complete = "cards" in next ? next.cards.every(item => item.rating != null) : next.questions.every(item => item.chosenIndex != null);
      if (complete && !next.endedAt) { next = (await api<{ session: Session }>(connection, `${tool}/${docId}`, { action: "end", sessionId: session.id })).session; update(next); }
      if (tool === "flashcards" && position + 1 < count) move(position + 1);
    });
  }
  return <div className="tool-content">
    <form className="generate" onSubmit={event => { event.preventDefault(); void task.run(async () => { const result = await api<{ session: Session }>(connection, `${tool}/${docId}`, { action: "generate", topic: topic.trim() || "all" }); update(result.session); move(0); }); }}><label htmlFor="topic">Topic</label><input id="topic" placeholder="Whole document" value={topic} maxLength={500} disabled={task.busy} onChange={event => setTopic(event.target.value)} /><button className="primary" disabled={task.busy || loading}><Plus size={16} />{tool === "flashcards" ? "Generate Cards" : "Generate Quiz"}</button></form>
    <Notice>{task.error}</Notice>{(task.busy || loading) && <p role="status">{loading ? "Loading sessions..." : "Working..."}</p>}
    {!!sessions.length && <div className="toolbar"><select aria-label="Study sessions" value={selected} disabled={task.busy} onChange={event => { setSelected(event.target.value); move(0); }}>{sessions.map(item => <option key={item.id} value={item.id}>{item.topic === "all" ? "Whole document" : item.topic} - {new Date(item.createdAt).toLocaleString()}</option>)}</select><button className="icon-button" title="Delete session" aria-label="Delete session" disabled={task.busy || !session} onClick={() => { if (session && confirm("Delete this study session?")) void task.run(async () => { await api(connection, `${tool}/${docId}?sessionId=${session.id}`, undefined, "DELETE"); const remaining = sessions.filter(item => item.id !== session.id); setSessions(remaining); setSelected(remaining[0]?.id ?? ""); move(0); }); }}><Trash2 size={17} /></button></div>}
    {session && <>
      <div className="pagination"><button className="icon-button" title="Previous" aria-label="Previous" disabled={task.busy || position === 0} onClick={() => move(position - 1)}><ChevronLeft size={18} /></button><span>{position + 1} / {count}</span><button className="icon-button" title="Next" aria-label="Next" disabled={task.busy || position + 1 >= count} onClick={() => move(position + 1)}><ChevronRight size={18} /></button></div>
      {card && <article className="study-card"><Markdown>{card.q}</Markdown>{revealed || card.rating ? <><div className="answer"><Markdown>{card.a}</Markdown></div><div className="ratings">{["Again", "Hard", "Good", "Easy"].map((label, index) => <button key={label} disabled={task.busy || card.rating != null} aria-pressed={card.rating === index + 1} onClick={() => void answer(index + 1)}>{label}</button>)}</div></> : <button onClick={() => setRevealed(true)}>Reveal Answer</button>}</article>}
      {question && <article className="study-card"><Markdown>{question.stem}</Markdown><div className="options">{question.options.map((option, index) => <button key={index} className={question.chosenIndex != null ? index === question.correctIndex ? "correct" : index === question.chosenIndex ? "incorrect" : "" : ""} disabled={task.busy || question.chosenIndex != null} onClick={() => void answer(index)}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span></button>)}</div>{question.chosenIndex != null && <div className="answer"><strong>{question.chosenIndex === question.correctIndex ? "Correct" : "Not quite"}</strong><Markdown>{question.explanation}</Markdown></div>}</article>}
      {session.endedAt ? <p className="completion" role="status"><Check size={16} />{questions ? `${questions.filter(item => item.chosenIndex === item.correctIndex).length} / ${questions.length} correct. Progress saved.` : "Session complete. Progress saved."}</p> : <button className="text-button" disabled={task.busy} onClick={() => void task.run(async () => update((await api<{ session: Session }>(connection, `${tool}/${docId}`, { action: "end", sessionId: session.id })).session))}><Check size={15} />Finish Session</button>}
    </>}
  </div>;
}

function Concepts({ connection, docId, openViewer }: ToolProps & { openViewer: () => void }) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const task = useTask();
  const { setError } = task;
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => api<KnowledgeGraph>(connection, `kg/${docId}/state`, undefined, "GET", controller.signal).then(setGraph).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => setLoading(false));
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [connection, docId, setError]);
  return <div className="tool-content"><div className="toolbar"><h2>Concepts</h2><button className="icon-button" title="Open knowledge graph and visualizations" aria-label="Open knowledge graph and visualizations" onClick={openViewer}><ExternalLink size={18} /></button></div>
    <Notice>{task.error || graph?.buildError}</Notice>
    {loading || task.busy || graph?.status === "building" ? <p role="status">{loading ? "Loading concepts..." : "Building concepts..."}</p> : graph?.status !== "ready" && <button className="primary" onClick={() => void task.run(async () => setGraph(await api<KnowledgeGraph>(connection, `kg/${docId}/build`, {})))}><Network size={16} />{graph?.status === "error" ? "Retry Concepts" : "Generate Concepts"}</button>}
    {graph?.nodes.map(node => <article className="concept" key={node.id}><div className="concept-heading"><h3>{node.label}</h3><span>{masteryScore(node.evaluation)}%</span></div><p>{node.summary}</p><progress value={masteryScore(node.evaluation)} max="100" aria-label={`${node.label} mastery`} /><details><summary>Mastery Details</summary><dl>{Object.entries(node.evaluation).map(([axis, score]) => <div key={axis}><dt>{axis}</dt><dd>{score}%</dd></div>)}</dl>{node.evaluatorNote && <p>{node.evaluatorNote}</p>}</details></article>)}
    {!!graph?.edges.length && <details className="relationships"><summary>Relationships ({graph.edges.length})</summary><ul>{graph.edges.map((edge, index) => <li key={index}>{graph.nodes.find(node => node.id === edge.source)?.label} / {edge.relation} / {graph.nodes.find(node => node.id === edge.target)?.label}</li>)}</ul></details>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);