"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "graph" | "rag";

interface Source {
  citation: string;
  projectLaw: string;
  page: number | string | null;
  score: number | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  mode?: Mode;
  sources?: Source[];
  data?: {
    cypher?: string;
    explanation?: string;
    rows?: Record<string, unknown>[];
    count?: number;
  };
  error?: boolean;
}

interface SchemaInfo {
  nodes: { labels: string[]; total: number }[];
  relationships: { type: string; total: number }[];
  vectorIndex: { state?: string };
}

const EXAMPLES = [
  { mode: "graph" as const, text: "¿Quién emitió el PL 14712?" },
  { mode: "rag" as const, text: "¿Qué proyectos hablan de educación?" },
  { mode: "graph" as const, text: "¿A quién está dirigido el PL 14715?" },
  { mode: "rag" as const, text: "Resume la finalidad del PL 14710." },
];

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!ready) return;
    fetch("/api/schema")
      .then(async (response) => {
        if (!response.ok) throw new Error("schema");
        return response.json();
      })
      .then((result) => {
        if (result.ok) setSchema(result);
      })
      .catch(() => setSchema(null));
  }, [ready]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, apiKey }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error?.message || "No se pudo completar la consulta.");
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          mode: result.mode,
          sources: result.sources,
          data: result.data,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Error de conexión.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <main className="access-shell">
        <section className="access-card">
          <div className="brand-mark">L</div>
          <p className="eyebrow">E-Government · PUCP</p>
          <h1>Preguntas legislativas, con evidencia.</h1>
          <p className="access-copy">
            El agente decide si necesita relaciones del grafo o contenido de los proyectos de ley.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (apiKey.trim()) setReady(true);
            }}
          >
            <label htmlFor="openrouter-key">API key de OpenRouter</label>
            <input
              id="openrouter-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-or-v1-..."
              autoComplete="off"
              autoFocus
            />
            <button type="submit" disabled={!apiKey.trim()}>Abrir agente</button>
          </form>
          <p className="privacy-note">La clave permanece en esta pestaña y se envía solo a OpenRouter.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <header className="brand">
          <div className="brand-mark small">L</div>
          <div><strong>Legisla</strong><span>Agente documental</span></div>
        </header>
        <section className="status-card">
          <p className="section-label">Base de conocimiento</p>
          <div className="status-row"><span>Grafo Aura</span><b className={schema ? "online" : "muted"}>{schema ? "Activo" : "Verificando"}</b></div>
          <div className="status-row"><span>Índice RAG</span><b className={schema?.vectorIndex?.state === "ONLINE" ? "online" : "muted"}>{schema?.vectorIndex?.state === "ONLINE" ? "Activo" : "Pendiente"}</b></div>
          {schema && <p className="corpus-count">{schema.nodes.reduce((total, node) => total + node.total, 0).toLocaleString("es-PE")} nodos conectados</p>}
        </section>
        <section className="examples">
          <p className="section-label">Prueba una pregunta</p>
          {EXAMPLES.map((example) => (
            <button key={example.text} onClick={() => setInput(example.text)}>
              <span className={`tool-dot ${example.mode}`} />{example.text}
            </button>
          ))}
        </section>
        <footer>Corpus: PL 14705-14859</footer>
      </aside>

      <section className="conversation">
        <header className="mobile-header"><strong>Legisla</strong><span>Grafo + RAG</span></header>
        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <section className="welcome">
              <p className="eyebrow">155 proyectos de ley · junio-julio 2026</p>
              <h2>¿Qué necesitas investigar?</h2>
              <p>Pregunta por autores y relaciones, o explora el contenido y los fundamentos de cada proyecto.</p>
              <div className="route-legend">
                <span><i className="tool-dot graph" />Grafo para relaciones</span>
                <span><i className="tool-dot rag" />RAG para contenido</span>
              </div>
            </section>
          )}
          {messages.map((message, index) => (
            <article key={index} className={`message ${message.role} ${message.error ? "error" : ""}`}>
              {message.role === "assistant" && message.mode && (
                <div className={`route-badge ${message.mode}`}>
                  <span className={`tool-dot ${message.mode}`} />{message.mode === "graph" ? "Consultó el grafo" : "Consultó documentos"}
                </div>
              )}
              <div className="bubble">{message.content}</div>
              {message.sources && message.sources.length > 0 && (
                <div className="sources">
                  <strong>Fuentes</strong>
                  <div>{message.sources.map((source) => <span key={source.citation}>{source.citation}</span>)}</div>
                </div>
              )}
              {message.data?.cypher && (
                <details>
                  <summary>Ver consulta Cypher</summary>
                  <pre>{message.data.cypher}</pre>
                  {message.data.explanation && <p>{message.data.explanation}</p>}
                </details>
              )}
              {message.data?.rows && message.data.rows.length > 0 && <ResultTable rows={message.data.rows} />}
            </article>
          ))}
          {loading && <article className="message assistant"><div className="route-badge thinking">El agente está decidiendo</div><div className="typing"><i /><i /><i /></div></article>}
          <div ref={endRef} />
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pregunta sobre los proyectos de ley..." disabled={loading} aria-label="Pregunta" />
          <button type="submit" disabled={loading || !input.trim()} aria-label="Enviar pregunta">Enviar</button>
        </form>
      </section>
    </main>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0]);
  return (
    <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 20).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
