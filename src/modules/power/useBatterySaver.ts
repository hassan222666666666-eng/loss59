import { useEffect, useState } from 'react';
import { BatterySaverMode } from '../../types';
import {
  evaluateBatterySaverActive,
  resolveBatterySaverMode,
} from './batterySaver';

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener: (
    type: 'levelchange' | 'chargingchange',
    listener: () => void
  ) => void;
  removeEventListener: (
    type: 'levelchange' | 'chargingchange',
    listener: () => void
  ) => void;
}

interface NavigatorWithBattery {
  getBattery?: () => Promise<BatteryManagerLike>;
}

export interface BatterySaverState {
  batterySupported: boolean;
  initialBatteryLevel: number | null;
  currentBatteryLevel: number | null;
  charging: boolean | null;
  batterySaverMode: BatterySaverMode;
  isBatterySaverOn: boolean;
}

// Preserves the app-opening battery level across component mounts in the same session
let appOpenBatteryLevel: number | null = null;

export function useBatterySaver(
  configuredMode?: BatterySaverMode
): BatterySaverState {
  const mode = resolveBatterySaverMode(configuredMode);
  const [batterySupported, setBatterySupported] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    return typeof (navigator as NavigatorWithBattery).getBattery === 'function';
  });
  const [initialBatteryLevel, setInitialBatteryLevel] = useState<number | null>(
    appOpenBatteryLevel
  );
  const [currentBatteryLevel, setCurrentBatteryLevel] = useState<number | null>(
    appOpenBatteryLevel
  );
  const [charging, setCharging] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      setBatterySupported(false);
      return;
    }
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      setBatterySupported(false);
      return;
    }

    let cancelled = false;
    let batteryRef: BatteryManagerLike | null = null;

    const syncFromManager = () => {
      if (cancelled || !batteryRef) return;
      const lvl =
        typeof batteryRef.level === 'number' && Number.isFinite(batteryRef.level)
          ? Math.max(0, Math.min(1, batteryRef.level))
          : null;
      const isCharging =
        typeof batteryRef.charging === 'boolean' ? batteryRef.charging : null;

      if (appOpenBatteryLevel === null && lvl !== null) {
        appOpenBatteryLevel = lvl;
      }
      setInitialBatteryLevel(appOpenBatteryLevel ?? lvl);
      setCurrentBatteryLevel(lvl);
      setCharging(isCharging);
    };

    nav
      .getBattery()
      .then((bm) => {
        if (cancelled) return;
        if (!bm || typeof bm.level !== 'number') {
          setBatterySupported(false);
          return;
        }
        batteryRef = bm;
        setBatterySupported(true);
        syncFromManager();
        bm.addEventListener('levelchange', syncFromManager);
        bm.addEventListener('chargingchange', syncFromManager);
      })
      .catch(() => {
        if (!cancelled) {
          setBatterySupported(false);
        }
      });

    return () => {
      cancelled = true;
      if (batteryRef) {
        try {
          batteryRef.removeEventListener('levelchange', syncFromManager);
          batteryRef.removeEventListener('chargingchange', syncFromManager);
        } catch {
          // Ignore listener cleanup errors
        }
      }
    };
  }, []);

  const isBatterySaverOn = evaluateBatterySaverActive({
    mode,
    batterySupported,
    level: currentBatteryLevel,
    charging,
  });

  return {
    batterySupported,
    initialBatteryLevel,
    currentBatteryLevel,
    charging,
    batterySaverMode: mode,
    isBatterySaverOn,
  };
}
