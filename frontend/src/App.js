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
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { shouldShowThemeHint, markThemeHintSeen, useTheme } from "@/lib/theme";
import SplashScreen from "@/components/SplashScreen";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import SVGImportDialog from "@/components/SVGImportDialog";
import ZipImportDialog from "@/components/dialogs/ZipImportDialog";

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
          <ProtectedRoute label="the workspace"><Workspace /></ProtectedRoute>
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
          <Toaster richColors closeButton position="top-right" />
          <SplashScreen />
          <ReleaseNotesDialog />
          <SVGImportDialog />
          <ZipImportDialog />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
