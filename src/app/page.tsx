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
  error?: boolean;
}

const EXAMPLES = [
  "¿Quién emitió el PL 14712?",
  "¿Qué proyectos hablan de educación?",
  "¿A quién está dirigido el PL 14715?",
  "Resume la finalidad del PL 14710.",
];

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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
          <h1>Comprende las leyes que pueden cambiar el país.</h1>
          <p className="access-copy">
            Consulta en lenguaje sencillo los proyectos de ley del Congreso del Perú y recibe respuestas respaldadas por sus documentos.
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
          <p className="privacy-note">La clave se utiliza solo durante esta sesión y no queda almacenada.</p>
          <p className="maker-note">Desarrollado por Paulo Chávez Condori · PUCP</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <header className="brand">
          <div className="brand-mark small">L</div>
          <div><strong>Legisla</strong><span>Asistente legislativo</span></div>
        </header>
        <section className="about-card">
          <p className="section-label">¿Qué es Legisla?</p>
          <p>Un asistente para explorar proyectos de ley del Congreso sin tener que revisar documentos extensos.</p>
          <ul>
            <li>Conoce autores y destinatarios</li>
            <li>Encuentra proyectos por tema</li>
            <li>Resume objetivos y fundamentos</li>
          </ul>
        </section>
        <section className="examples">
          <p className="section-label">Preguntas para comenzar</p>
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => setInput(example)}>
              <span>→</span>{example}
            </button>
          ))}
        </section>
        <footer><strong>Desarrollado por Paulo Chávez Condori</strong><span>E-Government · PUCP</span></footer>
      </aside>

      <section className="conversation">
        <header className="mobile-header"><strong>Legisla</strong><span>Por Paulo Chávez · PUCP</span></header>
        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <section className="welcome">
              <p className="eyebrow">Proyectos de ley del Congreso del Perú</p>
              <h2>Entiende una propuesta en pocos minutos.</h2>
              <p>Pregunta quién la presentó, a quién está dirigida, qué propone o cuáles son sus principales fundamentos. Cada respuesta incluye la fuente consultada.</p>
              <div className="welcome-prompts">
                {EXAMPLES.slice(0, 2).map((example) => <button key={example} onClick={() => void send(example)}>{example}<span>→</span></button>)}
              </div>
            </section>
          )}
          {messages.map((message, index) => (
            <article key={index} className={`message ${message.role} ${message.error ? "error" : ""}`}>
              <div className="bubble">{message.content}</div>
              {message.sources && message.sources.length > 0 && (
                <div className="sources">
                  <strong>Fuentes</strong>
                  <div>{message.sources.map((source) => <span key={source.citation}>{source.citation}</span>)}</div>
                </div>
              )}
            </article>
          ))}
          {loading && <article className="message assistant"><div className="thinking-label">Buscando en los proyectos de ley</div><div className="typing"><i /><i /><i /></div></article>}
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
