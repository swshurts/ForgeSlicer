/**
 * CoopProjectsPage — home for Cooperative Projects (iter-151.10).
 *
 * Two views:
 *   • List view (default): all projects the signed-in user owns OR is
 *     a member of, plus a "Discover" pane of public projects.
 *   • Detail view (`?slug=xxxxxxx`): full project screen with tabs for
 *     Overview, Members, Proposals.
 *
 * The proposal-based edit flow (creator approval) works like this:
 *   - Owner can Load the committed scene into the workspace.
 *   - Members open a project → Load Scene → make edits in workspace →
 *     "Submit changes" — this posts a scene snapshot to /proposals.
 *   - Owner opens the project → Proposals tab → Accept or Reject.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Users, Plus, Loader2, Trash2, Send, Check, X, UserPlus,
  Globe, Lock, ArrowRight, MessageSquare, Copy, Package,
} from "lucide-react";
import { coopProjectsApi } from "../lib/api";
import { useScene } from "../lib/store";
import { useAuth } from "../contexts/AuthContext";
import { serializeProject, loadProjectState } from "../lib/projectIO";

export default function CoopProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const activeSlug = params.get("slug");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-3" data-testid="coop-signin-gate">
        <Users size={48} className="text-purple-400" />
        <div className="text-2xl font-bold">Sign in to use Cooperative Projects</div>
        <Link to="/signin?next=/coop" className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-semibold">
          Sign in
        </Link>
      </div>
    );
  }
  return activeSlug ? <ProjectDetail slug={activeSlug} me={user} /> : <ProjectList me={user} />;
}

// ---------- List view ----------
function ProjectList({ me }) {
  const navigate = useNavigate();
  const [mine, setMine] = useState([]);
  const [pub, setPub] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("private");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        coopProjectsApi.listMine(),
        coopProjectsApi.listPublic(30),
      ]);
      setMine(m || []);
      setPub(p || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("coop list failed:", err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const create = async () => {
    if (!name.trim()) { toast.error("Give the project a name"); return; }
    setCreating(true);
    try {
      const created = await coopProjectsApi.create({
        name: name.trim(), description: description.trim(),
        visibility, scene: { objects: [] },
      });
      toast.success("Project created");
      setName(""); setDescription("");
      navigate(`/coop?slug=${created.slug}`);
    } catch (err) {
      toast.error(`Create failed: ${err?.response?.data?.detail || err.message}`);
    } finally { setCreating(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-10 px-4">
      <div className="max-w-4xl mx-auto" data-testid="coop-projects-page">
        <div className="flex items-center gap-2 mb-6">
          <Users className="text-purple-400" size={22} />
          <h1 className="text-3xl font-bold text-white">Cooperative Projects</h1>
        </div>

        {/* Create panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-8">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1">
            <Plus size={12} /> New Project
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              data-testid="coop-new-name"
              type="text"
              placeholder="Project name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
            />
            <input
              data-testid="coop-new-desc"
              type="text"
              placeholder="Description (optional)"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
            />
            <select
              data-testid="coop-new-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="h-9 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
            >
              <option value="private">🔒 Private — invite only</option>
              <option value="public">🌍 Public — join by approval</option>
            </select>
          </div>
          <button
            data-testid="coop-new-create-btn"
            onClick={create}
            disabled={creating || !name.trim()}
            className="mt-3 h-9 px-4 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Create project
          </button>
        </div>

        {/* Mine */}
        <div className="mb-8">
          <div className="text-sm font-semibold text-slate-300 mb-2">My projects ({mine.length})</div>
          {loading && <Loader2 size={14} className="animate-spin text-slate-500" />}
          {!loading && mine.length === 0 && (
            <div className="text-sm text-slate-500 italic">No cooperative projects yet.</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mine.map((p) => (
              <ProjectCard key={p.slug} p={p} me={me} />
            ))}
          </div>
        </div>

        {/* Discover */}
        <div>
          <div className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1">
            <Globe size={13} /> Discover public projects
          </div>
          {pub.length === 0 && (
            <div className="text-sm text-slate-500 italic">No public projects yet.</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pub.map((p) => (
              <ProjectCard key={p.slug} p={p} me={me} public />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ p, me, public: isPublic }) {
  const isOwner = p.owner_id === me?.user_id;
  return (
    <Link
      to={`/coop?slug=${p.slug}`}
      data-testid={`coop-card-${p.slug}`}
      className="block bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 rounded-lg p-3 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        {p.visibility === "public" ? <Globe size={12} className="text-emerald-400" /> : <Lock size={12} className="text-amber-400" />}
        <span className="text-sm font-semibold text-slate-100 truncate">{p.name}</span>
        {isOwner && <span className="text-[9px] uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Owner</span>}
      </div>
      {p.description && <div className="text-xs text-slate-400 leading-snug line-clamp-2 mb-2">{p.description}</div>}
      <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between">
        <span>{p.owner_name}</span>
        <span>v{p.scene_version || 1} · {(p.members || []).length} member{(p.members || []).length === 1 ? "" : "s"}</span>
      </div>
    </Link>
  );
}

// ---------- Detail view ----------
function ProjectDetail({ slug, me }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await coopProjectsApi.get(slug);
      setProject(p);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    } finally { setLoading(false); }
  }, [slug]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>;
  }
  if (error || !project) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-3">
        <div className="text-2xl font-semibold text-red-400">Can't open project</div>
        <div className="text-sm text-slate-400">{error}</div>
        <Link to="/coop" className="text-purple-400 hover:text-purple-300 underline">← All projects</Link>
      </div>
    );
  }

  const isOwner = project.viewer_role === "owner";
  const isMember = project.viewer_role === "member";
  const isPending = project.viewer_role === "pending";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-10 px-4">
      <div className="max-w-4xl mx-auto" data-testid={`coop-detail-${slug}`}>
        <Link to="/coop" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">← All projects</Link>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {project.visibility === "public" ? <Globe size={16} className="text-emerald-400" /> : <Lock size={16} className="text-amber-400" />}
              <h1 className="text-3xl font-bold text-white" data-testid="coop-project-name">{project.name}</h1>
            </div>
            <div className="text-sm text-slate-400">by <span className="text-slate-200 font-semibold">{project.owner_name}</span> · v{project.scene_version || 1}</div>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && <span className="text-[10px] uppercase bg-purple-500/20 text-purple-300 px-2 py-1 rounded font-bold tracking-wider">Owner</span>}
            {isMember && <span className="text-[10px] uppercase bg-sky-500/20 text-sky-300 px-2 py-1 rounded font-bold tracking-wider">Member</span>}
            {isPending && <span className="text-[10px] uppercase bg-amber-500/20 text-amber-300 px-2 py-1 rounded font-bold tracking-wider">Pending</span>}
          </div>
        </div>
        {project.description && <p className="text-slate-300 mb-4">{project.description}</p>}

        {/* Public-project pending state */}
        {!isOwner && !isMember && !isPending && project.visibility === "public" && (
          <button
            data-testid="coop-request-join-btn"
            onClick={async () => {
              try { await coopProjectsApi.requestJoin(slug); toast.success("Join request sent"); reload(); }
              catch (err) { toast.error(`${err?.response?.data?.detail || err.message}`); }
            }}
            className="mb-6 h-9 px-4 bg-sky-600 hover:bg-sky-500 rounded text-white text-sm font-semibold flex items-center gap-2"
          >
            <UserPlus size={13} /> Request to join
          </button>
        )}
        {isPending && <div className="mb-6 text-amber-300 text-sm">Your join request is awaiting the owner's approval.</div>}

        {/* Tabs */}
        <div className="border-b border-slate-800 mb-4 flex gap-4">
          {[
            ["overview", "Overview"],
            ["members", `Members (${(project.members || []).length + 1})`],
            ["proposals", "Proposals"],
          ].map(([id, label]) => (
            <button
              key={id}
              data-testid={`coop-tab-${id}`}
              onClick={() => setTab(id)}
              className={`pb-2 text-sm font-semibold ${tab === id ? "text-purple-400 border-b-2 border-purple-500" : "text-slate-400 hover:text-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab project={project} isOwner={isOwner} isMember={isMember} onChange={reload} />}
        {tab === "members" && <MembersTab project={project} isOwner={isOwner} onChange={reload} />}
        {tab === "proposals" && <ProposalsTab project={project} isOwner={isOwner} isMember={isMember} me={me} onChange={reload} />}
      </div>
    </div>
  );
}

// ---------- Overview tab ----------
function OverviewTab({ project, isOwner, isMember, onChange }) {
  const navigate = useNavigate();
  const objects = useScene((s) => s.objects);
  const activePlateId = useScene((s) => s.activePlateId);
  const plates = useScene((s) => s.plates);

  const objectsCount = (project.scene?.objects || []).length;

  const loadIntoWorkspace = () => {
    // Blindly load the committed scene into the local scene store.
    // Uses the same `loadProjectState` helper that "Open project" uses.
    try {
      const patch = loadProjectState(project.scene);
      useScene.setState(patch);
      toast.success(`Loaded "${project.name}" into workspace`);
      navigate("/workspace");
    } catch (err) {
      toast.error(`Load failed: ${err.message}`);
    }
  };

  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submitProposal = async () => {
    if (!title.trim()) { toast.error("Give your change a title"); return; }
    setSubmitting(true);
    try {
      const snapshot = serializeProject({ objects, plates, activePlateId });
      await coopProjectsApi.createProposal(project.slug, {
        title: title.trim(),
        description: description.trim(),
        scene: snapshot,
      });
      toast.success("Proposal submitted for review");
      setTitle(""); setDescription("");
      onChange();
    } catch (err) {
      toast.error(`${err?.response?.data?.detail || err.message}`);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Committed Scene</div>
        <div className="text-sm text-slate-200 mb-3">
          <span className="font-mono">{objectsCount}</span> object{objectsCount === 1 ? "" : "s"} · version <span className="font-mono">{project.scene_version || 1}</span>
        </div>
        {(isOwner || isMember) && (
          <button
            data-testid="coop-load-scene-btn"
            onClick={loadIntoWorkspace}
            className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold flex items-center gap-2"
          >
            <ArrowRight size={13} /> Load into workspace
          </button>
        )}
      </div>

      {(isOwner || isMember) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
            <Send size={11} /> Propose changes from the workspace
          </div>
          <div className="text-xs text-slate-400 mb-3 leading-snug">
            Edit the workspace, then come back here to submit a snapshot. The owner reviews and Accepts or Rejects.
          </div>
          <div className="flex flex-col gap-2">
            <input
              data-testid="coop-proposal-title"
              type="text"
              maxLength={120}
              placeholder="Proposal title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
            />
            <textarea
              data-testid="coop-proposal-desc"
              rows={2}
              maxLength={2000}
              placeholder="What did you change and why?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none resize-none"
            />
            <button
              data-testid="coop-submit-proposal-btn"
              onClick={submitProposal}
              disabled={submitting || !title.trim()}
              className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Submit for review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Members tab ----------
function MembersTab({ project, isOwner, onChange }) {
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const result = await coopProjectsApi.invite(project.slug, email.trim());
      toast.success(result.already_member ? "Already a member" : `Added ${result.name || result.email}`);
      setEmail("");
      onChange();
    } catch (err) {
      toast.error(`${err?.response?.data?.detail || err.message}`);
    } finally { setInviting(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Owner (always first) */}
      <div className="bg-slate-900 border border-slate-800 rounded p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px] font-bold">O</div>
          <span className="text-sm text-slate-100">{project.owner_name}</span>
          <span className="text-[9px] uppercase bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold tracking-wider">Owner</span>
        </div>
      </div>
      {(project.members || []).map((uid) => (
        <div key={uid} className="bg-slate-900 border border-slate-800 rounded p-2 flex items-center justify-between" data-testid={`coop-member-${uid}`}>
          <div className="text-sm text-slate-100 font-mono">{uid}</div>
          {isOwner && (
            <button
              data-testid={`coop-remove-member-${uid}`}
              onClick={async () => {
                if (!window.confirm("Remove this member?")) return;
                try { await coopProjectsApi.removeMember(project.slug, uid); toast.success("Removed"); onChange(); }
                catch (err) { toast.error(`${err?.response?.data?.detail || err.message}`); }
              }}
              className="text-slate-500 hover:text-red-400 p-1"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}

      {/* Pending requests (public projects) */}
      {isOwner && (project.pending_requests || []).length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Pending Join Requests</div>
          {(project.pending_requests || []).map((uid) => (
            <div key={uid} className="bg-slate-900 border border-amber-800 rounded p-2 flex items-center justify-between mb-2" data-testid={`coop-pending-${uid}`}>
              <span className="text-sm text-slate-100 font-mono">{uid}</span>
              <div className="flex gap-1">
                <button
                  data-testid={`coop-approve-${uid}`}
                  onClick={async () => {
                    try { await coopProjectsApi.approveRequest(project.slug, uid); toast.success("Approved"); onChange(); }
                    catch (err) { toast.error(`${err?.response?.data?.detail || err.message}`); }
                  }}
                  className="h-7 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <Check size={11} /> Approve
                </button>
                <button
                  data-testid={`coop-deny-${uid}`}
                  onClick={async () => {
                    try { await coopProjectsApi.denyRequest(project.slug, uid); toast.success("Denied"); onChange(); }
                    catch (err) { toast.error(`${err?.response?.data?.detail || err.message}`); }
                  }}
                  className="h-7 px-2 rounded bg-slate-700 hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <X size={11} /> Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite by email (private projects — owner only) */}
      {isOwner && (
        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Invite by email</div>
          <div className="flex gap-2">
            <input
              data-testid="coop-invite-email"
              type="email"
              placeholder="collaborator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 h-8 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
            />
            <button
              data-testid="coop-invite-btn"
              onClick={invite}
              disabled={inviting || !email.trim()}
              className="h-8 px-3 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1"
            >
              {inviting ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
              Invite
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-2">Only registered ForgeSlicer users can be invited.</div>
        </div>
      )}
    </div>
  );
}

// ---------- Proposals tab ----------
function ProposalsTab({ project, isOwner, isMember, me, onChange }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setProposals(await coopProjectsApi.listProposals(project.slug) || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("proposals load failed:", err);
    } finally { setLoading(false); }
  }, [project.slug]);

  useEffect(() => { reload(); }, [reload]);

  const decide = async (pid, action) => {
    try {
      const owner_note = (note[pid] || "").trim();
      if (action === "accept") {
        await coopProjectsApi.acceptProposal(project.slug, pid, owner_note);
        toast.success("Accepted · scene updated");
      } else {
        await coopProjectsApi.rejectProposal(project.slug, pid, owner_note);
        toast.success("Rejected");
      }
      reload();
      onChange();
    } catch (err) {
      toast.error(`${err?.response?.data?.detail || err.message}`);
    }
  };

  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Pending ({pending.length})</div>
        {loading && <Loader2 size={14} className="animate-spin text-slate-500" />}
        {!loading && pending.length === 0 && (
          <div className="text-sm text-slate-500 italic">No pending proposals.</div>
        )}
        {pending.map((p) => (
          <div key={p.proposal_id} className="bg-slate-900 border border-amber-800 rounded-lg p-3 mb-3" data-testid={`coop-proposal-${p.proposal_id}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-slate-100">{p.title}</span>
              <span className="text-[10px] text-slate-500 font-mono">{new Date(p.created_at).toLocaleString()}</span>
            </div>
            <div className="text-xs text-slate-400 mb-2">by {p.proposer_name} · {(p.scene?.objects || []).length} objects</div>
            {p.description && <div className="text-sm text-slate-300 leading-snug mb-2">{p.description}</div>}
            {isOwner && (
              <>
                <input
                  data-testid={`coop-owner-note-${p.proposal_id}`}
                  type="text"
                  placeholder="Note back to proposer (optional)"
                  value={note[p.proposal_id] || ""}
                  onChange={(e) => setNote((n) => ({ ...n, [p.proposal_id]: e.target.value }))}
                  className="w-full h-8 px-2 bg-slate-950 border border-slate-700 rounded text-xs focus:border-purple-500 outline-none mb-2"
                />
                <div className="flex gap-2">
                  <button
                    data-testid={`coop-accept-${p.proposal_id}`}
                    onClick={() => decide(p.proposal_id, "accept")}
                    className="h-8 px-3 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Check size={12} /> Accept & commit
                  </button>
                  <button
                    data-testid={`coop-reject-${p.proposal_id}`}
                    onClick={() => decide(p.proposal_id, "reject")}
                    className="h-8 px-3 rounded bg-slate-700 hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <X size={12} /> Reject
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Decided ({decided.length})</div>
        {decided.length === 0 && <div className="text-sm text-slate-500 italic">None yet.</div>}
        {decided.map((p) => (
          <div key={p.proposal_id} className={`bg-slate-900 border rounded-lg p-3 mb-2 ${p.status === "accepted" ? "border-emerald-800" : "border-red-800"}`} data-testid={`coop-decided-${p.proposal_id}`}>
            <div className="flex items-center gap-2 mb-1">
              {p.status === "accepted" ? <Check size={13} className="text-emerald-400" /> : <X size={13} className="text-red-400" />}
              <span className="text-sm font-semibold text-slate-100">{p.title}</span>
              <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${p.status === "accepted" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                {p.status}
              </span>
            </div>
            <div className="text-xs text-slate-400">by {p.proposer_name}</div>
            {p.owner_note && (
              <div className="text-xs text-slate-300 leading-snug mt-2 pl-3 border-l-2 border-purple-500/40 italic">
                <MessageSquare size={10} className="inline mr-1 text-purple-400" />
                {p.owner_note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
