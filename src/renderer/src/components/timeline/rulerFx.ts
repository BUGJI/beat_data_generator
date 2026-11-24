import { useSettingsStore } from "../../stores/settings";
import { motionMs, reduceMotionActive } from "../../services/motion";

/** Base duration of the time-ruler tier crossfade, scaled by the motion tier. */
export const RULER_TIER_ANIM_MS = 150;

interface TierState {
  fromStepSec: number;
  fromDigits: 0 | 1 | 2;
  toStepSec: number;
  toDigits: 0 | 1 | 2;
  startAt: number;
  durMs: number;
}

let state: TierState | null = null;

function animationsOn(): boolean {
  return useSettingsStore().settings.animEnabled && !reduceMotionActive();
}

export interface RulerTierFrame {
  progress: number;
  fromStepSec: number;
  fromDigits: 0 | 1 | 2;
  toStepSec: number;
  toDigits: 0 | 1 | 2;
  active: boolean;
}

export function resetRulerTier(): void {
  state = null;
}

/** Record the current tick tier; returns true when a new crossfade just began. */
export function noteRulerTier(
  stepSec: number,
  digits: 0 | 1 | 2,
  now = performance.now(),
): boolean {
  if (!state) {
    state = {
      fromStepSec: stepSec,
      fromDigits: digits,
      toStepSec: stepSec,
      toDigits: digits,
      startAt: now,
      durMs: 0,
    };
    return false;
  }
  if (state.toStepSec === stepSec && state.toDigits === digits) return false;
  const durMs = animationsOn() ? motionMs(RULER_TIER_ANIM_MS) : 0;
  if (durMs <= 0) {
    state = {
      fromStepSec: stepSec,
      fromDigits: digits,
      toStepSec: stepSec,
      toDigits: digits,
      startAt: now,
      durMs: 0,
    };
    return false;
  }
  state = {
    fromStepSec: state.toStepSec,
    fromDigits: state.toDigits,
    toStepSec: stepSec,
    toDigits: digits,
    startAt: now,
    durMs,
  };
  return true;
}

export function rulerTierFrame(now = performance.now()): RulerTierFrame {
  const s = state;
  if (!s || s.durMs <= 0) {
    const step = s?.toStepSec ?? 0;
    const digits = s?.toDigits ?? 0;
    return {
      progress: 1,
      fromStepSec: step,
      fromDigits: digits,
      toStepSec: step,
      toDigits: digits,
      active: false,
    };
  }
  const raw = Math.min(1, Math.max(0, (now - s.startAt) / s.durMs));
  return {
    progress: 1 - (1 - raw) ** 3,
    fromStepSec: s.fromStepSec,
    fromDigits: s.fromDigits,
    toStepSec: s.toStepSec,
    toDigits: s.toDigits,
    active: raw < 1,
  };
}

export function rulerTierActive(now = performance.now()): boolean {
  if (!state || state.durMs <= 0) return false;
  return now - state.startAt < state.durMs;
}
