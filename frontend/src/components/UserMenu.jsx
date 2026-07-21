import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LogIn, LogOut, User as UserIcon, FolderOpen, Library, CreditCard } from "lucide-react";
import NotificationsBell from "./NotificationsBell";

// Compact auth widget for top-bar use. Anonymous => "Sign in" button;
// authenticated => avatar that opens a dropdown to Profile / My Designs /
// My Components / Sign out.
export default function UserMenu({ returnPath }) {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-slate-800 animate-pulse" data-testid="user-menu-loading" />;
  }

  if (!user) {
    const target = returnPath || window.location.pathname;
    return (
      <Link
        data-testid="login-btn"
        to={`/signin?return=${encodeURIComponent(target)}`}
        className="h-8 px-3 ml-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded flex items-center gap-1.5 border border-orange-500/40 hover:border-orange-500/70 transition-colors"
      >
        <LogIn size={14} className="text-orange-400" /> Sign in
      </Link>
    );
  }

  const initials = (user.name || user.email || "?")
    .split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() || "").join("");

  return (
    <div className="flex items-center gap-1 ml-2">
      <NotificationsBell />
      <div className="relative" ref={ref}>
      <button
        data-testid="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-1.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-orange-500/60 flex items-center gap-2 transition-colors"
        title={user.name}
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="h-6 w-6 rounded-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <span className="h-6 w-6 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-semibold flex items-center justify-center">
            {initials || "U"}
          </span>
        )}
        <span className="text-xs text-slate-200 max-w-[120px] truncate pr-1.5 hidden sm:inline">{user.name}</span>
      </button>
      {open && (
        <div
          data-testid="user-menu-dropdown"
          className="absolute right-0 mt-1 w-56 bg-slate-900 border border-slate-700 rounded shadow-2xl overflow-hidden z-50"
        >
          <div className="px-3 py-2 border-b border-slate-800">
            <div className="text-xs font-semibold text-white truncate" title={user.name}>{user.name}</div>
            <div className="text-[10px] text-slate-400 truncate" title={user.email}>{user.email}</div>
          </div>
          <Link
            to="/profile"
            data-testid="user-menu-profile-link"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            <UserIcon size={13} className="text-orange-400" /> Profile
          </Link>
          <Link
            to="/profile?tab=designs"
            data-testid="user-menu-designs-link"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            <FolderOpen size={13} className="text-orange-400" /> My Designs
          </Link>
          <Link
            to="/profile?tab=components"
            data-testid="user-menu-components-link"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Library size={13} className="text-orange-400" /> My Components
          </Link>
          <Link
            to="/pricing"
            data-testid="user-menu-pricing-link"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 border-t border-slate-800"
          >
            <CreditCard size={13} className="text-orange-400" /> Plans &amp; Pricing
            {user.subscription_tier && user.subscription_tier !== "free" && (
              <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 rounded px-1.5 py-0.5">
                {user.subscription_tier}
              </span>
            )}
          </Link>
          <button
            data-testid="user-menu-logout-btn"
            onClick={async () => { setOpen(false); await logout(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-red-500/20 hover:text-red-300 border-t border-slate-800"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
