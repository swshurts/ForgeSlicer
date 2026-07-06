import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Trash2, RotateCcw, Store } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PublishDialog } from "./PublishDialog";

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
};

export const JobHistory = ({ onRestore }) => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [publishingJobId, setPublishingJobId] = useState(null);
  // We don't store full listing details per tile to keep the network
  // cost low; we only flag "is this job already listed?" via a derived
  // map kept locally after publish/unpublish.
  const [listedMap, setListedMap] = useState({});

  const refresh = useCallback(async () => {
    if (!user) {
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/my-jobs", { withCredentials: true });
      setJobs(data);
      setError(null);
    } catch {
      setError("Could not load your history");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Hook for parent to nudge a refresh after a new generate.
  useEffect(() => {
    if (!user) return;
    const handler = () => refresh();
    window.addEventListener("lithoforge:job-finished", handler);
    return () => window.removeEventListener("lithoforge:job-finished", handler);
  }, [user, refresh]);

  const handleDelete = async (jobId) => {
    try {
      await api.delete(`/my-jobs/${jobId}`, { withCredentials: true });
      setJobs((cur) => cur.filter((j) => j.job_id !== jobId));
      toast.success("Removed from history");
    } catch {
      toast.error("Could not delete");
    }
  };

  const handleRestore = async (jobId) => {
    try {
      const { data } = await api.get(`/my-jobs/${jobId}`, {
        withCredentials: true,
      });
      onRestore && onRestore(data);
      toast.success(`Restored · ${data.name}`);
    } catch {
      toast.error("Could not restore job");
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-2" data-testid="job-history">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          My Jobs
          <span className="text-zinc-700 normal-case tracking-normal">
            ({jobs.length})
          </span>
        </div>
      </div>

      {loading && (
        <div className="font-mono text-[10px] text-zinc-600 py-2">Loading…</div>
      )}

      {error && (
        <div className="font-mono text-[10px] text-red-400 py-2">{error}</div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="font-mono text-[10px] text-zinc-600 py-2 leading-relaxed">
          Generate a lithophane while signed in and it lands here for
          future re-export.
        </div>
      )}

      {jobs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {jobs.map((j) => {
            const isListed =
              listedMap[j.job_id] !== undefined ? listedMap[j.job_id] : j.listed;
            return (
              <div
                key={j.job_id}
                data-testid={`job-${j.job_id}`}
                className="group relative border border-zinc-800 hover:border-zinc-500 transition-colors"
              >
                <button
                  onClick={() => handleRestore(j.job_id)}
                  className="block w-full"
                  data-testid={`restore-${j.job_id}`}
                >
                  {j.thumbnail_base64 ? (
                    <img
                      src={`data:image/png;base64,${j.thumbnail_base64}`}
                      alt={j.name}
                      className="w-full aspect-square object-cover block"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full aspect-square bg-zinc-900" />
                  )}
                  <div className="px-1.5 py-1 border-t border-zinc-800 bg-zinc-950">
                    <div className="font-mono text-[9px] text-zinc-300 truncate">
                      {fmtDate(j.created_at)}
                    </div>
                    <div className="font-mono text-[8px] text-zinc-600 truncate">
                      ΔE {j.delta_e_mean.toFixed(1)} · {j.filament_count}f
                    </div>
                  </div>
                </button>
                {isListed && (
                  <div
                    className="absolute top-1 left-1 inline-flex items-center gap-0.5 bg-emerald-500/90 text-zinc-950 px-1 py-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.12em]"
                    data-testid={`listed-badge-${j.job_id}`}
                  >
                    <Store className="w-2 h-2" strokeWidth={2.5} />
                    Listed
                  </div>
                )}
                <div className="absolute top-1 right-1 flex gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setPublishingJobId(j.job_id)}
                    title={isListed ? "Edit listing" : "Publish to marketplace"}
                    data-testid={`publish-btn-${j.job_id}`}
                    className={`w-5 h-5 flex items-center justify-center bg-black/70 border ${
                      isListed
                        ? "border-emerald-500 text-emerald-300"
                        : "border-zinc-700 text-zinc-200"
                    } hover:bg-emerald-500 hover:text-zinc-950 hover:border-emerald-500`}
                  >
                    <Store className="w-2.5 h-2.5" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => handleRestore(j.job_id)}
                    title="Restore"
                    data-testid={`restore-btn-${j.job_id}`}
                    className="w-5 h-5 flex items-center justify-center bg-black/70 border border-zinc-700 text-zinc-200 hover:bg-zinc-100 hover:text-zinc-950"
                  >
                    <RotateCcw className="w-2.5 h-2.5" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => handleDelete(j.job_id)}
                    title="Delete"
                    data-testid={`delete-btn-${j.job_id}`}
                    className="w-5 h-5 flex items-center justify-center bg-black/70 border border-zinc-700 text-zinc-200 hover:bg-red-600 hover:text-white hover:border-red-600"
                  >
                    <Trash2 className="w-2.5 h-2.5" strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {publishingJobId && (
        <PublishDialog
          jobId={publishingJobId}
          jobName={
            jobs.find((j) => j.job_id === publishingJobId)?.name || ""
          }
          onClose={() => setPublishingJobId(null)}
          onChanged={({ listed }) => {
            setListedMap((m) => ({ ...m, [publishingJobId]: listed }));
          }}
        />
      )}
    </div>
  );
};
