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
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import SplashScreen from "@/components/SplashScreen";

// Detect the OAuth fragment SYNCHRONOUSLY during render so AuthCallback runs
// before any /api/auth/me race from a global provider would 401. We read
// `window.location.hash` directly (not React Router's `useLocation().hash`)
// because the latter is sometimes stripped by the router on first mount.
function AppRouter() {
  const location = useLocation();
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

  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster richColors closeButton position="top-center" />
          <SplashScreen />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
