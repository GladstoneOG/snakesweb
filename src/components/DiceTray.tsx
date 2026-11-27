import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Dices, Sparkles } from 'lucide-react';
import type { PawnColorId } from '@engine/types';
import { quatToCssMatrix3d, simulateSingleDie } from '@utils/dicePhysics';
import { paletteOf } from './geometry';
import { haptics, reducedMotion, sfx } from './platform';

export interface DiceTrayHandle {
  playRoll(seed: string, targetFace: number): Promise<void>;
}

export interface DiceTrayProps {
  canRoll: boolean;
  rolling: boolean;
  lastFace: number;
  turnLabel: string;
  turnSub?: string;
  activeColor: PawnColorId;
  bonusActive?: boolean;
  onRoll: () => void;
}

const RESTING_ROT: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
};

const FACE_PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ value }: { value: number }) {
  const pips = FACE_PIPS[value] ?? FACE_PIPS[1];
  return (
    <div className={`die-face die-face-${value}`} aria-hidden="true">
      <div className="die-pips">
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className={pips.includes(i) ? `die-pip${value === 1 ? ' is-ace' : ''}` : 'die-pip-empty'}
          />
        ))}
      </div>
    </div>
  );
}

export const DiceTray = forwardRef<DiceTrayHandle, DiceTrayProps>(function DiceTray(
  { canRoll, rolling, lastFace, turnLabel, turnSub, activeColor, bonusActive, onRoll },
  ref,
) {
  const dieRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);

  const [shaking, setShaking] = useState(false);
  const [charge, setCharge] = useState(0);
  const [displayFace, setDisplayFace] = useState(() => Math.min(6, Math.max(1, lastFace || 1)));

  const shakingRef = useRef(false);
  const canRollRef = useRef(canRoll);
  const rollingRef = useRef(rolling);
  const onRollRef = useRef(onRoll);
  canRollRef.current = canRoll;
  rollingRef.current = rolling;
  onRollRef.current = onRoll;

  const rollAnimIdRef = useRef(0);
  const rafRef = useRef(0);
  const resolveAnimRef = useRef<(() => void) | null>(null);
  const shakeTickRef = useRef<number | null>(null);
  const chargeRafRef = useRef(0);
  const shakeStartRef = useRef(0);
  const inRollAnimRef = useRef(false);

  // Keep static resting face aligned when not actively rolling
  useEffect(() => {
    const safe = Math.min(6, Math.max(1, Math.round(lastFace || 1)));
    setDisplayFace(safe);
    if (!inRollAnimRef.current && dieRef.current) {
      dieRef.current.style.transform = `translate3d(0px, 0px, 0px) ${RESTING_ROT[safe]}`;
    }
    if (!inRollAnimRef.current && shadowRef.current) {
      shadowRef.current.style.transform = 'translate3d(0px, 0px, 0px) scale(1)';
      shadowRef.current.style.opacity = '0.52';
    }
  }, [lastFace]);

  const stopShake = useCallback((shouldRoll: boolean) => {
    if (!shakingRef.current) return;
    shakingRef.current = false;
    setShaking(false);
    setCharge(0);
    if (shakeTickRef.current !== null) {
      window.clearInterval(shakeTickRef.current);
      shakeTickRef.current = null;
    }
    if (chargeRafRef.current) {
      window.cancelAnimationFrame(chargeRafRef.current);
      chargeRafRef.current = 0;
    }
    if (shouldRoll && canRollRef.current && !rollingRef.current) {
      haptics.roll();
      onRollRef.current();
    }
  }, []);

  const startShake = useCallback(() => {
    if (!canRollRef.current || rollingRef.current || shakingRef.current) return;
    shakingRef.current = true;
    shakeStartRef.current = performance.now();
    setShaking(true);
    sfx.diceShake();
    haptics.shake();

    if (shakeTickRef.current !== null) window.clearInterval(shakeTickRef.current);
    shakeTickRef.current = window.setInterval(() => {
      if (!shakingRef.current) return;
      sfx.diceShake();
      haptics.shake();
    }, 220);

    const pumpCharge = (now: number) => {
      if (!shakingRef.current) return;
      const c = Math.max(0, Math.min(1, (now - shakeStartRef.current) / 850));
      setCharge(c);
      if (c < 1) {
        chargeRafRef.current = window.requestAnimationFrame(pumpCharge);
      }
    };
    chargeRafRef.current = window.requestAnimationFrame(pumpCharge);
  }, []);

  // Cancel shake if turn ends or rolling begins
  useEffect(() => {
    if ((!canRoll || rolling) && shakingRef.current) {
      stopShake(false);
    }
  }, [canRoll, rolling, stopShake]);

  // Spacebar hold-to-shake / release-to-roll
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      if (!canRollRef.current || rollingRef.current) return;
      e.preventDefault();
      if (!e.repeat) startShake();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (shakingRef.current) {
        e.preventDefault();
        stopShake(true);
      }
    };

    const onBlur = () => {
      if (shakingRef.current) stopShake(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [startShake, stopShake]);

  // Global pointerup when shaking so dragging slightly off button still rolls
  useEffect(() => {
    if (!shaking) return;
    const onUp = () => stopShake(true);
    const onCancel = () => stopShake(false);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [shaking, stopShake]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (shakeTickRef.current !== null) window.clearInterval(shakeTickRef.current);
      if (chargeRafRef.current) window.cancelAnimationFrame(chargeRafRef.current);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      if (resolveAnimRef.current) {
        resolveAnimRef.current();
        resolveAnimRef.current = null;
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      playRoll(seed: string, targetFace: number): Promise<void> {
        // Cancel any previous roll cleanly
        if (rafRef.current) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        if (resolveAnimRef.current) {
          resolveAnimRef.current();
          resolveAnimRef.current = null;
        }

        const token = ++rollAnimIdRef.current;
        const safeFace = Math.min(6, Math.max(1, Math.round(targetFace)));
        const sim = simulateSingleDie(seed, safeFace);
        const frames = sim.frames;
        const last = frames[frames.length - 1];

        setDisplayFace(safeFace);
        inRollAnimRef.current = true;

        return new Promise<void>((resolve) => {
          resolveAnimRef.current = resolve;

          const finish = () => {
            inRollAnimRef.current = false;
            if (dieRef.current && last) {
              dieRef.current.style.transform = `translate3d(${last.x * 0.6}px, ${last.y * 0.6}px, 0px) ${quatToCssMatrix3d(last.quat)}`;
            }
            if (shadowRef.current && last) {
              shadowRef.current.style.transform = `translate3d(${last.x * 0.6}px, ${last.y * 0.6}px, 0px) scale(1)`;
              shadowRef.current.style.opacity = '0.52';
            }
            if (resolveAnimRef.current === resolve) {
              resolveAnimRef.current = null;
            }
            resolve();
          };

          if (reducedMotion() || frames.length <= 1) {
            if (dieRef.current) {
              const rot = last ? quatToCssMatrix3d(last.quat) : RESTING_ROT[safeFace];
              dieRef.current.style.transform = `translate3d(0px, 0px, 0px) ${rot}`;
            }
            sfx.diceLand(safeFace);
            window.setTimeout(() => {
              if (rollAnimIdRef.current === token) finish();
            }, 180);
            return;
          }

          const bounceSet = new Set(sim.bounceFrames);
          const firedBounces = new Set<number>();
          let bounceCount = 0;
          let landed = false;
          let lastIdx = -1;
          const startTs = performance.now();
          const duration = Math.max(450, sim.durationMs || 980);

          const step = (now: number) => {
            if (rollAnimIdRef.current !== token) return;
            const t = Math.max(0, Math.min(1, (now - startTs) / duration));
            const idx = Math.max(0, Math.min(frames.length - 1, Math.floor(t * (frames.length - 1))));
            const fr = frames[idx];

            // Scale translation slightly if tray is compact
            const trayW = trayRef.current?.clientWidth ?? 220;
            const scale = trayW < 150 ? 0.42 : trayW < 210 ? 0.68 : 0.88;
            const x = fr.x * scale;
            const y = fr.y * scale;
            const z = Math.max(0, fr.z) * scale;

            if (dieRef.current) {
              dieRef.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) ${quatToCssMatrix3d(fr.quat)}`;
            }
            if (shadowRef.current) {
              const s = Math.max(0.55, 1 - z / 110);
              const op = Math.max(0.18, 0.54 - z / 150);
              shadowRef.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0px) scale(${s.toFixed(3)})`;
              shadowRef.current.style.opacity = op.toFixed(2);
            }

            // Fire any bounce / settle SFX crossed since last frame
            for (let k = lastIdx + 1; k <= idx; k++) {
              if (bounceSet.has(k) && !firedBounces.has(k)) {
                firedBounces.add(k);
                bounceCount++;
                const intensity = Math.max(0.28, 1 - (bounceCount - 1) * 0.26);
                sfx.diceBounce(intensity);
              }
              if (!landed && k >= sim.settleFrame) {
                landed = true;
                sfx.diceLand(safeFace);
              }
            }
            lastIdx = idx;

            if (t < 1) {
              rafRef.current = window.requestAnimationFrame(step);
            } else {
              if (!landed) sfx.diceLand(safeFace);
              rafRef.current = 0;
              finish();
            }
          };

          rafRef.current = window.requestAnimationFrame(step);
        });
      },
    }),
    [],
  );

  const pal = paletteOf(activeColor);

  return (
    <div
      className={`dice-card panel-wood${shaking ? ' is-shaking' : ''}${canRoll && !rolling ? ' is-turn' : ''}`}
      style={{
        ['--active-color' as string]: pal.primary,
        ['--charge' as string]: charge.toFixed(2),
      }}
    >
      <div className="dice-turn-head">
        <div className="dice-turn-dot" />
        <div className="dice-turn-meta">
          <div className="dice-turn-label">{turnLabel}</div>
          {turnSub && <div className="dice-turn-sub">{turnSub}</div>}
        </div>
        {bonusActive && (
          <span className="chip chip-brass dice-bonus-chip">
            <Sparkles />
            <span>Bonus!</span>
          </span>
        )}
      </div>

      <div
        ref={trayRef}
        className={`dice-tray${shaking ? ' is-shaking' : ''}${canRoll && !rolling ? ' is-interactive' : ''}`}
        role="button"
        tabIndex={canRoll && !rolling ? 0 : -1}
        aria-label={
          canRoll && !rolling
            ? 'Dice tray — press and hold to shake, release to roll'
            : `Dice showing ${displayFace}`
        }
        onPointerDown={(e) => {
          if (e.button !== 0 || !canRoll || rolling) return;
          e.preventDefault();
          startShake();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canRoll && !rolling) {
            e.preventDefault();
            haptics.roll();
            onRoll();
          }
        }}
      >
        <div className="dice-tray-rim" />
        <div className="dice-tray-glow" />
        <div className="die-scene">
          <div className="die-shadow" ref={shadowRef} />
          <div className="die-shake-wrap">
            <div className="die-cube" ref={dieRef}>
              <DieFace value={1} />
              <DieFace value={2} />
              <DieFace value={3} />
              <DieFace value={4} />
              <DieFace value={5} />
              <DieFace value={6} />
            </div>
          </div>
        </div>
        {!rolling && (
          <span className="dice-face-readout" aria-live="polite">
            {displayFace}
          </span>
        )}
      </div>

      <button
        type="button"
        className={`btn btn-primary btn-lg btn-block roll-btn${canRoll && !rolling ? ' is-ready' : ''}${shaking ? ' is-charging' : ''}`}
        disabled={!canRoll || rolling}
        onPointerDown={(e) => {
          if (e.button !== 0 || !canRoll || rolling) return;
          e.preventDefault();
          startShake();
        }}
        onClick={(e) => {
          // Pointer interactions roll on pointerup; handle keyboard Enter/click activation here
          if (e.detail === 0 && canRoll && !rolling) {
            haptics.roll();
            onRoll();
          }
        }}
      >
        <Dices />
        <span>
          {rolling
            ? 'Rolling…'
            : shaking
              ? 'Release to Roll!'
              : canRoll
                ? 'Hold or Tap to Roll'
                : 'Waiting…'}
        </span>
      </button>

      <div className="dice-hint">
        {canRoll && !rolling ? (
          <span>
            Hold <kbd>Space</kbd> or press die to shake
          </span>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </div>
  );
});

export default DiceTray;
