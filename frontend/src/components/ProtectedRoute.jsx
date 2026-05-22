import React from "react";
import { useLocation, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Loader2, Lock, LogIn, Hexagon, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

// Gate that wraps protected routes. Renders the children only when the user
// is logged in; otherwise shows a sign-in card that preserves the requested
// path so the user lands back there after sign-in completes (regardless of
// auth method used).
export default function ProtectedRoute({ children, label = "this page" }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // If we're returning from OAuth (hash carries session_id), AppRouter has
  // already swapped us into AuthCallback — this component shouldn't even
  // render. The check below is a belt-and-braces no-op.
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return null;
  }

  // AuthCallback hands the freshly-exchanged user object via `location.state`
  // so we can pass-through immediately even if React hasn't propagated the
  // AuthProvider state to this subtree yet (sub-ms race in React 18). Without
  // this, the ProtectedRoute briefly sees `user === null` post-callback and
  // bounces back to the sign-in card — looking like the redirect failed.
  const stateUser = location.state?.user;

  if (loading && !stateUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center" data-testid="protected-loading">
        <Loader2 size={28} className="text-orange-400 animate-spin" />
      </div>
    );
  }

  if (user || stateUser) return children;

  const returnPath = location.pathname + (location.search || "");
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="protected-signin-gate">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Home</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center mb-4">
            <Lock size={20} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Sign in to access {label}</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Designing in the workspace and saving to your personal library require a free ForgeSlicer account. The public gallery is browsable without signing in.
          </p>
          <Link
            data-testid="protected-signin-btn"
            to={`/signin?return=${encodeURIComponent(returnPath)}`}
            className="mt-6 w-full h-11 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
          >
            <LogIn size={16} /> Sign in
          </Link>
          <Link
            data-testid="protected-register-link"
            to={`/signin?mode=register&return=${encodeURIComponent(returnPath)}`}
            className="block mt-3 text-xs text-slate-400 hover:text-orange-400"
          >…or create a free account →</Link>
          <Link
            to="/gallery"
            data-testid="protected-browse-gallery-link"
            className="block mt-3 text-xs text-slate-400 hover:text-orange-400"
          >…or browse the public gallery first →</Link>
        </div>
      </main>
    </div>
  );
}
