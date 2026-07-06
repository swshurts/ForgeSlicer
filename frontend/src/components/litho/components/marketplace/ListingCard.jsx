import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layers } from "lucide-react";

const fmtPrice = (p) =>
  typeof p === "number"
    ? `$${p.toFixed(2)}`
    : "—";

/** Reusable thumbnail card for marketplace + creator pages. */
export const ListingCard = ({ listing }) => {
  const navigate = useNavigate();
  return (
    <Link
      to={`/litho/marketplace/${listing.job_id}`}
      data-testid={`listing-${listing.job_id}`}
      className="block group border border-zinc-800 hover:border-zinc-400 transition-colors duration-150 bg-zinc-950"
    >
      <div className="relative aspect-square overflow-hidden bg-zinc-900">
        {listing.thumbnail_base64 ? (
          <img
            src={`data:image/png;base64,${listing.thumbnail_base64}`}
            alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            draggable={false}
          />
        ) : null}
        <div className="absolute bottom-1 left-1 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-400 bg-black/60 px-1.5 py-0.5 border border-white/10">
          {listing.render_mode}
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="font-display text-sm font-bold leading-tight text-zinc-100 truncate">
          {listing.title}
        </div>
        <div className="flex items-center justify-between">
          {/* Plain button — nesting <Link> inside <Link> generates invalid HTML
              and produces a React warning. We route programmatically instead. */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/litho/creator/${listing.creator_id}`);
            }}
            data-testid={`creator-link-${listing.creator_id}`}
            className="font-mono text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors truncate text-left"
          >
            {listing.creator_name}
          </button>
          <span className="font-mono text-[11px] text-zinc-100 font-bold tabular-nums">
            {fmtPrice(listing.price_usd)}
          </span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[9px] text-zinc-600">
          <Layers className="w-2.5 h-2.5" />
          {listing.total_layers} layers
        </div>
      </div>
    </Link>
  );
};
