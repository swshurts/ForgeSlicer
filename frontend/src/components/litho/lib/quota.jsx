import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMyQuota } from "./api";
import { useAuth } from "./auth";

/** Quota context — exposes the current user's download usage state.
 *  Refreshes after each successful download (call refresh() to bump). */
const QuotaContext = createContext({
  quota: null,
  loading: true,
  refresh: () => {},
  showUpgrade: () => {},
  upgradeOpen: false,
  closeUpgrade: () => {},
});

export const QuotaProvider = ({ children }) => {
  const { user } = useAuth();
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getMyQuota();
      setQuota(data);
    } catch {
      setQuota({ tier: "guest", blocked: true, limit: 0, used: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-fetch when sign-in state changes.
  }, [user, refresh]);

  const value = useMemo(
    () => ({
      quota,
      loading,
      refresh,
      showUpgrade: () => setUpgradeOpen(true),
      upgradeOpen,
      closeUpgrade: () => setUpgradeOpen(false),
    }),
    [quota, loading, refresh, upgradeOpen],
  );

  return <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>;
};

export const useQuota = () => useContext(QuotaContext);
