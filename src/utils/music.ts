export type MusicScene = 'lobby' | 'game';

export interface MusicSnapshot {
  enabled: boolean;
  volume: number;
  scene: MusicScene;
  awaitingGesture: boolean;
  trackTitle: string;
}

type MusicListener = (snapshot: MusicSnapshot) => void;

interface ProceduralTrack {
  title: string;
  scene: MusicScene;
  tempoMs: number;
  melody: readonly (number | null)[];
  bass: readonly (number | null)[];
  warmth: number;
}

const TRACKS: readonly ProceduralTrack[] = [
  {
    title: 'Sunlit Parlor',
    scene: 'lobby',
    tempoMs: 360,
    // Warm C major pentatonic kalimba motif
    melody: [523.25, null, 659.25, 587.33, 523.25, null, 440, 392, 440, null, 523.25, 659.25, 783.99, null, 659.25, null],
    bass: [130.81, null, null, null, 174.61, null, null, null, 146.83, null, null, null, 196.0, null, null, null],
    warmth: 0.65,
  },
  {
    title: 'Cedar & Brass',
    scene: 'game',
    tempoMs: 285,
    // Upbeat marimba tabletop groove in G major pentatonic
    melody: [392, 493.88, 587.33, null, 659.25, 587.33, 493.88, 440, 392, null, 587.33, 659.25, 783.99, 659.25, 587.33, null],
    bass: [196.0, null, 146.83, null, 164.81, null, 146.83, null, 130.81, null, 146.83, null, 196.0, null, 146.83, null],
    warmth: 0.72,
  },
  {
    title: 'Emerald Garden',
    scene: 'game',
    tempoMs: 310,
    // Playful F Lydian kalimba bounce
    melody: [349.23, null, 440, 523.25, 659.25, null, 587.33, 523.25, 440, 523.25, 493.88, null, 440, 392, 349.23, null],
    bass: [174.61, null, null, 130.81, 164.81, null, null, 146.83, 174.61, null, null, 196.0, 130.81, null, 174.61, null],
    warmth: 0.68,
  },
];

const ENABLED_KEY = 'snakesweb_music_enabled';
const VOLUME_KEY = 'snakesweb_music_volume';

class ProceduralMusicManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stepTimer: number | null = null;
  private stepIndex = 0;

  private enabled = false;
  private volume = 0.35;
  private scene: MusicScene = 'lobby';
  private trackIndex = 0;
  private awaitingGesture = false;
  private gestureBound = false;
  private listeners = new Set<MusicListener>();

  constructor() {
    try {
      const savedEnabled = localStorage.getItem(ENABLED_KEY);
      if (savedEnabled === '1') this.enabled = true;
      const savedVol = Number(localStorage.getItem(VOLUME_KEY));
      if (!Number.isNaN(savedVol) && savedVol >= 0 && savedVol <= 1) {
        this.volume = savedVol;
      }
    } catch {
      // ignore storage errors
    }

    if (this.enabled && typeof window !== 'undefined') {
      this.awaitingGesture = true;
      this.bindGestureUnlock();
    }
  }

  private bindGestureUnlock(): void {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    const unlock = () => {
      if (!this.enabled) return;
      this.startEngine();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private getCurrentTrack(): ProceduralTrack {
    return TRACKS[this.trackIndex % TRACKS.length];
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.volume * 0.28, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  private playMarimbaNote(freq: number, durSec: number, vol: number, harmonicRatio = 2): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master || ctx.state !== 'running') return;

    const now = ctx.currentTime;

    // Fundamental wooden resonator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + durSec + 0.02);

    // Subtle wooden overtone click
    const over = ctx.createOscillator();
    const overGain = ctx.createGain();
    over.type = 'triangle';
    over.frequency.setValueAtTime(freq * harmonicRatio, now);

    overGain.gain.setValueAtTime(0.0001, now);
    overGain.gain.linearRampToValueAtTime(vol * 0.24, now + 0.006);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(0.11, durSec * 0.45));

    over.connect(overGain);
    overGain.connect(master);
    over.start(now);
    over.stop(now + 0.14);
  }

  private startEngine(): void {
    if (!this.enabled || typeof window === 'undefined') return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => {
          this.awaitingGesture = false;
          this.beginLoop();
          this.emit();
        })
        .catch(() => {
          this.awaitingGesture = true;
          this.bindGestureUnlock();
          this.emit();
        });
      return;
    }

    this.awaitingGesture = false;
    this.beginLoop();
    this.emit();
  }

  private beginLoop(): void {
    this.stopLoop();
    const track = this.getCurrentTrack();
    this.stepTimer = window.setInterval(() => {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const active = this.getCurrentTrack();
      const idx = this.stepIndex % active.melody.length;
      const mel = active.melody[idx];
      const bass = active.bass[idx];

      if (mel !== null) {
        this.playMarimbaNote(mel, 0.34, 0.45 * active.warmth, 3);
      }
      if (bass !== null) {
        this.playMarimbaNote(bass, 0.52, 0.32 * active.warmth, 2);
      }
      this.stepIndex = (this.stepIndex + 1) % active.melody.length;
    }, track.tempoMs);
  }

  private stopLoop(): void {
    if (this.stepTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
  }

  getSnapshot(): MusicSnapshot {
    return {
      enabled: this.enabled,
      volume: this.volume,
      scene: this.scene,
      awaitingGesture: this.awaitingGesture,
      trackTitle: this.getCurrentTrack().title,
    };
  }

  subscribe(listener: MusicListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) listener(snap);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(ENABLED_KEY, this.enabled ? '1' : '0');
    } catch {
      // ignore
    }
    if (this.enabled) {
      this.startEngine();
    } else {
      this.awaitingGesture = false;
      this.stopLoop();
      this.emit();
    }
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // ignore
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume * 0.28, this.ctx.currentTime);
    }
    this.emit();
  }

  setScene(scene: MusicScene): void {
    if (this.scene === scene) return;
    this.scene = scene;
    const matchIdx = TRACKS.findIndex((t) => t.scene === scene);
    if (matchIdx >= 0) {
      this.trackIndex = matchIdx;
      this.stepIndex = 0;
      if (this.enabled && !this.awaitingGesture) {
        this.beginLoop();
      }
    }
    this.emit();
  }

  nextTrack(): void {
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    this.stepIndex = 0;
    if (this.enabled && !this.awaitingGesture) {
      this.beginLoop();
    }
    this.emit();
  }
}

export const music = new ProceduralMusicManager();
