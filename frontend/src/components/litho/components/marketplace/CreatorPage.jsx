import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { ListingCard } from "./ListingCard";
import { getCreatorProfile } from "../../lib/api";

export const CreatorPage = () => {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCreatorProfile(userId);
        if (!cancelled) setProfile(data);
      } catch {
        if (!cancelled) setError("Creator not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div
      className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100"
      data-testid="creator-page"
    >
      <MarketplaceHeader subtitle="Creator" />
      <main className="flex-1 max-w-7xl mx-auto w-full px-5 py-10">
        {loading && (
          <div className="font-mono text-xs text-zinc-500">Loading…</div>
        )}
        {error && (
          <div className="font-mono text-xs text-red-400">{error}</div>
        )}
        {profile && (
          <>
            <div className="flex items-center gap-4 mb-10 pb-6 border-b border-zinc-800">
              {profile.picture ? (
                <img
                  src={profile.picture}
                  alt=""
                  className="w-16 h-16 object-cover border border-zinc-700"
                  draggable={false}
                />
              ) : (
                <div className="w-16 h-16 bg-zinc-100 text-zinc-950 flex items-center justify-center font-display text-2xl font-bold">
                  {(profile.name || "?")[0].toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="font-display text-3xl font-black tracking-tight">
                  {profile.name}
                </h1>
                <div className="font-mono text-[11px] text-zinc-500 mt-1 tracking-wide">
                  {profile.listings.length} listed work
                  {profile.listings.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {profile.listings.length === 0 ? (
              <div className="font-mono text-xs text-zinc-500">
                This creator hasn&apos;t published anything yet.
              </div>
            ) : (
              <div
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
                data-testid="creator-grid"
              >
                {profile.listings.map((l) => (
                  <ListingCard key={l.job_id} listing={l} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
