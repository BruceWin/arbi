import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetSymbol } from '../lib/types';

type FeeSide = {
  taker: number;
  maker: number;
};

type FeeTable = Record<AssetSymbol, FeeSide>;

type WithdrawalFees = Record<AssetSymbol, { luno: number; kraken: number }>;

type SlippageCaps = Record<AssetSymbol, number>;

type Profiles = Record<
  'Conservative' | 'Realistic' | 'Aggressive',
  { slippageMultiplier: number; withdrawalAmortization: boolean }
>;

export type LocalSettings = {
  historyHours: number;
  autoRefreshMs: number;
  fees: {
    luno: FeeTable;
    kraken: FeeTable;
  };
  withdrawalFees: WithdrawalFees;
  slippageCaps: SlippageCaps;
  balances: { lunoZAR: number; krakenGBP: number };
  withdrawalAmortization: boolean;
  profile: keyof Profiles;
};

const STORAGE_KEY = 'svc-arbi-dash::settings';

const DEFAULT_SETTINGS: LocalSettings = {
  historyHours: 24,
  autoRefreshMs: 60_000,
  fees: {
    luno: {
      USDT: { taker: 0.2, maker: -0.01 },
      ETH: { taker: 0.6, maker: 0.4 },
      BTC: { taker: 0.6, maker: 0.4 }
    },
    kraken: {
      USDT: { taker: 0.2, maker: 0.2 },
      ETH: { taker: 0.4, maker: 0.25 },
      BTC: { taker: 0.4, maker: 0.25 }
    }
  },
  withdrawalFees: {
    BTC: { luno: 0.00006, kraken: 0.0002 },
    ETH: { luno: 0.003, kraken: 0.003 },
    USDT: { luno: 15, kraken: 15 }
  },
  slippageCaps: {
    ETH: 0.1,
    BTC: 0.1,
    USDT: 0.05
  },
  balances: { lunoZAR: 100_000, krakenGBP: 5_000 },
  withdrawalAmortization: false,
  profile: 'Realistic'
};

const PROFILES: Profiles = {
  Conservative: { slippageMultiplier: 1.5, withdrawalAmortization: true },
  Realistic: { slippageMultiplier: 1, withdrawalAmortization: false },
  Aggressive: { slippageMultiplier: 0.7, withdrawalAmortization: false }
};

export function useLocalSettings() {
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LocalSettings;
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch (err) {
      console.warn('Failed to load settings', err);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('Failed to persist settings', err);
    }
  }, [settings]);

  const update = useCallback(
    (patch: Partial<LocalSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const applyProfile = useCallback(
    (profile: keyof Profiles) => {
      const profileConfig = PROFILES[profile];
      setSettings((prev) => ({
        ...prev,
        profile,
        withdrawalAmortization: profileConfig.withdrawalAmortization,
        slippageCaps: Object.fromEntries(
          Object.entries(prev.slippageCaps).map(([asset, value]) => [asset, value * profileConfig.slippageMultiplier])
        ) as SlippageCaps
      }));
    },
    []
  );

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const exportProfile = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'svc-arbi-dash-settings.json';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [settings]);

  const importProfile = useCallback(async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<LocalSettings>;
    setSettings((prev) => ({ ...prev, ...parsed }));
  }, []);

  return useMemo(
    () => ({ settings, setSettings, update, reset, applyProfile, exportProfile, importProfile, profiles: PROFILES }),
    [settings, update, reset, applyProfile, exportProfile, importProfile]
  );
}
