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
        return msg_id
    except Exception as e:  # noqa: BLE001 - we want to swallow ALL Resend failures
        logger.warning("Contributor celebration email failed for %s: %s", to_email, e)
        return None
