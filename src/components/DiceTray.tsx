import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { Dices, Sparkles } from 'lucide-react';
import type { PawnColorId } from '@engine/types';
import {
  createDieFaceTexture,
  createRoundedDieGeometry,
  DIE_FACE_MATERIAL_ORDER,
  DIE_HALF_EXTENT,
  getRestingDieQuaternion,
  simulateSingleDie,
  type Quat,
} from '@utils/dicePhysics';
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

interface ThreeDiceRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dieMesh: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
  textures: THREE.CanvasTexture[];
  disposables: Array<{ dispose: () => void }>;
}

interface SettledPose {
  face: number;
  pos: [number, number, number];
  quat: Quat;
}

export const DiceTray = forwardRef<DiceTrayHandle, DiceTrayProps>(function DiceTray(
  { canRoll, rolling, lastFace, turnLabel, turnSub, activeColor, bonusActive, onRoll },
  ref,
) {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeRef = useRef<ThreeDiceRig | null>(null);

  const [shaking, setShaking] = useState(false);
  const [charge, setCharge] = useState(0);
  const [webglReady, setWebglReady] = useState(true);
  const [displayFace, setDisplayFace] = useState(() => Math.min(6, Math.max(1, lastFace || 1)));

  const shakingRef = useRef(false);
  const chargeRef = useRef(0);
  const canRollRef = useRef(canRoll);
  const rollingRef = useRef(rolling);
  const onRollRef = useRef(onRoll);
  const displayFaceRef = useRef(displayFace);
  canRollRef.current = canRoll;
  rollingRef.current = rolling;
  onRollRef.current = onRoll;
  displayFaceRef.current = displayFace;

  const rollAnimIdRef = useRef(0);
  const rafRef = useRef(0);
  const shakeRafRef = useRef(0);
  const resolveAnimRef = useRef<(() => void) | null>(null);
  const shakeTickRef = useRef<number | null>(null);
  const shakeStartRef = useRef(0);
  const inRollAnimRef = useRef(false);
  const settledPoseRef = useRef<SettledPose | null>(null);

  const pal = paletteOf(activeColor);
  const accentColorRef = useRef(pal.primary);
  accentColorRef.current = pal.primary;

  const renderResting = useCallback((face: number, useSettledIfMatching = true) => {
    const rig = threeRef.current;
    if (!rig) return;
    const safe = Math.min(6, Math.max(1, Math.round(face || 1)));
    const settled = settledPoseRef.current;
    if (useSettledIfMatching && settled && settled.face === safe) {
      rig.dieMesh.position.set(settled.pos[0], settled.pos[1], settled.pos[2]);
      rig.dieMesh.quaternion.set(settled.quat[0], settled.quat[1], settled.quat[2], settled.quat[3]);
    } else {
      const q = getRestingDieQuaternion(safe, 0.42);
      rig.dieMesh.position.set(0, DIE_HALF_EXTENT, 0);
      rig.dieMesh.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    rig.renderer.render(rig.scene, rig.camera);
  }, []);

  // Initialize persistent Three.js WebGL scene once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    const tray = trayRef.current;
    if (!canvas || !tray) return;

    let rig: ThreeDiceRig | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      const rect = tray.getBoundingClientRect();
      const width = Math.max(80, Math.round(rect.width) || 240);
      const height = Math.max(80, Math.round(rect.height) || 158);

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'default',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
      camera.position.set(0, 5.1, 4.2);
      camera.lookAt(0, 0.22, 0);

      const hemiLight = new THREE.HemisphereLight(0xfffaf0, 0x3b1d2a, 1.15);
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.9);
      keyLight.position.set(3.2, 8.5, 4.2);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(512, 512);
      keyLight.shadow.camera.left = -3.2;
      keyLight.shadow.camera.right = 3.2;
      keyLight.shadow.camera.top = 3.2;
      keyLight.shadow.camera.bottom = -3.2;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 20;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.radius = 2;
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xfde68a, 0.65);
      rimLight.position.set(-4, 5, -3.5);
      scene.add(rimLight);

      const disposables: Array<{ dispose: () => void }> = [];

      // Shadow catcher plane at y = 0
      const floorGeo = new THREE.PlaneGeometry(12, 12);
      const floorMat = new THREE.ShadowMaterial({ opacity: 0.42 });
      disposables.push(floorGeo, floorMat);
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.y = 0;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);

      const textures: THREE.CanvasTexture[] = [];
      const materials = DIE_FACE_MATERIAL_ORDER.map((val) => {
        const tex = createDieFaceTexture(val, accentColorRef.current);
        textures.push(tex);
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.22,
          metalness: 0.06,
        });
        disposables.push(mat);
        return mat;
      });

      const dieGeo = createRoundedDieGeometry(1.24, 0.14, 8);
      disposables.push(dieGeo);

      const dieMesh = new THREE.Mesh(dieGeo, materials);
      dieMesh.castShadow = true;
      scene.add(dieMesh);

      rig = { renderer, scene, camera, dieMesh, materials, textures, disposables };
      threeRef.current = rig;
      setWebglReady(true);

      // Render initial resting pose immediately
      renderResting(displayFaceRef.current, true);

      const handleResize = (w: number, h: number) => {
        if (!rig || w < 10 || h < 10) return;
        rig.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        rig.renderer.setSize(w, h, false);
        rig.camera.aspect = w / h;
        rig.camera.updateProjectionMatrix();
        if (!inRollAnimRef.current && !shakingRef.current) {
          rig.renderer.render(rig.scene, rig.camera);
        }
      };

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          handleResize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
        });
        resizeObserver.observe(tray);
      }
    } catch {
      threeRef.current = null;
      setWebglReady(false);
    }

    return () => {
      resizeObserver?.disconnect();
      if (rig) {
        for (const tex of rig.textures) tex.dispose();
        for (const item of rig.disposables) item.dispose();
        rig.renderer.dispose();
      }
      threeRef.current = null;
    };
  }, [renderResting]);

  // Refresh face accent textures when active player color changes
  useEffect(() => {
    const rig = threeRef.current;
    if (!rig) return;
    const oldTextures = rig.textures;
    const nextTextures = DIE_FACE_MATERIAL_ORDER.map((val, idx) => {
      const tex = createDieFaceTexture(val, pal.primary);
      rig.materials[idx].map = tex;
      rig.materials[idx].needsUpdate = true;
      return tex;
    });
    rig.textures = nextTextures;
    for (const old of oldTextures) old.dispose();
    if (!inRollAnimRef.current && !shakingRef.current) {
      rig.renderer.render(rig.scene, rig.camera);
    }
  }, [pal.primary]);

  // Keep static resting face aligned when not actively rolling or shaking
  useEffect(() => {
    const safe = Math.min(6, Math.max(1, Math.round(lastFace || 1)));
    setDisplayFace(safe);
    if (!inRollAnimRef.current && !shakingRef.current) {
      renderResting(safe, true);
    }
  }, [lastFace, renderResting]);

  // Shaking 3D animation loop: levitating die with energetic 3D tumble + tray jitter
  useEffect(() => {
    if (!shaking) return;
    let cancelled = false;
    let lastTs = performance.now();
    const startTs = lastTs;

    const tick = (now: number) => {
      if (cancelled || !shakingRef.current) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      const elapsed = (now - startTs) / 1000;
      const c = Math.max(0, Math.min(1, (now - shakeStartRef.current) / 850));
      chargeRef.current = c;
      setCharge(c);

      const rig = threeRef.current;
      if (rig && !inRollAnimRef.current) {
        const y = DIE_HALF_EXTENT + 0.55 + c * 0.45 + Math.sin(elapsed * 26) * 0.08;
        const x = Math.sin(elapsed * 23) * 0.35;
        const z = Math.cos(elapsed * 19) * 0.25;
        rig.dieMesh.position.set(x, y, z);

        const spinBoost = 1 + c * 0.75;
        const dq = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(11.5 * spinBoost * dt, 14.2 * spinBoost * dt, 9.4 * spinBoost * dt),
        );
        rig.dieMesh.quaternion.premultiply(dq).normalize();
        rig.renderer.render(rig.scene, rig.camera);
      }

      shakeRafRef.current = window.requestAnimationFrame(tick);
    };

    shakeRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (shakeRafRef.current) {
        window.cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = 0;
      }
    };
  }, [shaking]);

  const stopShake = useCallback(
    (shouldRoll: boolean) => {
      if (!shakingRef.current) return;
      shakingRef.current = false;
      chargeRef.current = 0;
      setShaking(false);
      setCharge(0);
      if (shakeTickRef.current !== null) {
        window.clearInterval(shakeTickRef.current);
        shakeTickRef.current = null;
      }
      if (shakeRafRef.current) {
        window.cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = 0;
      }
      if (shouldRoll && canRollRef.current && !rollingRef.current) {
        haptics.roll();
        onRollRef.current();
      } else if (!inRollAnimRef.current) {
        renderResting(displayFaceRef.current, true);
      }
    },
    [renderResting],
  );

  const startShake = useCallback(() => {
    if (!canRollRef.current || rollingRef.current || shakingRef.current) return;
    shakingRef.current = true;
    shakeStartRef.current = performance.now();
    chargeRef.current = 0;
    setShaking(true);
    sfx.diceShake();
    haptics.shake();

    if (shakeTickRef.current !== null) window.clearInterval(shakeTickRef.current);
    shakeTickRef.current = window.setInterval(() => {
      if (!shakingRef.current) return;
      sfx.diceShake();
      haptics.shake();
    }, 220);
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
      if (shakeRafRef.current) window.cancelAnimationFrame(shakeRafRef.current);
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
            if (last) {
              settledPoseRef.current = {
                face: safeFace,
                pos: [last.pos[0], DIE_HALF_EXTENT, last.pos[2]],
                quat: last.quat,
              };
            }
            renderResting(safeFace, true);
            if (resolveAnimRef.current === resolve) {
              resolveAnimRef.current = null;
            }
            resolve();
          };

          if (reducedMotion() || frames.length <= 1) {
            settledPoseRef.current = last
              ? { face: safeFace, pos: [last.pos[0], DIE_HALF_EXTENT, last.pos[2]], quat: last.quat }
              : null;
            renderResting(safeFace, true);
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
          const duration = Math.max(600, sim.durationMs || 1200);

          const applyFrame = (idx: number) => {
            const rig = threeRef.current;
            const fr = frames[idx];
            if (!rig || !fr) return;
            rig.dieMesh.position.set(fr.pos[0], fr.pos[1], fr.pos[2]);
            rig.dieMesh.quaternion.set(fr.quat[0], fr.quat[1], fr.quat[2], fr.quat[3]);
            rig.renderer.render(rig.scene, rig.camera);
          };

          applyFrame(0);

          const step = (now: number) => {
            if (rollAnimIdRef.current !== token) return;
            const t = Math.max(0, Math.min(1, (now - startTs) / duration));
            const idx = Math.max(0, Math.min(frames.length - 1, Math.floor(t * (frames.length - 1))));

            applyFrame(idx);

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
    [renderResting],
  );

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
        <canvas ref={canvasRef} className="dice-webgl-canvas" aria-hidden="true" />
        {!webglReady && (
          <div className="dice-fallback-die" aria-hidden="true">
            {displayFace}
          </div>
        )}
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
