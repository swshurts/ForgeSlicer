# ForgeSlicer Pricing Research (Feb 2026)

This is desk research — not a final recommendation — synthesizing pricing
patterns from comparable browser-CAD tools, 3D-model marketplaces and indie
SaaS benchmarks. Use it as a starting point when we revisit Phase 3 (Stripe
monetization).

---

## 1. Direct competitors (browser-CAD / hobbyist modeling)

| Tool                  | Free tier                                    | First paid tier              | Pro/upper tier            | Notes                                                                                                              |
|-----------------------|----------------------------------------------|------------------------------|---------------------------|--------------------------------------------------------------------------------------------------------------------|
| **Tinkercad**         | Completely free                              | —                            | —                         | Owned by Autodesk; subsidized as a top-of-funnel for Fusion 360.                                                   |
| **Onshape**           | Free **but designs are public**              | Standard ≈ **$1,500/yr**     | Pro ≈ $2,100–$2,500/yr    | Pricing aimed at SMB/enterprise. Free hobbyists tolerate public projects.                                          |
| **Fusion 360 Personal** | Free for non-commercial users earning <$1,000/yr | Subscription ≈ **$70–$85/mo** | n/a                      | Free tier limited (no rendering credits, 10 active files). Single most-cited "cheap real CAD" for hobbyists.       |
| **SelfCAD**           | Free trial                                   | ≈ **$15/mo** Hobby           | ≈ $20–25/mo Pro           | Browser-based; closest direct competitor in feature set.                                                           |
| **3D Slash**          | Free with watermark                          | ≈ **$2/mo** Edu              | ≈ $8/mo Premium           | Reference for the lowest viable price point.                                                                       |

**Read:** ForgeSlicer is competing with Tinkercad on the free tier and SelfCAD/3D Slash on paid tiers. Fusion 360 is too expensive and too far up-market to anchor against.

---

## 2. 3D model marketplaces (gallery / community parallels)

| Platform        | Free behaviour                              | Creator subscription levels                                              | Platform take             |
|-----------------|---------------------------------------------|--------------------------------------------------------------------------|----------------------------|
| **Thangs**      | Browse + download (mostly free)             | Creator memberships ≈ **$10/mo** (basic) → **$25/mo** (resale-friendly); Thangs Bundle ≈ **$14.99/mo** | ~10% on creator subs       |
| **Printables**  | Browse + download free                      | "Clubs" subscriptions per creator, often **$2–$10/mo**; some include commercial license | Free for users; creators monetize directly |
| **MakerWorld**  | Browse + download free                      | Commercial-licence memberships, **$3–$300/mo** (creator-set)             | Creator-set; some examples around $29/mo |

**Read:** Hobbyist 3D-print users are price-anchored at **$3–$15/mo** for content/access; **$25/mo+** is the perceived line for commercial use.

---

## 3. Indie SaaS benchmarks (2025)

- **Freemium → paid conversion**: industry average ≈ **1 %**; solid SaaS ≈ **2–5 %**; AI-native ≈ **6–8 %** "good" / **15–20 %** "great".
- **Free-trial → paid conversion**: **4–6 %** good, **10–15 %** great. Credit-card-required trials hit ~30 % but suppress signups ~50 %.
- **Common indie ladder**:
  - Free tier
  - Starter: **$5–$10/mo**
  - Mid/Pro: **$19–$29/mo**
  - Annual = ~10× monthly (≈ 2 months free) is conventional.
- **Rule of thumb**: price ≈ **10 %** of monetary value delivered.

---

## 4. Cost-coverage floor (rough)

Approximate monthly variable cost per active user, assuming current architecture:
- Container hosting on Emergent/preview infra: **~$0** for early users (idle).
- MongoDB Atlas free tier: 0–5,000 users / 512 MB storage.
- Emergent LLM key for voice commands (GPT-5.2): **~$0.001 per command** — call it **$0.05/active user/mo** at 50 commands.
- Egress on STL/3MF blobs: **~$0.01/user/mo** at 1 MB avg downloads.
- Stripe processing: **2.9 % + $0.30 per charge** = $0.45 on a $5 charge (9 %), $0.59 on a $10 charge (5.9 %).

**Floor**: hosting + infra costs are ~$0.10/active user/mo today; the breakeven price is dominated by Stripe processing. **$5/mo is breakeven-comfortable; $2/mo is breakeven-tight after Stripe fees.**

---

## 5. Proposed tier draft (NOT FINAL — for discussion)

> User's stated direction: Free with usage caps · ~$2/mo for gallery access · ~$7/mo unlimited. The draft below leans toward those numbers but raises Hobbyist a notch to ensure margin survives Stripe fees.

| Tier         | Price          | Caps / inclusions                                                                                                                       | Why this number                                                                                              |
|--------------|----------------|------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| **Free**     | $0             | 3 saved designs / week · 1 private design max · public gallery browsing & download · Voice commands capped at 20/wk · Watermark in 3MF? | Generous enough to convert; usage cap is the upgrade trigger.                                                |
| **Hobbyist** | **$3/mo** or **$30/yr** | Unlimited saves · 10 private designs · 5 private components · 100 voice commands/wk · Higher-res thumbnails                                | Lands inside the $2–$5 "anchor" Printables/Thangs users already pay; clears Stripe processing comfortably.   |
| **Maker Pro** | **$7/mo** or **$70/yr** | Everything in Hobbyist · **Unlimited** private library · Unlimited voice · Verified-creator badge · Future: AMS color-aware slicer · Priority support | Matches the user's $7/mo target; aligns with SelfCAD/3D Slash Premium tier and Thangs basic creator membership. |
| **Studio**   | **$19/mo** *(future)* | Multi-user accounts · Custom branding on shared galleries · Bulk component imports · Team library                                        | Future-proofing for a Phase-4 small-business tier; not part of MVP launch.                                   |

**Key levers**:
- **Annual discount**: Pricing at 10× monthly = $30/yr / $70/yr gives users a clear reason to commit and lifts ARPU.
- **First-month token**: Optional $1 first-month promo for the Hobbyist tier as a conversion accelerator (Stripe Coupons).
- **No trial period for paid tiers**: Free is already the trial. Saves Stripe complexity.

---

## 6. Recommendation

1. **Hold price at $3 / $7** for the Hobbyist / Pro tiers. $2 is too thin after Stripe fees on a $2 charge (~26 %); $3 keeps the perceived-cheap signal while making the math work.
2. **Lead the upgrade prompt on usage caps, not features.** Hobbyist-3D users respond to "you've used 3 of 3 saves this week" much better than to feature-gating.
3. **Don't introduce paid tiers until ~50 monthly active users**. Below that the free-tier word-of-mouth growth matters more than the revenue.
4. **Skip ad-supported model** — the audience (makers, engineers) is anti-ad and ad CPMs for niche tools are < $1.
5. **Re-price annually** based on the actual ratio of cost-per-MAU to MRR.

---

## 7. Open questions for the user (capture before Phase 3 build)

- Are we OK with **watermarking** the 3MF metadata on free-tier exports? (e.g. `forgeslicer:tier="free"`)
- Should **voice commands** be a paid feature or a usage-capped freebie?
- Do we want to allow **gifting subscriptions** (creator → fan)?
- Should the **Verified** badge be limited to paid tiers or also available to high-reputation free users?

---

### Sources
- All3DP, Xometry, Autodesk, Onshape, SaaSFactor, Freemius "State of Micro-SaaS 2025", ChartMogul SaaS Conversion Report, RevenueCat "State of Subscription Apps 2025", Bambu Lab community forum (commercial-licence pricing).
