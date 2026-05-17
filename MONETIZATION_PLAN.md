# ForgeSlicer — Monetization & Rollout Discussion
_Discussion summary between Bill (owner) and the engineering agent — Feb 17, 2026_

> **Context**: ForgeSlicer is currently in solo-testing mode. The goal is to grow it into a **self-sustaining, paid user community** ($x/month subscription). This document captures the rollout strategy we discussed so it can be reviewed with family/business partners before committing.

---

## 1. What "Deploy" does on the Emergent platform

### Preview URL (current state)
- URL: `orca-cad-slice.preview.emergentagent.com`
- Auto-updated every time the code changes
- Can go down during deploys / between dev sessions
- Public, but not search-indexed or "production-ready"
- **Cost: Free**

### Production Deploy
- Locks the current code snapshot to a stable production URL
  (e.g., `forgeslicer.com` if a custom domain is purchased, or a permanent emergent subdomain)
- **Independent of the dev preview** — you can keep developing in preview without breaking users
- Small monthly Emergent compute fee (covers backend hosting + database)
- This is the URL real customers connect to

> **Key takeaway**: Deploy is safe. It just *snapshots* the current code.
> You can deploy v1 today, keep iterating in preview, and deploy v2 next week when ready.

---

## 2. Suggested 3-Phase Rollout

### Phase 1 — Closed Beta (this week, free)
- Deploy as-is to lock the URL
- Invite 5–10 trusted users via direct email link
- No login required (same anonymous gallery flow currently used)
- **Goal**: validate the workflow, find bugs, get feedback on what to charge for

### Phase 2 — Open Beta with accounts (2–3 weeks of work)
Add the table-stakes infrastructure for any paid product:
- **User accounts** — email/password OR Google sign-in
- **"My Designs" / "My Components"** tab (private vs public)
- **Author attribution** locked to real account names
- Still free, but now you have user identity and the data to know who's active

### Phase 3 — Monetization (1–2 more weeks)
- **Stripe subscription** with one or two tiers
- **Quotas / limits** on free vs paid features
- **Account management page** (billing, plan switch, cancel)

---

## 3. Subscription Model Options

The goal is **value that's natural to pay for**, not artificial gates.

### Tier A — "Storage & sharing" model (easiest to sell)
- **Free**: 3 saved projects, public gallery only
- **Pro $5–8/mo**: Unlimited projects, private projects, component versioning, history

### Tier B — "Pro tools" model (better margin)
- Free has everything currently shipped
- **Pro $8–12/mo** unlocks: voice commands, multi-material 3MF export, custom printer profiles, project versioning, "Carve Health" diagnostics, advanced patterns (linear/circular array)

### Tier C — "Community + tools" (recommended)
- **Free**: Full CAD + slicer, public gallery, public components — keeps the ecosystem alive and search-indexed for SEO
- **Maker $7/mo**: Private projects, voice commands, advanced patterns
- **Studio $19/mo**: Team workspace, private component packs, branded export, priority CSG (server-side manifold-3d)

> **Why Tier C works**: matches the pattern of Onshape, TinkerCad Pro, and Figma — the **free tier draws the community + content (SEO + viral loop)**, paid tier captures the people who use it daily for real work.

---

## 4. Engineering Path (build order, ~4 working days total)

1. **Deploy what's here** _(1 hour of testing, nothing new to build)_
   → start collecting real-world signal
2. **Emergent Google Auth** _(1 day)_
   → fastest, no password headaches, plays well with email outreach
3. **"My Designs" / "My Components"** _(½ day)_
   → tie existing records to user IDs
4. **Stripe subscription** _(1 day)_
   → Emergent has a Stripe playbook; test key is already in the environment
5. **Feature gating** _(½ day)_
   → one or two paid-only features behind a `user.tier` check
6. **Account page** _(½ day)_
   → view plan, change card, cancel

**Total: roughly 4 working days from current state to a paid product.**

---

## 5. Questions to Decide Before Building

These don't need to be answered tonight — sleep on them, talk them over.

| # | Question | Options |
|---|----------|---------|
| **a** | **Pricing** — what feels right for your audience? | Hobbyist makers usually pay $5–10/mo. Pro shops pay $20–50/mo. |
| **b** | **Auth choice** | Email/password (full control) OR Google sign-in (one click, less friction) |
| **c** | **Hosting / domain** | Custom domain like `forgeslicer.com` OR stay on emergent subdomain initially |
| **d** | **Free-tier generosity** | How much to give away to keep the community + SEO loop spinning? |

---

## 6. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| No one wants to pay → community dies | Tier C structure keeps free tier valuable forever; only people getting *real* daily use need to upgrade |
| Stripe / billing complexity | Emergent Stripe playbook handles 90% of it; subscriptions are simpler than one-time payments |
| Hosting costs exceed revenue early | Emergent compute is metered; small user base = small bill. Watch the dashboard. |
| Beta users churn before paid launch | Phase-1 outreach is personal email to people who already want this — high conversion vs cold marketing |
| Competing tools (Tinkercad, Onshape) | Different niche: ForgeSlicer is **CAD + slicer in one**, tuned for 3D-printable panel work. Tinkercad has no slicer; Onshape is overkill for hobbyists. |

---

## 7. Already-Shipped Foundation (paid-ready features)

These already exist in the codebase and can be paywalled or used as differentiators:

- 3D primitives + 2D shapes with extrude
- Boolean CSG (union, subtract, intersect) — Web Worker offloaded
- Multi-select, marquee box-select, grouping/ungrouping
- Right-click context menu with full action set
- STL / 3MF / GCODE export with multi-color support
- STL Preview before download
- Component Library (positive/negative parts, categories, tags)
- Public Designs Gallery with Remix support
- Community printer profiles
- **Voice commands powered by GPT-5.2** (ready-made "wow" demo for prospects)
- Keyboard shortcuts (G/R/S/M/Delete/Ctrl+D/Esc/Ctrl+Z/Y)
- Auto-drop to bed, drop-on-rotate, diameter labels
- Comprehensive test plan in `/app/TEST_PLAN.md`

---

## 8. Next Steps Checklist

- [ ] Review this document with family / business partners
- [ ] Decide pricing tier model (A, B, or C)
- [ ] Decide auth method (email/password vs Google)
- [ ] Decide domain (custom vs emergent subdomain)
- [ ] Greenlight Phase 1 deploy → engineering agent locks the URL and adds beta-tester invite flow
- [ ] Compile beta-tester invite list

---

_End of monetization discussion — printable._
_Generated Feb 17, 2026 during ForgeSlicer dev session._
