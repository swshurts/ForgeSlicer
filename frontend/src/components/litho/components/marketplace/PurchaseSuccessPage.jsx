import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileText } from "lucide-react";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { PrinterSelect } from "../PrinterSelect";
import {
  checkBedFit,
  getCheckoutStatus,
  getListingDetail,
  tokenExportUrl,
} from "../../lib/api";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // ~60 seconds; Stripe usually resolves in a few seconds.

/** Marketplace post-checkout page.
 *
 *  Reads `session_id` from the URL (Stripe redirects here with it), polls
 *  /marketplace/checkout/status/{session_id} until paid, then surfaces the
 *  per-job download token so the buyer can grab their STL/3MF immediately.
 */
export const PurchaseSuccessPage = () => {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session_id");
  // Braintree's Drop-in path returns the download_token synchronously
  // (no Stripe-style async settlement), so we accept a pre-baked
  // `&token=...` and skip the polling entirely when present.
  const presetToken = searchParams.get("token");

  const [status, setStatus] = useState(presetToken ? "paid" : "checking");
  const [token, setToken] = useState(presetToken || null);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState("");
  const [buyerPrinter, setBuyerPrinter] = useState(null); // null = use creator's
  const [bedFit, setBedFit] = useState(null); // {fits, bed_x_mm, bed_y_mm, printer_name}
  const pollsRef = useRef(0);

  useEffect(() => {
    // Braintree path supplies the download token in the URL — no polling.
    if (presetToken) return undefined;
    if (!sessionId) {
      // Defer via microtask so the state update doesn't fire synchronously
      // inside the effect (eslint react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        setStatus("error");
        setError("Missing session id");
      });
      return undefined;
    }
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      pollsRef.current += 1;
      try {
        const data = await getCheckoutStatus(sessionId);
        if (data.payment_status === "paid") {
          if (!cancelled) {
            setStatus("paid");
            setToken(data.download_token);
          }
          return;
        }
        if (data.status === "expired") {
          if (!cancelled) {
            setStatus("expired");
            setError("This checkout session expired");
          }
          return;
        }
        if (pollsRef.current >= MAX_POLLS) {
          if (!cancelled) {
            setStatus("error");
            setError("Timed out waiting for Stripe. Check your email for the link.");
          }
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err?.response?.data?.detail || "Could not check payment status");
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId, presetToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getListingDetail(jobId);
        if (!cancelled) setListing(data);
      } catch {
        /* not fatal — show generic copy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Whenever the buyer changes printer, check if the design fits their bed.
  useEffect(() => {
    if (!buyerPrinter || !listing) {
      queueMicrotask(() => setBedFit(null));
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await checkBedFit(
          buyerPrinter,
          listing.width_mm || 0,
          listing.height_mm || 0,
        );
        if (!cancelled) setBedFit(r);
      } catch {
        if (!cancelled) setBedFit(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buyerPrinter, listing]);

  return (
    <div
      className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100"
      data-testid="purchase-success-page"
    >
      <MarketplaceHeader subtitle="Checkout" />
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-12">
        {status === "checking" && (
          <div className="text-center space-y-3" data-testid="status-checking">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 animate-pulse">
              Confirming your payment…
            </div>
            <div className="font-mono text-[10px] text-zinc-600">
              Please don&apos;t close this tab.
            </div>
          </div>
        )}

        {status === "paid" && token && (
          <div className="space-y-8" data-testid="status-paid">
            <div className="text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h1 className="font-display text-4xl font-black tracking-tight leading-none">
                Payment received
              </h1>
              <div className="font-mono text-[11px] text-zinc-500">
                We&apos;ve emailed your download link as backup. Below are the
                files ready to print.
              </div>
            </div>

            {listing && (
              <div className="border border-zinc-800 p-5 flex gap-5 items-center">
                {listing.preview_png_base64 && (
                  <img
                    src={`data:image/png;base64,${listing.preview_png_base64}`}
                    alt={listing.title}
                    className="w-24 h-24 object-cover border border-zinc-800"
                  />
                )}
                <div>
                  <div className="font-display text-xl font-bold">
                    {listing.title}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500 mt-1">
                    by {listing.creator_name}
                  </div>
                </div>
              </div>
            )}

            <div
              className="border border-zinc-800 p-4 space-y-3"
              data-testid="buyer-printer-override"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Re-export for your printer{" "}
                <span className="text-zinc-700 normal-case tracking-normal">
                  (optional)
                </span>
              </div>
              <PrinterSelect
                value={buyerPrinter || (listing?.designed_for_printer || "generic_orca")}
                onChange={setBuyerPrinter}
                testId="buyer-printer-select"
              />
              {bedFit && !bedFit.fits && (
                <div
                  className="flex items-start gap-2 border border-amber-900 bg-amber-950/40 p-2 font-mono text-[10px] text-amber-300"
                  data-testid="bed-fit-warning"
                >
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <div className="leading-relaxed">
                    Warning: this design is {listing.width_mm}×{listing.height_mm}mm
                    but the {bedFit.printer_name} bed is only{" "}
                    {bedFit.bed_x_mm}×{bedFit.bed_y_mm}mm. You&apos;ll need
                    to scale it down in your slicer.
                  </div>
                </div>
              )}
              <div className="font-mono text-[9px] text-zinc-600 leading-relaxed">
                Defaults to the creator&apos;s choice (
                {listing?.designed_for_printer || "generic FDM"}). Picking a
                different printer regenerates the 3MF/STL with that
                printer&apos;s auto-pause flavour (M600 vs AMS tool change).
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <a
                href={tokenExportUrl(jobId, "stl", token, buyerPrinter)}
                download
                data-testid="download-stl"
                className="flex flex-col items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-400 bg-zinc-900 py-6 transition-colors"
              >
                <FileArchive className="w-6 h-6" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                  STL
                </span>
              </a>
              <a
                href={tokenExportUrl(jobId, "3mf", token, buyerPrinter)}
                download
                data-testid="download-3mf"
                className="flex flex-col items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-400 bg-zinc-900 py-6 transition-colors"
              >
                <Download className="w-6 h-6" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                  3MF
                </span>
              </a>
              <a
                href={tokenExportUrl(jobId, "swaps", token, buyerPrinter)}
                download
                data-testid="download-swaps"
                className="flex flex-col items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-400 bg-zinc-900 py-6 transition-colors"
              >
                <FileText className="w-6 h-6" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                  Swaps
                </span>
              </a>
            </div>

            <div className="text-center font-mono text-[10px] text-zinc-600 leading-relaxed">
              Bookmark this page — your download token is valid permanently.
              <br />
              <Link to="/litho/marketplace" className="underline hover:text-zinc-300">
                ← Back to marketplace
              </Link>
            </div>
          </div>
        )}

        {(status === "expired" || status === "error") && (
          <div className="space-y-4 text-center" data-testid="status-error">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-red-400">
              {status === "expired" ? "Session expired" : "Something went wrong"}
            </div>
            <div className="font-mono text-[11px] text-zinc-400">{error}</div>
            <button
              onClick={() => navigate(`/litho/marketplace/${jobId}`)}
              className="font-mono text-[10px] uppercase tracking-[0.18em] border border-zinc-700 px-4 py-2 hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
              data-testid="back-to-listing-btn"
            >
              Back to listing
            </button>
          </div>
        )}
      </main>
    </div>
  );
};
