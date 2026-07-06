import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Store, X } from "lucide-react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  getListingStatus,
  publishListing,
  unpublishListing,
  PLATFORM_FEE_PCT,
  LICENSE_PRESETS,
} from "../lib/api";

/**
 * Modal for publishing a job to the public marketplace.
 * Loads any existing listing data so the creator can edit price/copy
 * without recreating the job.
 */
export const PublishDialog = ({ jobId, jobName, onClose, onChanged }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("29");
  const [license, setLicense] = useState("All Rights Reserved");
  const [existing, setExisting] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getListingStatus(jobId);
        if (cancelled) return;
        if (data.listed && data.listing) {
          setExisting(data.listing);
          setTitle(data.listing.title || "");
          setDescription(data.listing.description || "");
          setPrice(String(data.listing.price_usd ?? 29));
          setLicense(data.listing.license || "All Rights Reserved");
        } else {
          // Sensible defaults derived from the job name.
          setTitle(jobName?.replace(/^\s*\w+\s\d+,\s\d+\s·\s\d+:\d+\s·\s/, "") || "Untitled lithophane");
        }
      } catch {
        // Job might not be fetchable; user will see empty form.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, jobName]);

  const priceNum = parseFloat(price);
  const validPrice = Number.isFinite(priceNum) && priceNum >= 0;
  const validTitle = title.trim().length >= 2;
  const canSubmit = validTitle && validPrice && !busy;

  const handlePublish = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await publishListing(jobId, {
        title: title.trim(),
        description: description.trim(),
        price_usd: priceNum,
        license,
      });
      toast.success(existing ? "Listing updated" : "Published to marketplace");
      onChanged && onChanged({ listed: true });
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not publish");
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await unpublishListing(jobId);
      toast.success("Removed from marketplace");
      onChanged && onChanged({ listed: false });
      onClose();
    } catch {
      toast.error("Could not unpublish");
    } finally {
      setBusy(false);
    }
  };

  const fee = validPrice ? (priceNum * PLATFORM_FEE_PCT) / 100 : 0;
  const payout = validPrice ? priceNum - fee : 0;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="publish-dialog"
    >
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-100">
            <Store className="w-3 h-3" />
            {existing ? "Edit listing" : "Publish to marketplace"}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="publish-close"
            className="w-7 h-7 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5 block">
              Title <span className="text-zinc-700">(required)</span>
            </label>
            <Input
              data-testid="listing-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunset over Mt. Hood"
              maxLength={120}
              className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-sm h-9"
            />
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5 block">
              Description
            </label>
            <textarea
              data-testid="listing-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Backlit lithophane of a sunrise shot from the summit trail…"
              rows={4}
              maxLength={2000}
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
            />
            <div className="font-mono text-[9px] text-zinc-700 mt-1 text-right">
              {description.length} / 2000
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5 block">
              Asking price <span className="text-zinc-700">(USD)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-500">
                $
              </span>
              <Input
                data-testid="listing-price-input"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-sm h-9 pl-7"
              />
            </div>
          </div>

          <div className="border border-zinc-800 p-3 space-y-1 font-mono text-[10px]">
            <div className="flex items-center justify-between text-zinc-500">
              <span>Buyer pays</span>
              <span className="text-zinc-100 tabular-nums">
                ${validPrice ? priceNum.toFixed(2) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-600">
              <span>Platform fee ({PLATFORM_FEE_PCT}%)</span>
              <span className="tabular-nums">
                −${validPrice ? fee.toFixed(2) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-800 pt-1 mt-1">
              <span className="text-zinc-400 uppercase tracking-[0.12em]">
                Your payout
              </span>
              <span
                className="text-emerald-300 tabular-nums font-bold"
                data-testid="creator-payout"
              >
                ${validPrice ? payout.toFixed(2) : "—"}
              </span>
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5 block">
              License
            </label>
            <Select value={license} onValueChange={setLicense}>
              <SelectTrigger
                data-testid="listing-license-select"
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none bg-zinc-950 border-zinc-800 max-h-[60vh]">
                {LICENSE_PRESETS.map((l) => (
                  <SelectItem
                    key={l.id}
                    value={l.id}
                    className="font-mono text-xs rounded-none"
                    data-testid={`license-option-${l.id}`}
                  >
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="font-mono text-[9px] text-zinc-600 mt-1 leading-relaxed">
              How buyers may use the downloaded STL/3MF. Personal Use Only
              blocks resale; CC-BY-NC permits attribution-only non-commercial
              remixes; CC0 releases to public domain.
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handlePublish}
              disabled={!canSubmit}
              data-testid="publish-confirm"
              className="flex-1 h-9 rounded-none bg-zinc-100 text-zinc-950 hover:bg-zinc-300 text-[10px] uppercase tracking-[0.18em] font-bold disabled:opacity-40"
            >
              {existing ? "Save changes" : "Publish"}
            </Button>
            {existing && (
              <Button
                onClick={handleUnpublish}
                disabled={busy}
                data-testid="unpublish-btn"
                className="h-9 rounded-none bg-transparent border border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-red-300 hover:border-red-900 text-[10px] uppercase tracking-[0.18em] font-bold"
              >
                Unlist
              </Button>
            )}
          </div>

          <div className="font-mono text-[9px] text-zinc-600 leading-relaxed">
            Buyers pay via Stripe; STL/3MF download is auto-delivered.
            Buyers can re-export with a different printer profile on
            their end without altering this design.
          </div>
        </div>
      </div>
    </div>
  );
};
