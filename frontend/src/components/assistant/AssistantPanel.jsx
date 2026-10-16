import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import client from "../../api/client";
import { Button, Icons } from "../ui";

// "Ask SmartEdu": the student's chat panel. Right-side panel on desktop, full-screen sheet on
// phones. Loads history on open, sends with Enter (Shift+Enter = new line), shows a typing
// indicator, suggestion chips and link buttons under each answer, and keeps keyboard focus
// inside the panel while it's open. New answers are announced through an aria-live region.

export const STARTERS = ["Why is my status this?", "Which course should I focus on?", "Is my attendance OK?", "How can I improve?"];
const MAX_CHARS = 500;
const COUNTER_FROM = 400;
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

let localId = 0;
const nextId = () => `local-${++localId}`;

function Chip({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left text-sm rounded-full border border-brand/30 bg-brand-50 text-brand-dark px-3 py-1.5 hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
    >
      {children}
    </button>
  );
}

function Bubble({ message, isLatest, busy, onAsk, onLink, onRetry, here }) {
  const mine = message.role === "user";
  const links = (message.links || []).filter((l) => l.href !== here); // no link to the page you are on
  if (message.error) {
    return (
      <div className="flex justify-start">
        <div role="alert" className="max-w-[85%] rounded-2xl rounded-bl-md border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <p>{message.error}</p>
          {message.retry && (
            <Button size="sm" variant="secondary" className="mt-2" icon={<Icons.Refresh size={14} />} onClick={() => onRetry(message)} disabled={busy}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${mine ? "" : "space-y-2"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line break-words ${
            mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-surface border border-line text-ink"
          }`}
        >
          <span className="sr-only">{mine ? "You said: " : "SmartEdu: "}</span>
          {message.content}
        </div>
        {!mine && links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Button key={l.href} size="sm" variant="secondary" onClick={() => onLink(l.href)} icon={<Icons.ChevronRight size={14} />}>
                {l.label}
              </Button>
            ))}
          </div>
        )}
        {!mine && isLatest && message.suggestions?.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1" aria-label="Suggested questions">
            {message.suggestions.map((s) => (
              <Chip key={s} onClick={() => onAsk(s)} disabled={busy}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex justify-start" role="status" aria-label="SmartEdu is typing">
      <div className="rounded-2xl rounded-bl-md bg-surface border border-line px-4 py-3 flex gap-1.5" aria-hidden="true">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-2 w-2 rounded-full bg-muted/60 animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * <AssistantPanel open onClose firstName initialQuestion onInitialSent />
 * initialQuestion is sent once the history has loaded (e.g. from "Ask about this").
 */
export default function AssistantPanel({ open, onClose, firstName, initialQuestion, onInitialSent }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const openerRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState({ loaded: false, loading: false, error: null });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [announce, setAnnounce] = useState("");

  const loadHistory = useCallback(async () => {
    setHistory({ loaded: false, loading: true, error: null });
    try {
      const { data } = await client.get("/student/chat/history");
      setMessages(data.map((m) => ({ id: m.id, role: m.role, content: m.content })));
      setHistory({ loaded: true, loading: false, error: null });
    } catch (e) {
      setHistory({ loaded: false, loading: false, error: e.response?.data?.error || "We couldn't load your conversation." });
    }
  }, []);

  const send = useCallback(
    async (text, { retry = false } = {}) => {
      const message = text.trim();
      if (!message || sending) return;
      setSending(true);
      // a retry re-sends the question that's already on screen
      setMessages((ms) => [...ms.filter((m) => !m.error), ...(retry ? [] : [{ id: nextId(), role: "user", content: message }])]);
      try {
        const { data } = await client.post("/student/chat", { message });
        setMessages((ms) => [
          ...ms,
          { id: data.id || nextId(), role: "assistant", content: data.answer, suggestions: data.suggestions, links: data.links },
        ]);
        setAnnounce(data.answer);
      } catch (e) {
        const status = e.response?.status;
        const error =
          status === 429 || status === 400
            ? e.response.data.error
            : "Sorry, I couldn't answer just now. Check your connection and try again.";
        setMessages((ms) => [...ms, { id: nextId(), role: "assistant", error, retry: status !== 400 ? message : null }]);
        setAnnounce(error);
      } finally {
        setSending(false);
      }
    },
    [sending]
  );

  // open: remember the opener, lock page scroll, load history once
  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!history.loaded && !history.loading) loadHistory();
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // "Ask about this": send the pre-set question after the history is in
  useEffect(() => {
    if (open && initialQuestion && history.loaded && !sending) {
      send(initialQuestion);
      onInitialSent?.();
    }
  }, [open, initialQuestion, history.loaded, sending, send, onInitialSent]);

  useLayoutEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages, sending]);

  // grow the textarea with its content, up to about 5 lines
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input, open]);

  // Keys are handled on the document while the panel is open, so Escape and the focus trap
  // still work when focus has fallen to <body> (e.g. after a clicked button disappears).
  const keyState = useRef({});
  keyState.current = { confirmClear, onClose };
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (keyState.current.confirmClear) setConfirmClear(false);
        else keyState.current.onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // focus trap: Tab and Shift+Tab cycle inside the panel
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.contains(document.activeElement);
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function onInputKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (input.trim()) {
        send(input);
        setInput("");
      }
    }
  }

  async function clearChat() {
    setClearing(true);
    try {
      await client.delete("/student/chat/history");
      setMessages([]);
      setConfirmClear(false);
      setAnnounce("Conversation cleared.");
      inputRef.current?.focus();
    } catch {
      setAnnounce("Couldn't clear the conversation. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  function goTo(href) {
    onClose();
    navigate(href);
  }

  if (!open) return null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const remaining = MAX_CHARS - input.length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/40 animate-fade-up" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        aria-describedby="assistant-note"
        className="relative h-full w-full sm:max-w-md bg-paper shadow-pop flex flex-col animate-slide-in"
      >
        <header className="px-4 sm:px-5 pt-4 pb-3 bg-surface border-b border-line">
          <div className="flex items-center justify-between gap-2">
            <h2 id="assistant-title" className="font-display text-lg text-ink">Ask SmartEdu</h2>
            <div className="flex items-center gap-1">
              {messages.length > 0 && !confirmClear && (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-sm text-muted hover:text-ink px-2 py-1.5 rounded-lg hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  Clear chat
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 -mr-2 rounded-lg text-muted hover:text-ink hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                aria-label="Close Ask SmartEdu"
              >
                <Icons.Close size={20} />
              </button>
            </div>
          </div>
          <p id="assistant-note" className="mt-1 text-xs text-muted leading-snug">
            Answers use your SmartEdu records. For personal concerns, talk to your counselor.
          </p>
          {confirmClear && (
            <div role="alertdialog" aria-label="Clear chat" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2">
              <span className="text-sm text-ink">Delete all messages in this chat?</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmClear(false)} autoFocus>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" onClick={clearChat} loading={clearing}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {history.loading && <p className="text-sm text-muted" role="status">Loading your conversation...</p>}
          {history.error && (
            <div role="alert" className="rounded-card border border-danger/30 bg-danger-50 p-4 text-sm text-danger-700">
              <p>{history.error}</p>
              <Button size="sm" variant="secondary" className="mt-2" icon={<Icons.Refresh size={14} />} onClick={loadHistory}>
                Try again
              </Button>
            </div>
          )}
          {history.loaded && messages.length === 0 && !sending && (
            <div className="space-y-3">
              <div className="rounded-card bg-surface border border-line p-4 text-[15px] leading-relaxed text-ink">
                Hi {firstName}! Ask me about your status, CGPA, marks, attendance or what to do next. You can write in English or Roman Urdu.
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
                {STARTERS.map((s) => (
                  <Chip key={s} onClick={() => send(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} message={m} isLatest={m === lastAssistant} busy={sending} onAsk={send} onLink={goTo} onRetry={(x) => { inputRef.current?.focus(); send(x.retry, { retry: true }); }} here={pathname} />
          ))}
          {sending && <Typing />}
          <div ref={endRef} />
        </div>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announce}
        </div>

        <form
          className="border-t border-line bg-surface px-3 sm:px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              send(input);
              setInput("");
            }
          }}
        >
          <div className="flex items-end gap-2">
            <label htmlFor="assistant-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Ask a question..."
              aria-describedby="assistant-hint"
              className="flex-1 resize-none min-h-[42px] rounded-lg border border-line bg-paper px-3 py-2.5 text-[15px] leading-snug text-ink placeholder:text-muted/80 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
            />
            <Button type="submit" aria-label="Send" disabled={!input.trim() || sending} className="h-[42px] w-[42px] !px-0 shrink-0" icon={<Icons.Send size={18} />} />
          </div>
          <div id="assistant-hint" className="mt-1.5 flex justify-between text-[11px] text-muted">
            <span>Enter to send · Shift+Enter for a new line</span>
            {input.length >= COUNTER_FROM && (
              <span className={remaining <= 20 ? "text-danger-700 font-medium" : ""} aria-live="polite">
                {input.length}/{MAX_CHARS}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
