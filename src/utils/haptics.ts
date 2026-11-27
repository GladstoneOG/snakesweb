const HAPTICS_KEY = 'snakesweb_haptics_enabled';

type HapticsListener = (enabled: boolean) => void;

class HapticsManager {
  private enabled = true;
  private listeners = new Set<HapticsListener>();

  constructor() {
    try {
      const saved = localStorage.getItem(HAPTICS_KEY);
      if (saved === '0') this.enabled = false;
    } catch {
      this.enabled = true;
    }
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
    try {
      localStorage.setItem(HAPTICS_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
    for (const listener of this.listeners) listener(this.enabled);
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  subscribe(listener: HapticsListener): () => void {
    this.listeners.add(listener);
    listener(this.enabled);
    return () => this.listeners.delete(listener);
  }

  private pulse(pattern: number | number[]): void {
    if (!this.enabled || !this.isSupported()) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore
    }
  }

  shake(): void {
    this.pulse(12);
  }

  roll(): void {
    this.pulse([16, 28, 12]);
  }

  hop(): void {
    this.pulse(9);
  }

  ladder(): void {
    this.pulse([15, 25, 20, 25, 30]);
  }

  snake(): void {
    this.pulse([45, 35, 35, 30, 20]);
  }

  bump(): void {
    this.pulse([30, 20, 22]);
  }

  yourTurn(): void {
    this.pulse([14, 40, 14]);
  }

  win(): void {
    this.pulse([35, 45, 35, 45, 80]);
  }
}

export const haptics = new HapticsManager();
