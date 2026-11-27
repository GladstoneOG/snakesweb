import { useEffect, useRef } from 'react';
import { reducedMotion } from './platform';

const COLORS = [
  '#f6d675',
  '#e0384f',
  '#2f6fe0',
  '#1fae6b',
  '#f0a020',
  '#9b4fd0',
  '#14b3b0',
  '#fff4cf',
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: 'rect' | 'circle' | 'ribbon';
  life: number;
  maxLife: number;
}

export interface ConfettiProps {
  active: boolean;
}

export function Confetti({ active }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active || reducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = window.innerWidth;
    let h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const spawnBurst = (cx: number, cy: number, count: number, spread = 1) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15 * spread;
        const speed = 5 + Math.random() * 11;
        particles.push({
          x: cx + (Math.random() - 0.5) * 40,
          y: cy + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 6 + Math.random() * 6,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.24,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          shape: i % 5 === 0 ? 'circle' : i % 3 === 0 ? 'ribbon' : 'rect',
          life: 0,
          maxLife: 140 + Math.random() * 90,
        });
      }
    };

    // Three celebratory cannon bursts
    spawnBurst(w * 0.22, h * 0.72, 55, 0.9);
    spawnBurst(w * 0.78, h * 0.72, 55, 0.9);
    spawnBurst(w * 0.5, h * 0.38, 65, 1.3);

    const secondWave = window.setTimeout(() => {
      spawnBurst(w * 0.35, h * 0.28, 45, 1.4);
      spawnBurst(w * 0.65, h * 0.28, 45, 1.4);
    }, 650);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(2.2, (now - last) / 16.67);
      last = now;
      ctx.clearRect(0, 0, w, h);

      let alive = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife || p.y > h + 40) continue;
        alive++;
        p.vy += 0.22 * dt;
        p.vx *= Math.pow(0.988, dt);
        p.x += p.vx * dt + Math.sin(p.life * 0.12) * 0.6 * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;

        const alpha = p.life > p.maxLife * 0.72 ? Math.max(0, 1 - (p.life - p.maxLife * 0.72) / (p.maxLife * 0.28)) : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const flip = Math.cos(p.life * 0.22);
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'ribbon') {
          ctx.scale(1, Math.max(0.25, Math.abs(flip)));
          ctx.fillRect(-p.size * 0.85, -p.size * 0.24, p.size * 1.7, p.size * 0.48);
        } else {
          ctx.scale(Math.max(0.25, Math.abs(flip)), 1);
          ctx.fillRect(-p.size * 0.5, -p.size * 0.35, p.size, p.size * 0.7);
        }
        ctx.restore();
      }

      if (alive > 0) {
        raf = window.requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(secondWave);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, w, h);
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}

export default Confetti;
