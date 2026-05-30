// VoiceCommands help section — the searchable lexicon table with optional
// "Try ▶" buttons. Extracted from HelpDialog.jsx; reads the lexicon data
// from `../voiceLexicon` and the shared typography helpers from
// `../typography`.
import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { H, P, Code, Kbd, Step } from "../typography";
import { VOICE_LEXICON } from "../voiceLexicon";

export default function VoiceCommands({ onTry }) {
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(null);
  const handleTry = async (phrase) => {
    if (!onTry) return;
    setBusy(phrase);
    try { await onTry(phrase); } finally { setBusy(null); }
  };
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return VOICE_LEXICON;
    return VOICE_LEXICON
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          i.phrase.toLowerCase().includes(q) ||
          i.desc.toLowerCase().includes(q) ||
          i.action.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [filter]);
  return (
    <div data-testid="help-section-voice">
      <H>Voice Commands — How it works</H>
      <P>Click the <Code>Voice</Code> button in the top toolbar (or press <Kbd>V</Kbd>). ForgeSlicer captures audio with your browser microphone, transcribes it through OpenAI Whisper, then parses your intent with GPT — so you can phrase commands naturally instead of memorizing rigid syntax.</P>
      <H>Hands-free flow</H>
      <ol className="mb-4">
        <Step n="1">Tap Voice once to start listening. Speak your command.</Step>
        <Step n="2">Pause for ~2 seconds. Your transcript appears on screen.</Step>
        <Step n="3">Say <strong className="text-orange-300">"Run"</strong> to execute, or just speak again to replace the transcript.</Step>
      </ol>
      <H>Lexicon</H>
      <P>Every example below is a real command that will execute — the LLM understands synonyms and natural phrasing, so feel free to deviate from these exact words.</P>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          data-testid="voice-lexicon-search"
          type="text"
          placeholder="Filter commands…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white pl-8 pr-3 focus:border-orange-500 outline-none"
        />
      </div>
      {filtered.map((group) => (
        <div key={group.category} className="mb-4" data-testid={`voice-group-${group.category.replace(/\W+/g, "-").toLowerCase()}`}>
          <div className="text-[11px] uppercase tracking-wider text-orange-300 font-semibold mb-1.5">{group.category}</div>
          <table className="w-full text-sm border border-slate-800 rounded overflow-hidden">
            <thead className="text-left text-[10px] text-slate-500 uppercase tracking-wider bg-slate-900/60">
              <tr><th className="px-2 py-1.5 w-1/3">Say…</th><th className="px-2 py-1.5">What happens</th>{onTry && <th className="px-2 py-1.5 w-16 text-right">Try</th>}</tr>
            </thead>
            <tbody>
              {group.items.map((it) => (
                <tr key={it.phrase} className="border-t border-slate-800">
                  <td className="px-2 py-1.5 font-mono text-orange-300 italic">"{it.phrase}"</td>
                  <td className="px-2 py-1.5 text-slate-300">{it.desc}</td>
                  {onTry && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        data-testid={`voice-try-${it.phrase.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                        onClick={() => handleTry(it.phrase)}
                        disabled={busy === it.phrase}
                        className="px-2 h-6 text-[10px] rounded border border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 disabled:opacity-50"
                        title={`Run "${it.phrase}" on your scene`}
                      >
                        {busy === it.phrase ? "…" : "Try ▶"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="text-sm text-slate-500 italic">No commands match "{filter}".</div>
      )}
    </div>
  );
}
