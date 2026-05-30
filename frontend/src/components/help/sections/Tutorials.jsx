// Tutorials help section — the in-app PDF viewer. Lists every tutorial
// from the shared TUTORIALS catalogue (single source of truth with the
// Help mega-menu) and embeds the selected one in an <iframe>. Headless
// chromium browsers can't render the PDF inline but the iframe still
// resolves the src; on real browsers the user sees the full document.
import React, { useState } from "react";
import { FileText, ExternalLink, Download } from "lucide-react";
import { TUTORIALS } from "../../toolbar/HelpMegaMenu";
import { P, Code } from "../typography";

export default function Tutorials() {
  const [activeFile, setActiveFile] = useState(TUTORIALS[0]?.file);
  const active = TUTORIALS.find((t) => t.file === activeFile) || TUTORIALS[0];
  if (!active) {
    return (
      <P>
        No tutorial PDFs are available — try regenerating them with{" "}
        <Code>python3 scripts/build_all_tutorials.py</Code>.
      </P>
    );
  }
  return (
    <div data-testid="help-section-tutorials" className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-slate-800">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText size={18} className="text-orange-400" />
          Tutorial PDFs
        </h2>
        <p className="text-[12px] text-slate-400 mt-1 leading-snug">
          Long-form illustrated guides, generated server-side from ForgeSlicer source.
          Pick one from the list — it renders inline below. Use the buttons in the
          top-right of the viewer to open in a new tab or download a copy.
        </p>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {/* Tutorial picker rail */}
        <div className="w-56 border-r border-slate-800 overflow-y-auto bg-slate-950/40" data-testid="tutorial-list">
          {TUTORIALS.map((t) => {
            const isActive = t.file === activeFile;
            return (
              <button
                key={t.file}
                data-testid={`tutorial-pick-${t.file.replace(/\.pdf$/, "").toLowerCase()}`}
                onClick={() => setActiveFile(t.file)}
                className={`w-full text-left px-3 py-2 border-b border-slate-800/60 transition-colors ${
                  isActive
                    ? "bg-orange-500/10 border-l-2 border-l-orange-500"
                    : "hover:bg-slate-800/40 border-l-2 border-l-transparent"
                }`}
              >
                <div className={`text-[12px] font-semibold ${isActive ? "text-orange-200" : "text-slate-200"}`}>
                  {t.title}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight mt-0.5 line-clamp-2">
                  {t.desc}
                </div>
                <div className="text-[9.5px] text-slate-600 mt-0.5 font-mono">{t.minutes} min</div>
              </button>
            );
          })}
        </div>
        {/* Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
          <div className="h-9 border-b border-slate-800 flex items-center px-3 gap-2 bg-slate-900/60">
            <FileText size={13} className="text-orange-400" />
            <div className="text-[11.5px] font-semibold text-slate-200 truncate flex-1">{active.title}</div>
            <a
              data-testid="tutorial-open-new-tab"
              href={`/docs/${active.file}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in a new tab"
              className="h-7 px-2 rounded text-[10px] text-slate-300 hover:bg-slate-800 hover:text-orange-300 flex items-center gap-1"
            >
              <ExternalLink size={11} /> Open
            </a>
            <a
              data-testid="tutorial-download"
              href={`/docs/${active.file}`}
              download={active.file}
              title="Download PDF"
              className="h-7 px-2 rounded text-[10px] text-slate-300 hover:bg-slate-800 hover:text-orange-300 flex items-center gap-1"
            >
              <Download size={11} /> Download
            </a>
          </div>
          <iframe
            key={active.file}
            data-testid="tutorial-iframe"
            title={active.title}
            src={`/docs/${active.file}#toolbar=0&navpanes=0`}
            className="flex-1 w-full bg-slate-100"
          />
        </div>
      </div>
    </div>
  );
}
