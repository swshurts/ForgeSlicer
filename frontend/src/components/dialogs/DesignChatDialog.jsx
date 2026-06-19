// Design Chat — conversational freeform CAD panel (iter-105).
//
// MVP scope:
//   • Single-shot LLM calls per user message (no multi-turn history
//     passed to the backend yet — the live scene IS the persistent
//     context, and /api/voice/command already snapshots it).
//   • Each user message → parseTranscript → executeCommand / executePlan.
//   • Chat log shows {user message, assistant reply, what-was-done}.
//   • Cmd/Ctrl+Enter sends; the input is a multi-line textarea so users
//     can describe complex shapes without the message firing prematurely.
//
// Out of scope (deferred to a follow-up iter):
//   • Multi-turn history threading into the LLM prompt.
//   • Streaming responses (we wait for the full plan, then execute).
//   • Plan preview (executePlan today commits immediately). Could wrap
//     in PlanPreviewDialog once the UX stabilises.

import React, { useEffect, useRef, useState } from "react";
import { X, Send, Sparkles, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { parseTranscript, executeCommand } from "../../lib/voiceCommands";
import { executePlan, expandTemplate } from "../../lib/voicePlanExecutor";

const SAMPLE_PROMPTS = [
  "Add a 30 × 30 × 5 mm baseplate with a 6 mm hole in each corner",
  "Drop a cylinder 20 mm tall in the centre of the selected part",
  "Put a 3 mm chamfer on the top edges of the selected cube",
  "Build a Pi 4 wall mount",
];

function ChatBubble({ kind, children, meta }) {
  const isUser = kind === "user";
  return (
    <div
      data-testid={`design-chat-message-${kind}`}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] rounded-xl px-3.5 py-2 text-[12.5px] leading-relaxed shadow-sm ${
          isUser
            ? "bg-orange-500 text-white"
            : kind === "error"
            ? "bg-red-900/30 border border-red-500/40 text-red-200"
            : "bg-slate-900/80 border border-slate-800 text-slate-100"
        }`}
      >
        {children}
        {meta && (
          <div className="mt-1.5 text-[10px] text-slate-400 font-mono tracking-tight">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesignChatDialog({ open, onClose }) {
  const [messages, setMessages] = useState(() => [
    {
      kind: "assistant",
      text:
        "Hey — describe the shape, fastener, or modification you want and I'll build it on the plate. Z is up. I can read the selected item, the scene bbox, and add/cut/chamfer in one step.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);
  const taRef = useRef(null);

  // Auto-scroll to the latest message on send/receive.
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open && taRef.current) {
      const t = setTimeout(() => taRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  const append = (msg) => setMessages((prev) => [...prev, msg]);

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    append({ kind: "user", text });
    setInput("");
    setBusy(true);
    try {
      const cmd = await parseTranscript(text);
      // /api/voice/command returns:
      //   • atomic action: {action, raw:{action, type, dims, ...}}
      //   • plan:          {action:"plan", steps:[...]}
      //   • template:      {action:"template", template_id, params}
      //   • clarify/error: {action:"clarify"|"error", message}
      const raw = cmd?.raw || cmd || {};
      if (raw.action === "plan" && Array.isArray(raw.steps)) {
        const result = await executePlan(raw.steps);
        const summary = raw.summary || `Ran ${result.executed}/${result.total} steps.`;
        append({
          kind: result.ok ? "assistant" : "error",
          text: summary,
          meta: result.ok ? null : `Stopped at step ${result.executed}`,
        });
      } else if (raw.action === "template" && raw.template_id) {
        const data = await expandTemplate(raw.template_id, raw.params || {});
        if (!data?.steps?.length) {
          append({ kind: "error", text: `Template "${raw.template_id}" returned no steps.` });
        } else {
          const result = await executePlan(data.steps);
          append({
            kind: result.ok ? "assistant" : "error",
            text: data.summary || `Loaded template "${raw.template_id}".`,
            meta: `${result.executed}/${result.total} steps`,
          });
        }
      } else if (raw.action === "clarify" || raw.action === "error") {
        append({
          kind: raw.action === "error" ? "error" : "assistant",
          text: raw.message || raw.text || "I'm not sure what to do — could you rephrase?",
        });
      } else {
        const summary = await executeCommand(cmd);
        append({ kind: "assistant", text: summary || "Done." });
      }
    } catch (err) {
      append({
        kind: "error",
        text: err?.response?.data?.detail || err?.message || "Request failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  };

  return (
    <div
      data-testid="design-chat-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        data-testid="design-chat-dialog"
        className="w-full sm:max-w-2xl sm:mx-4 sm:my-6 max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-orange-500/40 bg-slate-950 shadow-2xl shadow-orange-900/30 overflow-hidden"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-orange-500/15 border border-orange-500/50 flex items-center justify-center text-orange-400">
              <Sparkles size={16} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white tracking-tight">Design Chat</div>
              <div className="text-[10px] uppercase tracking-widest text-orange-400 font-mono">Beta · GPT‑5.2 · Z‑up</div>
            </div>
          </div>
          <button
            data-testid="design-chat-close"
            onClick={onClose}
            className="w-8 h-8 rounded hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
            aria-label="Close design chat"
          >
            <X size={16} />
          </button>
        </header>

        <div
          ref={scrollerRef}
          data-testid="design-chat-log"
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          style={{ minHeight: 280 }}
        >
          {messages.map((m, i) => (
            <ChatBubble key={i} kind={m.kind} meta={m.meta}>
              {m.kind === "error" && (
                <span className="inline-flex items-center gap-1.5">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  <span>{m.text}</span>
                </span>
              )}
              {m.kind !== "error" && m.text}
            </ChatBubble>
          ))}
          {busy && (
            <ChatBubble kind="assistant">
              <span className="inline-flex items-center gap-2 text-slate-300">
                <Loader2 size={12} className="animate-spin" />
                Working on it…
              </span>
            </ChatBubble>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="px-4 pb-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5 font-mono">Try</div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  data-testid="design-chat-sample"
                  disabled={busy}
                  onClick={() => handleSend(p)}
                  className="text-[10px] px-2 py-1 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800 hover:border-orange-500/60 text-slate-300 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-800 p-3 bg-slate-950">
          <div className="relative">
            <textarea
              ref={taRef}
              data-testid="design-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Describe what to build or modify — Cmd/Ctrl+Enter to send"
              disabled={busy}
              className="w-full pr-12 px-3 py-2 text-[12.5px] resize-none bg-slate-900 border border-slate-800 focus:border-orange-500/60 focus:outline-none rounded-lg text-white placeholder-slate-500"
            />
            <button
              data-testid="design-chat-send"
              onClick={() => handleSend()}
              disabled={!input.trim() || busy}
              className="absolute right-2 bottom-2 w-8 h-8 rounded bg-orange-500 hover:bg-orange-400 disabled:bg-slate-800 disabled:text-slate-500 text-white flex items-center justify-center transition-colors"
              aria-label="Send message"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={10} className="text-green-500" />
              Reads the live scene each turn
            </span>
            <span>Cmd/Ctrl+Enter</span>
          </div>
        </div>
      </div>
    </div>
  );
}
