"""Transactional email delivery via Resend.

Used by the marketplace checkout flow to email buyers their tokenized
download link after Stripe confirms payment. Sending is fire-and-forget
from the caller's perspective — failures are logged but never raised
so a delivery hiccup doesn't block the buyer's on-page downloads.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import resend

logger = logging.getLogger("forgeslicer.litho.email")


def _is_configured() -> bool:
    key = os.environ.get("RESEND_API_KEY", "")
    return bool(key) and not key.startswith("re_placeholder")


def _origin_for(buyer_origin: Optional[str]) -> str:
    if buyer_origin:
        return buyer_origin.rstrip("/")
    return os.environ.get("APP_ORIGIN", "").rstrip("/")


def _build_download_html(
    listing_title: str,
    job_id: str,
    download_token: str,
    creator_name: str,
    origin: str,
) -> str:
    success_url = f"{origin}/litho/marketplace/{job_id}/success?session_id=__paid__"
    stl_url = f"{origin}/api/litho/studio/export/{job_id}/stl?token={download_token}"
    threemf_url = f"{origin}/api/litho/studio/export/{job_id}/3mf?token={download_token}"
    swaps_url = f"{origin}/api/litho/studio/export/{job_id}/swaps?token={download_token}"

    return f"""\
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background:#09090b; color:#e4e4e7; padding:40px 20px; margin:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width: 580px; margin: 0 auto; background:#18181b;
                border:1px solid #27272a; padding:30px;">
    <tr><td>
      <h1 style="font-size:24px; font-weight:900; margin:0 0 8px 0; color:#fafafa;">
        Your lithophane is ready
      </h1>
      <p style="font-size:13px; color:#a1a1aa; margin:0 0 24px 0;">
        Thanks for purchasing <strong style="color:#fafafa;">{listing_title}</strong>
        by {creator_name}. Files are ready to download below — these links
        do not expire.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;
             border-collapse: separate; border-spacing: 0 8px;">
        <tr><td>
          <a href="{stl_url}"
             style="display:block; background:#fafafa; color:#09090b;
                    text-decoration:none; padding:14px 16px; font-weight:700;
                    font-family: monospace; font-size:12px; letter-spacing:0.18em;
                    text-transform: uppercase;">
            Download STL mesh →
          </a>
        </td></tr>
        <tr><td>
          <a href="{threemf_url}"
             style="display:block; background:#fafafa; color:#09090b;
                    text-decoration:none; padding:14px 16px; font-weight:700;
                    font-family: monospace; font-size:12px; letter-spacing:0.18em;
                    text-transform: uppercase;">
            Download 3MF bundle →
          </a>
        </td></tr>
        <tr><td>
          <a href="{swaps_url}"
             style="display:block; background:#27272a; color:#fafafa;
                    text-decoration:none; padding:14px 16px; font-weight:700;
                    font-family: monospace; font-size:12px; letter-spacing:0.18em;
                    text-transform: uppercase;">
            Download Swap Instructions →
          </a>
        </td></tr>
      </table>

      <p style="font-size:11px; color:#71717a; margin:24px 0 0 0; line-height:1.6;">
        Need to re-export for a different printer? Visit
        <a href="{success_url}" style="color:#a1a1aa;">your purchase page</a>
        and pick from the printer dropdown — we'll regenerate the files
        with the right auto-pause flavour.
      </p>
      <p style="font-size:10px; color:#52525b; margin:20px 0 0 0;">
        ForgeSlicer · Lithophane Studio
      </p>
    </td></tr>
  </table>
</body>
</html>
"""


async def send_purchase_email(
    *,
    to_email: str,
    listing_title: str,
    job_id: str,
    download_token: str,
    creator_name: str,
    buyer_origin: Optional[str] = None,
) -> bool:
    """Send the post-payment download email. Returns True on success.

    All failures are caught + logged so callers can continue without
    raising — the buyer always has the on-page download links as backup.
    """
    if not _is_configured():
        logger.info(
            "Resend not configured (RESEND_API_KEY missing/placeholder); "
            "skipping email to %s", to_email,
        )
        return False

    resend.api_key = os.environ["RESEND_API_KEY"]
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    origin = _origin_for(buyer_origin)

    params = {
        "from": sender,
        "to": [to_email],
        "subject": f"Your lithophane is ready — {listing_title}",
        "html": _build_download_html(
            listing_title, job_id, download_token, creator_name, origin
        ),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Sent purchase email to %s (id=%s)", to_email, result.get("id"))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Resend send failed for %s: %s", to_email, exc)
        return False
