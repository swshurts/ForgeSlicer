/**
 * EmailPreferencesCard — inline email opt-in toggles for the Account
 * page (iter-151.15). Users can turn OFF broadcast emails or coop-
 * project notifications here; toggling calls the /notifications/prefs
 * endpoint.
 *
 * Also surfaces the token-based unsubscribe URL for users who want to
 * pass the "unsubscribe" link to an inbox filter.
 */
import React, { useEffect, useState } from "react";
import { Mail, Loader2, Check } from "lucide-react";
import { notificationsApi } from "../../lib/api";
import { toast } from "sonner";

export default function EmailPreferencesCard() {
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await notificationsApi.getPrefs();
        if (!cancelled) setPrefs(data);
      } catch {
        // silent — anonymous / not signed in shouldn't crash the page
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = async (patch) => {
    setSaving(true);
    try {
      const next = await notificationsApi.setPrefs(patch);
      setPrefs(next);
      toast.success("Email preferences saved");
    } catch (err) {
      toast.error(`Save failed: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6 flex items-center gap-2 text-slate-400 text-sm" data-testid="email-prefs-loading">
        <Loader2 size={14} className="animate-spin" /> Loading email preferences…
      </div>
    );
  }
  if (!prefs) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6" data-testid="email-prefs-card">
      <div className="flex items-center gap-2 mb-3">
        <Mail size={16} className="text-purple-400" />
        <h3 className="text-sm font-semibold text-slate-100">Email Preferences</h3>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            data-testid="email-prefs-broadcasts"
            type="checkbox"
            checked={prefs.broadcasts_opt_in}
            disabled={saving}
            onChange={(e) => update({ broadcasts_opt_in: e.target.checked })}
            className="mt-0.5 accent-purple-500 cursor-pointer"
          />
          <div>
            <div className="text-sm text-slate-200 font-medium">Product announcements & broadcasts</div>
            <div className="text-xs text-slate-500">Occasional emails from the ForgeSlicer team about new features, releases, and community highlights.</div>
          </div>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            data-testid="email-prefs-coop"
            type="checkbox"
            checked={prefs.coop_opt_in}
            disabled={saving}
            onChange={(e) => update({ coop_opt_in: e.target.checked })}
            className="mt-0.5 accent-purple-500 cursor-pointer"
          />
          <div>
            <div className="text-sm text-slate-200 font-medium">Cooperative-project notifications</div>
            <div className="text-xs text-slate-500">Proposal submissions, accept / reject decisions, join approvals. In-app notifications continue regardless of this setting.</div>
          </div>
        </label>
      </div>
      {saving && (
        <div className="mt-2 text-xs text-slate-400 flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" /> Saving…
        </div>
      )}
    </div>
  );
}
