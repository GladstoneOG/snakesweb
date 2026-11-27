/**
 * Thin, defensive adapters around the utility singletons (sfx / music / haptics / motion).
 * They accept either named-function modules or a module exporting a namespace object
 * (`export const sfx = {...}` / default export) and never throw if a method is missing.
 */
import { useEffect, useState } from 'react';
import * as sfxModule from '@utils/sfx';
import * as musicModule from '@utils/music';
import * as hapticsModule from '@utils/haptics';
import * as motionModule from '@utils/motion';

type AnyFn = (...args: unknown[]) => unknown;
type Bag = Record<string, unknown>;

function resolveApi(mod: unknown, key: string): Bag {
  const m = mod as Bag;
  const named = m[key];
  if (named && typeof named === 'object') return named as Bag;
  const def = m['default'];
  if (def && typeof def === 'object') return def as Bag;
  return m;
}

function safeApi<T>(mod: unknown, key: string): T {
  const target = resolveApi(mod, key);
  const cache: Record<string, AnyFn> = {};
  return new Proxy({} as Bag, {
    get(_obj, prop) {
      if (typeof prop !== 'string') return undefined;
      if (cache[prop]) return cache[prop];
      const fn: AnyFn = (...args: unknown[]) => {
        const v = target[prop];
        if (typeof v !== 'function') return undefined;
        try {
          return (v as AnyFn).apply(target, args);
        } catch {
          return undefined;
        }
      };
      cache[prop] = fn;
      return fn;
    },
  }) as unknown as T;
}

type Listener = () => void;

export interface SfxApi {
  subscribe(listener: Listener): unknown;
  isMuted(): boolean | undefined;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  buttonClick(): void;
  diceShake(): void;
  diceBounce(intensity?: number): void;
  diceLand(face: number): void;
  pawnHop(stepIndex: number): void;
  ladderClimb(span?: number): void;
  snakeBite(span?: number): void;
  bump(): void;
  bounceBack(): void;
  bonusSix(): void;
  yourTurn(): void;
  timerTick(secsLeft: number): void;
  emote(): void;
  victory(): void;
}

export interface MusicSnapshot {
  enabled: boolean;
  volume: number;
  scene: 'lobby' | 'game' | string;
  awaitingGesture: boolean;
  trackTitle: string;
}

export interface MusicApi {
  subscribe(listener: Listener): unknown;
  getSnapshot(): MusicSnapshot | undefined;
  toggle(): void;
  setVolume(vol: number): void;
  setScene(scene: 'lobby' | 'game'): void;
  nextTrack(): void;
}

export interface HapticsApi {
  isSupported(): boolean | undefined;
  isEnabled(): boolean | undefined;
  setEnabled(next: boolean): void;
  toggle(): void;
  subscribe(listener: Listener): unknown;
  shake(): void;
  roll(): void;
  hop(): void;
  ladder(): void;
  snake(): void;
  bump(): void;
  yourTurn(): void;
  win(): void;
}

export const sfx = safeApi<SfxApi>(sfxModule, 'sfx');
export const music = safeApi<MusicApi>(musicModule, 'music');
export const haptics = safeApi<HapticsApi>(hapticsModule, 'haptics');
const motion = safeApi<{ prefersReducedMotion(): boolean | undefined }>(motionModule, 'motion');

export function reducedMotion(): boolean {
  const v = motion.prefersReducedMotion();
  if (typeof v === 'boolean') return v;
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function subscribeSafe(api: { subscribe(listener: Listener): unknown }, fn: Listener): () => void {
  const unsub = api.subscribe(fn) as unknown;
  return () => {
    if (typeof unsub === 'function') (unsub as () => void)();
  };
}

const DEFAULT_MUSIC: MusicSnapshot = {
  enabled: false,
  volume: 0.5,
  scene: 'lobby',
  awaitingGesture: false,
  trackTitle: '',
};

function readMusic(): MusicSnapshot {
  const snap = music.getSnapshot();
  return snap && typeof snap === 'object' ? { ...DEFAULT_MUSIC, ...snap } : DEFAULT_MUSIC;
}

export function useSfxMuted(): boolean {
  const [muted, setMuted] = useState<boolean>(() => !!sfx.isMuted());
  useEffect(() => subscribeSafe(sfx, () => setMuted(!!sfx.isMuted())), []);
  return muted;
}

export function useMusic(): MusicSnapshot {
  const [snap, setSnap] = useState<MusicSnapshot>(readMusic);
  useEffect(() => subscribeSafe(music, () => setSnap(readMusic())), []);
  return snap;
}

export function useHaptics(): { supported: boolean; enabled: boolean } {
  const read = () => ({ supported: !!haptics.isSupported(), enabled: !!haptics.isEnabled() });
  const [state, setState] = useState(read);
  useEffect(() => subscribeSafe(haptics, () => setState(read())), []);
  return state;
}

export function useReducedMotion(): boolean {
  const [rm, setRm] = useState<boolean>(reducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setRm(reducedMotion());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return rm;
}
