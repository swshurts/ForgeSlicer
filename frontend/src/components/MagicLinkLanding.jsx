import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { authApi } from "../lib/auth";
import { toast } from "sonner";
import { Hexagon, Loader2, AlertCircle, Wand2 } from "lucide-react";

export default function MagicLinkLanding() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || "";
  const [status, setStatus] = useState(token ? "consuming" : "missing");
  const [error, setError] = useState("");
  // React 19 + StrictMode mounts components twice in dev which would consume
  // a single-use token on the very first arrival. Guard so we only call the
  // backend once per mount.
  const consumed = useRef(false);

  useEffect(() => {
    if (!token || consumed.current) return;
    consumed.current = true;
    (async () => {
      try {
        const user = await authApi.consumeMagicLink(token);
        setUser(user);
        toast.success(`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}!`);
        setStatus("done");
        navigate("/workspace", { replace: true });
      } catch (err) {
        const detail = err?.response?.data?.detail || err.message;
        setError(typeof detail === "string" ? detail : "Magic link could not be used.");
        setStatus("failed");
      }
    })();
  }, [token, setUser, navigate]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="magic-link-landing-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 select-none ml-auto">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg p-7 text-center">
          <div className="w-11 h-11 mx-auto rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center mb-3">
            <Wand2 size={20} />
          </div>
          {status === "consuming" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Signing you in…</h1>
              <Loader2 size={20} className="text-orange-400 animate-spin mx-auto mt-4" data-testid="magic-link-consuming" />
            </>
          )}
          {status === "missing" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Missing token</h1>
              <p className="text-xs text-slate-400 mt-2">This page expects a sign-in token in the URL. Please use the link from your email.</p>
              <Link to="/signin" className="inline-block mt-4 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded leading-9">
                Back to sign in
              </Link>
            </>
          )}
          {status === "failed" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Link didn't work</h1>
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2 mt-3 text-left" data-testid="magic-link-error">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
              <Link to="/signin?tab=magic" className="inline-block mt-4 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded leading-9">
                Request a new link
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
