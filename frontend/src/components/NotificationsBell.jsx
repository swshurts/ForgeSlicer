/**
 * NotificationsBell — in-app notifications indicator + dropdown
 * (iter-151.15).
 *
 * Polls unread count every 60 s (cheap: single count query). Clicking
 * opens a dropdown of the newest 20 notifications; clicking one marks
 * it read and navigates to its `link`. "Mark all read" bulk-clears.
 *
 * Rendered inside auth-gated shells (Workspace top bar, Landing signed-
 * in state). Hidden when no user is present.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Loader2 } from "lucide-react";
import { notificationsApi } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

const POLL_MS = 60_000;

export default function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef(null);

  const refreshCount = useCallback(async () => {
    if (!user) return;
    try {
      const { count } = await notificationsApi.unreadCount();
      setUnread(count || 0);
    } catch { /* silent */ }
  }, [user]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await notificationsApi.listMine(30) || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(t);
  }, [user, refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    loadItems();
    // Click-outside to close.
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, loadItems]);

  const clickItem = async (n) => {
    if (!n.read) {
      try {
        await notificationsApi.markRead([n.notification_id]);
        setItems((prev) => prev.map((i) => i.notification_id === n.notification_id ? { ...i, read: true } : i));
        setUnread((u) => Math.max(0, u - 1));
      } catch { /* silent */ }
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      setUnread(0);
    } catch { /* silent */ }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={rootRef} data-testid="notifications-bell">
      <button
        data-testid="notifications-bell-btn"
        onClick={() => setOpen((v) => !v)}
        className="relative h-8 w-8 rounded hover:bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            data-testid="notifications-unread-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-80 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 max-h-[70vh] overflow-hidden flex flex-col" data-testid="notifications-menu">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Notifications</span>
            {items.some((i) => !i.read) && (
              <button
                data-testid="notifications-mark-all-read"
                onClick={markAll}
                className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Check size={11} /> Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="p-4 flex items-center justify-center text-slate-500 text-xs">
                <Loader2 className="animate-spin" size={14} />
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500 italic">You're all caught up.</div>
            )}
            {items.map((n) => (
              <button
                key={n.notification_id}
                data-testid={`notification-${n.notification_id}`}
                onClick={() => clickItem(n)}
                className={`w-full text-left px-3 py-2 border-b border-slate-800 hover:bg-slate-800 transition-colors ${n.read ? "opacity-70" : ""}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">{n.title}</div>
                    <div
                      className="text-[11px] text-slate-400 leading-snug line-clamp-2"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: n.body || "" }}
                    />
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
