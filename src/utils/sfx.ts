const MUTE_KEY = 'snakesweb_sfx_muted';

type MuteListener = (muted: boolean) => void;

class SfxManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private listeners = new Set<MuteListener>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.014, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noiseHit(filterFreq: number, q: number, duration: number, volume: number, delay = 0): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, start);
    filter.Q.setValueAtTime(q, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(start);
    src.stop(start + duration + 0.02);
  }

  subscribe(listener: MuteListener): () => void {
    this.listeners.add(listener);
    listener(this.muted);
    return () => this.listeners.delete(listener);
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
    for (const listener of this.listeners) listener(this.muted);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  buttonClick(): void {
    this.tone(560, 420, 0.055, 'triangle', 0.08);
  }

  diceShake(): void {
    const pitch = 900 + Math.random() * 550;
    this.noiseHit(pitch, 3.2, 0.045, 0.09);
    this.tone(240 + Math.random() * 90, 160, 0.04, 'triangle', 0.045);
  }

  diceBounce(intensity = 1): void {
    const clamped = Math.max(0.2, Math.min(1.4, intensity));
    this.noiseHit(1350 + clamped * 450, 4.0, 0.055, 0.14 * clamped);
    this.tone(290 + clamped * 110, 145, 0.06, 'triangle', 0.08 * clamped);
  }

  diceLand(face: number): void {
    this.noiseHit(1150, 3.5, 0.04, 0.09);
    const notes = [330, 370, 415, 440, 494, 587];
    const freq = notes[(Math.max(1, Math.min(6, face)) - 1) % notes.length];
    this.tone(freq, freq * 1.02, 0.14, 'sine', 0.11);
    if (face === 6) {
      this.tone(freq * 1.5, freq * 1.52, 0.18, 'triangle', 0.09, 0.05);
    }
  }

  pawnHop(stepIndex: number): void {
    const scale = [330, 370, 415, 440, 494, 554, 622, 659];
    const base = scale[Math.abs(stepIndex) % scale.length];
    this.tone(base, base * 1.24, 0.09, 'sine', 0.095);
    this.noiseHit(750, 2.2, 0.03, 0.035, 0.03);
  }

  ladderClimb(span = 20): void {
    const steps = Math.max(4, Math.min(8, Math.round(span / 6) + 3));
    const pentatonic = [392, 440, 494, 587, 659, 784, 880, 1046];
    for (let i = 0; i < steps; i++) {
      const f = pentatonic[i % pentatonic.length];
      this.tone(f, f * 1.03, 0.16, 'triangle', 0.1, i * 0.075);
      this.tone(f * 2, f * 2, 0.1, 'sine', 0.04, i * 0.075 + 0.01);
    }
  }

  snakeBite(span = 20): void {
    const dur = Math.max(0.42, Math.min(0.85, 0.35 + span * 0.007));
    // Playful cartoonish hiss + descending slide
    this.noiseHit(3600, 1.8, 0.22, 0.075);
    this.tone(540, 145, dur, 'sawtooth', 0.075, 0.04);
    this.tone(420, 115, dur * 0.9, 'triangle', 0.09, 0.06);
  }

  bump(): void {
    this.tone(240, 95, 0.14, 'square', 0.09);
    this.tone(520, 260, 0.11, 'triangle', 0.1, 0.02);
    this.noiseHit(620, 1.5, 0.08, 0.11);
  }

  bounceBack(): void {
    this.tone(460, 280, 0.16, 'sine', 0.11);
    this.tone(280, 390, 0.14, 'triangle', 0.08, 0.09);
  }

  bonusSix(): void {
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, idx) => {
      this.tone(f, f * 1.01, 0.22, 'triangle', 0.095, idx * 0.055);
    });
  }

  yourTurn(): void {
    this.tone(523.25, 523.25, 0.12, 'sine', 0.085, 0);
    this.tone(659.25, 659.25, 0.18, 'sine', 0.095, 0.09);
  }

  timerTick(secsLeft: number): void {
    const urgent = secsLeft <= 3;
    this.tone(urgent ? 880 : 620, urgent ? 760 : 540, 0.055, 'triangle', urgent ? 0.09 : 0.05);
  }

  emote(): void {
    this.tone(480, 740, 0.11, 'sine', 0.085);
    this.tone(740, 880, 0.12, 'triangle', 0.07, 0.06);
  }

  victory(): void {
    const fanfare = [
      { f: 523.25, d: 0.14, t: 0 },
      { f: 659.25, d: 0.14, t: 0.11 },
      { f: 783.99, d: 0.16, t: 0.22 },
      { f: 1046.5, d: 0.42, t: 0.34 },
      { f: 783.99, d: 0.14, t: 0.56 },
      { f: 1046.5, d: 0.55, t: 0.7 },
    ];
    for (const note of fanfare) {
      this.tone(note.f, note.f, note.d, 'triangle', 0.12, note.t);
      this.tone(note.f * 0.5, note.f * 0.5, note.d, 'sine', 0.06, note.t);
    }
  }
}

export const sfx = new SfxManager();
