"""Resend email integration for ForgeSlicer transactional sends.

Currently fires one email: the Contributor Lifetime tier celebration.

Design notes:
- Resend's Python SDK is synchronous; we wrap it in asyncio.to_thread so
  the FastAPI event loop stays non-blocking.
- When RESEND_API_KEY is unset (dev/preview without secrets), every send
  becomes a logged no-op so feature code doesn't have to branch.
- Resend's sandbox sender (onboarding@resend.dev) only delivers to the
  account-owner's email until a custom domain is verified — that's fine
  for the launch celebration since the first contributor will be the
  account owner anyway. Switch SENDER_EMAIL once forgeslicer.com DNS is
  set up in Resend → Domains.
"""

import os
import logging
import asyncio
from typing import Optional

import resend

logger = logging.getLogger(__name__)


# Track the most recent send failure so the UI can warn users when email
# delivery is degraded (e.g. key was rotated/invalidated, domain not yet
# verified, Resend outage). Cleared on the next successful send.
# Tuple format: (iso_timestamp, error_message). None when last send was OK
# OR we haven't sent anything yet this process.
_last_email_error: Optional[tuple[str, str]] = None
_last_email_success: Optional[str] = None


def get_email_status() -> dict:
    """Return a snapshot of Resend delivery health for the UI to surface.

    Healthy states:
    - configured + last attempt succeeded (or no attempts yet but key looks valid)
    Degraded states:
    - not configured (no API key)
    - last attempt failed (key revoked / Resend outage / sandbox limit hit)
    """
    if not _configured():
        return {
            "configured": False,
            "healthy": False,
            "message": "Email delivery isn't configured on this deployment. Use Google sign-in or email + password for now.",
            "last_error": None,
            "last_success_at": None,
        }
    if _last_email_error:
        when, what = _last_email_error
        return {
            "configured": True,
            "healthy": False,
            "message": "We couldn't deliver emails recently — please use Google sign-in or email + password until this is fixed.",
            "last_error": {"at": when, "detail": what},
            "last_success_at": _last_email_success,
        }
    return {
        "configured": True,
        "healthy": True,
        "message": "",
        "last_error": None,
        "last_success_at": _last_email_success,
    }


def _record_success() -> None:
    global _last_email_error, _last_email_success
    from datetime import datetime, timezone
    _last_email_error = None
    _last_email_success = datetime.now(timezone.utc).isoformat()


def _record_failure(err: Exception) -> None:
    global _last_email_error
    from datetime import datetime, timezone
    _last_email_error = (datetime.now(timezone.utc).isoformat(), str(err)[:200])


def _configured() -> bool:
    """True only when a real Resend API key is available."""
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key or key.startswith("re_your_") or key == "":
        return False
    resend.api_key = key
    return True


def _sender() -> str:
    """Fall back to the Resend sandbox if no custom sender configured."""
    return os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip()


def _app_url() -> str:
    return os.environ.get("APP_PUBLIC_URL", "https://forgeslicer.com").rstrip("/")


async def _send(params: dict, *, ok_log: str, fail_log: str) -> Optional[str]:
    """Fire a Resend send off-thread. Returns the message id on success,
    None on failure. Never raises — email must not block caller flows."""
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = result.get("id") if isinstance(result, dict) else None
        logger.info(ok_log, params["to"][0], msg_id)
        _record_success()
        return msg_id
    except Exception as e:  # noqa: BLE001 - we want to swallow ALL Resend failures
        logger.warning(fail_log, params["to"][0], e)
        _record_failure(e)
        return None


def _contributor_celebration_html(display_name: str, profile_url: str) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0f172a;font-family:'IBM Plex Sans',Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;text-align:center;">
                <div style="font-size:48px;line-height:1;">🏆</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;text-align:center;">
                <h1 style="margin:0;color:#fb923c;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                  You're a ForgeSlicer Contributor for life
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0 0 16px 0;color:#cbd5e1;font-size:15px;line-height:1.55;">
                  Hey {display_name},
                </p>
                <p style="margin:0 0 16px 0;color:#cbd5e1;font-size:15px;line-height:1.55;">
                  You just crossed the threshold — <strong style="color:#34d399;">100+ open-source components</strong>
                  and <strong style="color:#34d399;">20+ open-source designs</strong> published to the public gallery.
                  That makes you part of a very small group keeping the maker commons alive.
                </p>
                <p style="margin:0 0 16px 0;color:#cbd5e1;font-size:15px;line-height:1.55;">
                  As thanks, your account is now permanently flagged
                  <strong style="color:#34d399;">Contributor Lifetime</strong>. Whatever paid tiers ForgeSlicer
                  introduces in the future, you're in free — forever, no questions asked.
                </p>
                <p style="margin:0 0 24px 0;color:#cbd5e1;font-size:15px;line-height:1.55;">
                  Your Contributor badge is now visible on your profile page.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 32px 32px;">
                <a href="{profile_url}" style="display:inline-block;background:#f97316;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:6px;">
                  View your profile →
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;border-top:1px solid #334155;">
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px;line-height:1.5;">
                  Thanks for the work you publish under open licenses. The whole 3D printing community
                  benefits when great parts are remixable.
                </p>
                <p style="margin:8px 0 0 0;color:#64748b;font-size:12px;line-height:1.5;">
                  — The ForgeSlicer Team
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _contributor_celebration_text(display_name: str, profile_url: str) -> str:
    return f"""You're a ForgeSlicer Contributor for life

Hey {display_name},

You just crossed the threshold — 100+ open-source components and 20+ open-source
designs published to the public gallery. That makes you part of a very small group
keeping the maker commons alive.

As thanks, your account is now permanently flagged Contributor Lifetime. Whatever
paid tiers ForgeSlicer introduces in the future, you're in free — forever.

View your profile: {profile_url}

Thanks for the work you publish under open licenses.
— The ForgeSlicer Team
"""


async def send_contributor_celebration(to_email: str, to_name: str) -> Optional[str]:
    """Send the "🏆 You're a Contributor for life" email.

    Returns the Resend message id on success, or None if Resend isn't
    configured / the send failed. Never raises — the caller's flow (DB
    update + toast) must succeed regardless of email outcome.
    """
    if not to_email:
        return None
    if not _configured():
        logger.info("Resend not configured; skipping contributor celebration email to %s", to_email)
        return None

    profile_url = f"{_app_url()}/profile"
    display_name = (to_name or "Maker").strip()
    return await _send(
        {
            "from": _sender(),
            "to": [to_email],
            "subject": "🏆 You're a ForgeSlicer Contributor for life!",
            "html": _contributor_celebration_html(display_name, profile_url),
            "text": _contributor_celebration_text(display_name, profile_url),
        },
        ok_log="Contributor celebration email sent to %s (id=%s)",
        fail_log="Contributor celebration email failed for %s: %s",
    )


# ---------- Transactional auth emails ----------

def _wrap_email(title: str, body_html: str, cta_text: str, cta_url: str, footer: str) -> str:
    """Shared dark-themed transactional template — matches the ForgeSlicer
    aesthetic so users immediately recognize the sender."""
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0f172a;font-family:'IBM Plex Sans',Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 0 32px;">
            <h1 style="margin:0;color:#fb923c;font-size:22px;font-weight:700;letter-spacing:-0.5px;">{title}</h1>
          </td></tr>
          <tr><td style="padding:16px 32px 0 32px;color:#cbd5e1;font-size:15px;line-height:1.55;">
            {body_html}
          </td></tr>
          <tr><td align="center" style="padding:24px 32px 32px 32px;">
            <a href="{cta_url}" style="display:inline-block;background:#f97316;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:6px;">{cta_text} →</a>
            <p style="margin:16px 0 0 0;color:#64748b;font-size:11px;line-height:1.5;word-break:break-all;">If the button doesn't work, paste this URL into your browser:<br/>{cta_url}</p>
          </td></tr>
          <tr><td style="padding:0 32px 24px 32px;border-top:1px solid #334155;">
            <p style="margin:16px 0 0 0;color:#64748b;font-size:12px;line-height:1.5;">{footer}</p>
            <p style="margin:8px 0 0 0;color:#64748b;font-size:12px;line-height:1.5;">— The ForgeSlicer Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>"""


async def send_magic_link_email(to_email: str, to_name: str, link: str) -> Optional[str]:
    """Send a one-time sign-in link valid for 15 minutes."""
    if not to_email or not _configured():
        if not _configured():
            logger.info("Resend not configured; magic link for %s would be: %s", to_email, link)
        return None
    name = (to_name or "Maker").strip()
    subject = "Your ForgeSlicer sign-in link"
    body_html = (
        f"<p>Hey {name},</p>"
        "<p>Click the button below to sign in to ForgeSlicer. This link expires in 15 minutes and can only be used once.</p>"
        "<p>If you didn't request this, ignore this email — no one can access your account without the link.</p>"
    )
    html = _wrap_email(
        "Sign in to ForgeSlicer", body_html, "Sign in now", link,
        "Magic links never expose your password — just click the button when you want to sign in.",
    )
    text = f"Sign in to ForgeSlicer\n\nHi {name},\n\nClick this link to sign in (expires in 15 minutes, single-use):\n{link}\n\nIf you didn't request this, ignore this email.\n\n— The ForgeSlicer Team\n"
    params = {"from": _sender(), "to": [to_email], "subject": subject, "html": html, "text": text}
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = result.get("id") if isinstance(result, dict) else None
        logger.info("Magic link sent to %s (id=%s)", to_email, msg_id)
        _record_success()
        return msg_id
    except Exception as e:  # noqa: BLE001
        logger.warning("Magic link send failed for %s: %s", to_email, e)
        _record_failure(e)
        return None


async def send_password_reset_email(to_email: str, to_name: str, link: str) -> Optional[str]:
    """Send a password-reset link valid for 60 minutes."""
    if not to_email or not _configured():
        if not _configured():
            logger.info("Resend not configured; password reset link for %s would be: %s", to_email, link)
        return None
    name = (to_name or "Maker").strip()
    subject = "Reset your ForgeSlicer password"
    body_html = (
        f"<p>Hey {name},</p>"
        "<p>Someone requested a password reset for your ForgeSlicer account. Click the button to choose a new password. This link expires in 60 minutes.</p>"
        "<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>"
    )
    html = _wrap_email(
        "Reset your password", body_html, "Choose a new password", link,
        "For your security, the link can only be used once. Resetting your password will sign you out everywhere.",
    )
    text = f"Reset your ForgeSlicer password\n\nHi {name},\n\nClick this link to reset (expires in 60 minutes, single-use):\n{link}\n\nIf you didn't request this, ignore this email.\n\n— The ForgeSlicer Team\n"
    params = {"from": _sender(), "to": [to_email], "subject": subject, "html": html, "text": text}
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = result.get("id") if isinstance(result, dict) else None
        logger.info("Password reset sent to %s (id=%s)", to_email, msg_id)
        _record_success()
        return msg_id
    except Exception as e:  # noqa: BLE001
        logger.warning("Password reset send failed for %s: %s", to_email, e)
        _record_failure(e)
        return None


# ---------- Admin upstream-profile digest ----------

def _digest_row_table(rows, accent_color):
    if not rows:
        return ""
    items = "".join(
        f"<tr><td style='padding:6px 12px;border-top:1px solid #1e293b;font-family:monospace;color:#cbd5f5;'>{r.get('vendor','?')}</td>"
        f"<td style='padding:6px 12px;border-top:1px solid #1e293b;font-family:monospace;color:#e2e8f0;'>{r.get('name','?')}</td></tr>"
        for r in rows[:30]
    )
    more = ("" if len(rows) <= 30
            else f"<tr><td colspan='2' style='padding:6px 12px;color:#64748b;border-top:1px solid #1e293b;'>… and {len(rows) - 30} more</td></tr>")
    return (
        f"<div style='margin:18px 0 6px 0;font-weight:600;color:{accent_color};font-size:13px;text-transform:uppercase;letter-spacing:0.06em;'>"
        f"{len(rows)} {'new' if accent_color == '#22d3ee' else 'changed'}"
        "</div>"
        "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#0b1220;border:1px solid #1e293b;border-radius:8px;font-size:12px;'>"
        f"{items}{more}"
        "</table>"
    )


def _digest_html(name: str, total: int, period_label: str, new_deltas: list, changed_deltas: list, link: str) -> str:
    body_html = (
        f"<p>Hey {name},</p>"
        f"<p>The upstream OrcaSlicer profile sync found <strong>{total} update"
        f"{'s' if total != 1 else ''}</strong> {period_label}.</p>"
        f"{_digest_row_table(new_deltas, '#22d3ee')}"
        f"{_digest_row_table(changed_deltas, '#e879f9')}"
        "<p style='margin-top:18px;color:#94a3b8;font-size:12px;'>"
        "Open the admin dashboard to review the JSON diff and merge into the global library, "
        "or dismiss anything you don't want."
        "</p>"
    )
    return _wrap_email(
        f"{total} profile update{'s' if total != 1 else ''} waiting",
        body_html,
        "Review in admin",
        link,
        "You're receiving this because you're an admin on ForgeSlicer. "
        "These digests only fire when there are actually changes — quiet weeks stay quiet.",
    )


def _digest_text(name: str, total: int, period_label: str, new_deltas: list, changed_deltas: list, link: str) -> str:
    text_rows_new = "\n".join(f"  NEW    {r.get('vendor','?')} / {r.get('name','?')}" for r in new_deltas[:30])
    text_rows_chg = "\n".join(f"  CHANGE {r.get('vendor','?')} / {r.get('name','?')}" for r in changed_deltas[:30])
    return (
        f"ForgeSlicer upstream digest\n\n"
        f"Hi {name},\n\n"
        f"{total} OrcaSlicer profile update{'s' if total != 1 else ''} {period_label}:\n\n"
        f"{text_rows_new}\n{text_rows_chg}\n\n"
        f"Review + merge: {link}\n\n— ForgeSlicer\n"
    )


async def send_upstream_digest(
    to_email: str,
    to_name: str,
    *,
    new_deltas: list,
    changed_deltas: list,
    period_label: str = "this week",
) -> Optional[str]:
    """Weekly admin digest: "N new + M changed upstream profiles waiting
    in /admin → Orca sync." Each delta row contains `{vendor, name, kind,
    path}` — we render a compact table in the email so the admin can
    triage at a glance before deciding whether to log in and merge.

    Sends nothing when Resend is unconfigured, when the admin email is
    missing, or when neither bucket has any deltas (no point pinging
    admins about an empty week)."""
    if not _configured() or not to_email:
        return None
    if not new_deltas and not changed_deltas:
        # Skip empty weeks — silence is the better default than
        # "nothing happened, but here's an email anyway".
        return None
    name = (to_name or "Admin").strip()
    total = len(new_deltas) + len(changed_deltas)
    link = f"{_app_url()}/admin?tab=orca-upstream"
    msg_id = await _send(
        {
            "from": _sender(),
            "to": [to_email],
            "subject": f"ForgeSlicer · {total} OrcaSlicer profile update{'s' if total != 1 else ''} ready to review",
            "html": _digest_html(name, total, period_label, new_deltas, changed_deltas, link),
            "text": _digest_text(name, total, period_label, new_deltas, changed_deltas, link),
        },
        ok_log="Upstream digest sent to %s (id=%s)",
        fail_log="Upstream digest send failed for %s: %s",
    )
    if msg_id:
        logger.info("Upstream digest — %d new, %d changed", len(new_deltas), len(changed_deltas))
    return msg_id


# ─────────────────────────────────────────────────────────────────────
# Iter-151.15 — Coop-projects + admin-broadcast email helpers.
#
# These reuse the low-level `_send`, `_sender`, `_app_url`, `_configured`
# helpers above — the goal is to keep the transactional-email footprint
# consolidated in one module.
# ─────────────────────────────────────────────────────────────────────


def _unsubscribe_link(unsubscribe_token: Optional[str], kind: str) -> str:
    if not unsubscribe_token:
        return ""
    base = _app_url() or "https://forgeslicer.app"
    return f"{base}/unsubscribe/{unsubscribe_token}?kind={kind}"


def _footer_with_unsubscribe(unsubscribe_token: Optional[str], kind: str) -> str:
    """Build the small opt-out footer for coop / broadcast emails.
    We ALWAYS point at the Account page too — that link works even
    when the token-based one doesn't (legacy accounts without a token
    row). Compliance uses the token URL; the Account link is the
    always-safe fallback."""
    base = _app_url() or "https://forgeslicer.app"
    token_link = _unsubscribe_link(unsubscribe_token, kind)
    if token_link:
        return (
            '<p style="color:#94a3b8;font-size:11px;margin-top:24px;line-height:1.5;">'
            f'You received this because your ForgeSlicer email preferences allow it. '
            f'<a href="{token_link}" style="color:#a78bfa;">Unsubscribe from these emails</a>'
            f' or manage all preferences in <a href="{base}/profile" style="color:#a78bfa;">your account</a>.'
            '</p>'
        )
    return (
        '<p style="color:#94a3b8;font-size:11px;margin-top:24px;">'
        f'Manage email preferences in <a href="{base}/profile" style="color:#a78bfa;">your account</a>.'
        '</p>'
    )


def _coop_email_html(*, title: str, body_html: str, cta_url: Optional[str], cta_text: Optional[str], unsubscribe_token: Optional[str]) -> str:
    cta = ""
    if cta_url and cta_text:
        cta = (
            f'<p style="margin-top:20px;">'
            f'<a href="{cta_url}" style="display:inline-block;padding:10px 18px;'
            f'background:#8b5cf6;color:#fff;border-radius:6px;'
            f'text-decoration:none;font-weight:600;">{cta_text}</a>'
            '</p>'
        )
    footer = _footer_with_unsubscribe(unsubscribe_token, "coop")
    return f"""\
<!doctype html>
<html>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#1e293b;border-radius:10px;padding:28px;">
        <tr><td>
          <h1 style="color:#f8fafc;margin:0 0 12px;font-size:22px;">{title}</h1>
          <div style="color:#cbd5e1;font-size:14px;line-height:1.5;">{body_html}</div>
          {cta}
          {footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


async def send_coop_notification_email(
    *,
    to_email: str,
    to_name: str,
    title: str,
    body_html: str,
    cta_url: Optional[str] = None,
    cta_text: Optional[str] = None,
    unsubscribe_token: Optional[str] = None,
) -> Optional[str]:
    """Send a single cooperative-projects notification email. Best-
    effort (returns None on failure)."""
    if not _configured():
        logger.debug("email off; skip coop email to %s", to_email)
        return None
    html = _coop_email_html(
        title=title, body_html=body_html,
        cta_url=cta_url, cta_text=cta_text,
        unsubscribe_token=unsubscribe_token,
    )
    resend.api_key = os.environ["RESEND_API_KEY"]
    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": title,
        "html": html,
    }
    return await _send(
        params,
        ok_log="Coop email sent to %s (id=%s)",
        fail_log="Coop email FAILED for %s: %s",
    )


async def send_broadcast_email(
    *,
    to_email: str,
    subject: str,
    body_html: str,
    unsubscribe_token: Optional[str] = None,
) -> Optional[str]:
    """Send one message of a bulk admin broadcast. Recipients are
    per-user so we can personalise the unsubscribe token in the
    footer. Called in a loop from the admin broadcasts endpoint —
    each send is sequential to stay within Resend's rate limits."""
    if not _configured():
        return None
    footer = _footer_with_unsubscribe(unsubscribe_token, "broadcast")
    html = f"""\
<!doctype html>
<html>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#1e293b;border-radius:10px;padding:28px;">
        <tr><td>
          <div style="color:#e2e8f0;font-size:14px;line-height:1.55;">{body_html}</div>
          {footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
    resend.api_key = os.environ["RESEND_API_KEY"]
    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": subject,
        "html": html,
    }
    return await _send(
        params,
        ok_log="Broadcast sent to %s (id=%s)",
        fail_log="Broadcast FAILED for %s: %s",
    )

