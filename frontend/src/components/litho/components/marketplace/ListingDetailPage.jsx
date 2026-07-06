import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Layers, ShoppingBag, User as UserIcon } from "lucide-react";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { PurchaseDialog } from "./PurchaseDialog";
import { Lithophane3DPreview } from "./Lithophane3DPreview";
import { LibraryMatchPanel } from "../LibraryMatchPanel";
import { getListingDetail } from "../../lib/api";

export const ListingDetailPage = () => {
  const { jobId } = useParams();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Default to the rendered color preview because it shows the
  // color-accurate result; users can flip to 3D to inspect relief.
  const [previewMode, setPreviewMode] = useState("image");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getListingDetail(jobId);
        if (!cancelled) setListing(data);
      } catch {
        if (!cancelled) setError("Listing not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <div
      className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100"
      data-testid="listing-detail-page"
    >
      <MarketplaceHeader subtitle="Listing" />
      <main className="flex-1 max-w-6xl mx-auto w-full px-5 py-10">
        {loading && (
          <div className="font-mono text-xs text-zinc-500">Loading…</div>
        )}
        {error && (
          <div className="font-mono text-xs text-red-400">{error}</div>
        )}
        {listing && (
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10">
            {/* Preview */}
            <div className="border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="flex items-center border-b border-zinc-800 bg-zinc-950">
                <button
                  data-testid="preview-tab-image"
                  onClick={() => setPreviewMode("image")}
                  aria-pressed={previewMode === "image"}
                  className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    previewMode === "image"
                      ? "text-zinc-100 border-b border-zinc-100 -mb-px"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Render
                </button>
                <button
                  data-testid="preview-tab-3d"
                  onClick={() => setPreviewMode("3d")}
                  aria-pressed={previewMode === "3d"}
                  className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    previewMode === "3d"
                      ? "text-zinc-100 border-b border-zinc-100 -mb-px"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  3D
                </button>
                <span className="ml-auto pr-4 font-mono text-[9px] text-zinc-600 uppercase tracking-[0.18em]">
                  {previewMode === "3d" ? "Low-res · IP-safe" : "Slicer color render"}
                </span>
              </div>
              {previewMode === "image" ? (
                listing.preview_png_base64 ? (
                  <img
                    src={`data:image/png;base64,${listing.preview_png_base64}`}
                    alt={listing.title}
                    className="w-full h-auto block"
                    draggable={false}
                    data-testid="listing-preview"
                  />
                ) : (
                  <div className="aspect-square" />
                )
              ) : (
                <Lithophane3DPreview jobId={listing.job_id} height={480} />
              )}
            </div>

            {/* Details */}
            <div className="space-y-6">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2 flex items-center gap-1.5">
                  {listing.render_mode === "painting" ? "Painted" : "Lithophane"}
                  <span className="text-zinc-700">·</span>
                  {listing.total_layers} layers
                </div>
                <h1 className="font-display text-4xl font-black tracking-tight leading-none mb-1">
                  {listing.title}
                </h1>
                <Link
                  to={`/litho/creator/${listing.creator_id}`}
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500 hover:text-zinc-200 transition-colors mt-2"
                  data-testid="listing-creator-link"
                >
                  <UserIcon className="w-3 h-3" />
                  by {listing.creator_name}
                </Link>
              </div>

              {listing.description && (
                <div className="font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap border-l-2 border-zinc-800 pl-3">
                  {listing.description}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
                <div className="border border-zinc-800 p-3">
                  <div className="uppercase tracking-[0.18em] text-zinc-500 mb-1">
                    License
                  </div>
                  <div
                    className="text-zinc-200"
                    data-testid="listing-license"
                  >
                    {listing.license || "All Rights Reserved"}
                  </div>
                </div>
                <div className="border border-zinc-800 p-3">
                  <div className="uppercase tracking-[0.18em] text-zinc-500 mb-1">
                    Designed for
                  </div>
                  <div
                    className="text-zinc-200 truncate"
                    data-testid="listing-printer"
                  >
                    {listing.designed_for_printer || "Generic FDM"}
                  </div>
                  <div className="text-zinc-600 text-[9px] mt-1">
                    Buyer can re-export for a different printer after purchase.
                  </div>
                </div>
              </div>

              <div className="border border-zinc-800 p-5 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-display text-5xl font-black tabular-nums"
                    data-testid="listing-price"
                  >
                    ${listing.price_usd.toFixed(2)}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em]">
                    USD
                  </span>
                </div>
                <button
                  onClick={() => setDialogOpen(true)}
                  data-testid="purchase-btn"
                  className="w-full flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white transition-colors"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Buy · ${listing.price_usd.toFixed(2)}
                </button>
                <div className="font-mono text-[9px] text-zinc-600 leading-relaxed text-center">
                  Instant STL/3MF download after payment. Backup link
                  emailed for safekeeping. No account required.
                </div>
              </div>

              <div className="font-mono text-[10px] text-zinc-600 flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                {listing.total_layers} layers · {listing.render_mode}
              </div>

              {listing.filaments && listing.filaments.length > 0 && (
                <LibraryMatchPanel
                  palette={listing.filaments}
                  scope="mine"
                  testIdSuffix="-listing"
                  title="Can I print this?"
                  emptyHint="Sign in and add your filaments to instantly see whether you can reproduce this listing's palette."
                />
              )}
            </div>
          </div>
        )}
      </main>
      {dialogOpen && listing && (
        <PurchaseDialog listing={listing} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
};
