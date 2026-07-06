import "@/App.css";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Landing from "@/components/Landing";
import Workspace from "@/components/Workspace";
import Gallery from "@/components/Gallery";
import Profile from "@/components/Profile";
import AuthCallback from "@/components/AuthCallback";
import ProtectedRoute from "@/components/ProtectedRoute";
import SignIn from "@/components/SignIn";
import ForgotPassword from "@/components/ForgotPassword";
import ResetPassword from "@/components/ResetPassword";
import MagicLinkLanding from "@/components/MagicLinkLanding";
import AuthorProfile from "@/components/AuthorProfile";
import AdminPage from "@/components/AdminPage";
import PricingPage from "@/components/PricingPage";
import BillingSuccessPage from "@/components/BillingSuccessPage";
import LithoStudio from "@/components/litho/LithoStudio";
import { MarketplacePage } from "@/components/litho/components/marketplace/MarketplacePage";
import { ListingDetailPage } from "@/components/litho/components/marketplace/ListingDetailPage";
import { CreatorPage } from "@/components/litho/components/marketplace/CreatorPage";
import { PayoutsPage } from "@/components/litho/components/marketplace/PayoutsPage";
import { PurchaseSuccessPage } from "@/components/litho/components/marketplace/PurchaseSuccessPage";
import Handoff from "@/components/Handoff";
import Learn from "@/components/Learn";
import SEOLanding from "@/components/SEOLanding";
import { SEO_LANDING_SLUGS } from "@/seo/landings";
import Trust from "@/components/Trust";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { shouldShowThemeHint, markThemeHintSeen, useTheme } from "@/lib/theme";
import SplashScreen from "@/components/SplashScreen";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import SVGImportDialog from "@/components/SVGImportDialog";
import ZipImportDialog from "@/components/dialogs/ZipImportDialog";
import SuggestProfileDialog from "@/components/dialogs/SuggestProfileDialog";

// Detect the OAuth fragment SYNCHRONOUSLY during render so AuthCallback runs
// before any /api/auth/me race from a global provider would 401. We read
// `window.location.hash` directly (not React Router's `useLocation().hash`)
// because the latter is sometimes stripped by the router on first mount.
function AppRouter() {
  const location = useLocation();
  // Notify the theme store of every route change so per-route mode
  // can re-apply the right theme without a full reload.
  const setThemeRoute = useTheme((s) => s.setRoute);
  useEffect(() => {
    setThemeRoute(location.pathname);
  }, [location.pathname, setThemeRoute]);

  const rawHash = (typeof window !== "undefined" && window.location.hash) || location.hash || "";
  if (rawHash.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/gallery" element={<Gallery />} />
      <Route path="/learn" element={<Learn />} />
      <Route path="/learn/:slug" element={<Learn />} />
      {/* ─── Dedicated SEO landing pages ─────────────────────────
          Eight focused pages targeting high-intent search terms.
          All eight share the SEOLanding component, which reads its
          content from src/seo/landings.js by the :slug param. The
          /:slug-style routes are explicit (not a wildcard) so the
          router doesn't accidentally swallow future top-level URLs
          like /pricing or /blog. */}
      {SEO_LANDING_SLUGS.map((slug) => (
        <Route key={slug} path={`/${slug}`} element={<SEOLanding routeSlug={slug} />} />
      ))}
      {/* ─── Trust & transparency ──────────────────────────────
          One hub + four dedicated routes share a single component
          driven by the `view` prop. Each route adds its own meta
          via useDocumentMeta so the SEO snippets are unique. */}
      <Route path="/trust" element={<Trust view="hub" />} />
      <Route path="/privacy" element={<Trust view="privacy" />} />
      <Route path="/changelog" element={<Trust view="changelog" />} />
      <Route path="/roadmap" element={<Trust view="roadmap" />} />
      <Route path="/browser-support" element={<Trust view="browser-support" />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/magic-link" element={<MagicLinkLanding />} />
      <Route path="/u/:userId" element={<AuthorProfile />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/billing/success" element={<BillingSuccessPage />} />
      <Route
        path="/workspace"
        element={
          <ProtectedRoute label="the workspace" allowGuestFromHandoff><Workspace /></ProtectedRoute>
        }
      />
      <Route path="/handoff" element={<Handoff />} />
      <Route
        path="/litho"
        element={
          <ProtectedRoute label="Lithophane Studio"><LithoStudio /></ProtectedRoute>
        }
      />
      {/* Lithophane marketplace — Phase 2 of the LithoForge merge.
          Browsing is public; purchase/publish is gated behind sign-in
          inside the specific pages (client-token + checkout require it). */}
      <Route path="/litho/marketplace" element={<MarketplacePage />} />
      <Route path="/litho/marketplace/:jobId" element={<ListingDetailPage />} />
      <Route path="/litho/marketplace/:jobId/success" element={<PurchaseSuccessPage />} />
      <Route path="/litho/creator/:userId" element={<CreatorPage />} />
      <Route
        path="/litho/payouts"
        element={
          <ProtectedRoute label="Payouts"><PayoutsPage /></ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute label="your profile"><Profile /></ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  // Best-effort browser protocol registration so users can paste a
  // `web+forgeslicer://remix/<gallery_id>` link from anywhere on the web
  // and have the browser route it to ForgeSlicer. Browsers REQUIRE the
  // `web+` prefix for non-native protocols; the raw `forgeslicer://`
  // scheme would need a native installer to register. We register once
  // per visit — the browser dedupes and prompts the user the first time.
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.registerProtocolHandler) return;
    try {
      navigator.registerProtocolHandler(
        "web+forgeslicer",
        `${window.location.origin}/workspace?remix=%s`,
      );
    } catch (err) {
      // Some browsers throw if the user already registered + revoked it;
      // we just swallow — this is a nice-to-have, not critical UX.
      void err;
    }
  }, []);

  // One-time "Auto theme is on" hint for brand-new visitors. Fires once
  // ever (gated by localStorage), only when the user has no stored
  // theme choice. We delay a couple of seconds so it doesn't compete
  // with the splash screen or any post-auth redirect.
  useEffect(() => {
    if (!shouldShowThemeHint()) return;
    const t = setTimeout(() => {
      if (!shouldShowThemeHint()) return; // double-check after the delay
      toast.info("Auto theme is on", {
        description: "We're following your system appearance. Tap the sun/moon icons in the toolbar to override.",
        duration: 8000,
        action: {
          label: "Got it",
          onClick: () => markThemeHintSeen(),
        },
        onDismiss: markThemeHintSeen,
        onAutoClose: markThemeHintSeen,
      });
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          {/* iter-88: top-right position avoids overlapping the
              admin tab strip (testing agent reported the older
              top-center toast intercepted clicks even when it didn't
              visually overlap, since sonner sets pointer-events:auto
              on the surrounding viewport). */}
          <Toaster richColors closeButton position="top-center" />
          <SplashScreen />
          <ReleaseNotesDialog />
          <SVGImportDialog />
          <ZipImportDialog />
          <SuggestProfileDialog />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
