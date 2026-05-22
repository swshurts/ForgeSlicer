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

    subject = "🏆 You're a ForgeSlicer Contributor for life!"
    html = f"""\
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

    text = f"""You're a ForgeSlicer Contributor for life

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

    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }

    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = result.get("id") if isinstance(result, dict) else None
        logger.info("Contributor celebration email sent to %s (id=%s)", to_email, msg_id)
        _record_success()
        return msg_id
    except Exception as e:  # noqa: BLE001 - we want to swallow ALL Resend failures
        logger.warning("Contributor celebration email failed for %s: %s", to_email, e)
        _record_failure(e)
        return None


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
