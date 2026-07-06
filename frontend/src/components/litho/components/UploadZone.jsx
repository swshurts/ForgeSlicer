import React, { useCallback, useRef, useState } from "react";
import { UploadCloud, Image as ImageIcon } from "lucide-react";

export const UploadZone = ({ onFile, disabled }) => {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      data-testid="upload-zone"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center h-full w-full cursor-pointer select-none transition-colors duration-150 ${
        drag ? "bg-zinc-900/80" : "bg-transparent"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input
        ref={inputRef}
        data-testid="upload-file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="absolute inset-0 scanline pointer-events-none" />
      <div className="relative z-10 flex flex-col items-center text-center max-w-md px-6">
        <div className="w-14 h-14 border border-zinc-700 flex items-center justify-center mb-6 pulse-ring">
          <UploadCloud className="w-6 h-6 text-zinc-300" strokeWidth={1.5} />
        </div>
        <div className="font-display text-3xl font-black tracking-tighter mb-2">
          DROP PHOTOGRAPH HERE
        </div>
        <div className="text-sm text-zinc-400 mb-8 leading-relaxed">
          PNG · JPG · WEBP. Your image is processed in-memory — nothing is stored
          on disk.
        </div>
        <div className="flex items-center gap-2 text-xs font-mono tracking-tight text-zinc-500">
          <ImageIcon className="w-3 h-3" strokeWidth={1.5} />
          <span>or click to browse</span>
        </div>
      </div>
      <div className="absolute bottom-4 left-6 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
        Photo · Beer-Lambert Δe76
      </div>
      <div className="absolute bottom-4 right-6 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
        v1.0
      </div>
    </div>
  );
};
