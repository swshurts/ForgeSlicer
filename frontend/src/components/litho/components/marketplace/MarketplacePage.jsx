import React, { useEffect, useState } from "react";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { ListingCard } from "./ListingCard";
import { browseMarketplace } from "../../lib/api";

export const MarketplacePage = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await browseMarketplace();
        if (!cancelled) setListings(data);
      } catch {
        if (!cancelled) setError("Couldn't load the marketplace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100"
      data-testid="marketplace-page"
    >
      <MarketplaceHeader />
      <main className="flex-1 max-w-7xl mx-auto w-full px-5 py-10">
        <div className="mb-8">
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight">
            Lithophane Marketplace
          </h1>
          <div className="font-mono text-xs text-zinc-500 mt-2 tracking-wide">
            Browse work by creators using ForgeSlicer Lithophane Studio · purchase directly
            from the artist
          </div>
        </div>

        {loading && (
          <div
            className="font-mono text-xs text-zinc-500"
            data-testid="marketplace-loading"
          >
            Loading…
          </div>
        )}

        {error && (
          <div className="font-mono text-xs text-red-400">{error}</div>
        )}

        {!loading && !error && listings.length === 0 && (
          <div className="border border-zinc-800 p-12 text-center" data-testid="marketplace-empty">
            <div className="font-display text-xl text-zinc-300 mb-2">
              No works listed yet
            </div>
            <div className="font-mono text-[11px] text-zinc-500 leading-relaxed max-w-md mx-auto">
              The marketplace is brand new. Generate a lithophane in the
              studio while signed in, then click <span className="text-zinc-100">Publish</span> on
              your job to make it visible here.
            </div>
          </div>
        )}

        {listings.length > 0 && (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
            data-testid="marketplace-grid"
          >
            {listings.map((l) => (
              <ListingCard key={l.job_id} listing={l} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
