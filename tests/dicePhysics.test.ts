import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DIE_HALF_EXTENT,
  getRestingDieQuaternion,
  LOCAL_FACE_NORMALS,
  simulateSingleDie,
  WORLD_UP,
} from '@utils/dicePhysics';

describe('3D cannon-es rigid-body dice physics & cube rotation group remapping', () => {
  const seeds = [
    'roll_alpha',
    'roll_beta',
    'roll_gamma',
    'SNKS_1_1_6_abc',
    'match_99_seq_42',
    'edge_case_zero',
    'seed_777',
    'turbulent_throw_x',
    'gentle_drop',
    'classic_test_10',
  ];

  it('lands flat at y = DIE_HALF_EXTENT with targetFace strictly pointing +Y (WORLD_UP) for all 6 faces across 10 seeds', () => {
    for (let targetFace = 1; targetFace <= 6; targetFace++) {
      for (const seed of seeds) {
        const sim = simulateSingleDie(seed, targetFace);

        expect(sim.frames).toHaveLength(72);
        expect(sim.bounceFrames.length).toBeGreaterThanOrEqual(1);
        expect(sim.settleFrame).toBe(66);
        expect(sim.durationMs).toBe(1200);

        for (const frameIdx of [sim.settleFrame, sim.frames.length - 1]) {
          const finalFrame = sim.frames[frameIdx];

          // Resting position lies cleanly on the tray floor inside clamped bounds
          expect(finalFrame.pos[0]).toBeGreaterThanOrEqual(-0.45);
          expect(finalFrame.pos[0]).toBeLessThanOrEqual(0.45);
          expect(finalFrame.pos[1]).toBeCloseTo(DIE_HALF_EXTENT, 5);
          expect(finalFrame.pos[2]).toBeGreaterThanOrEqual(-0.35);
          expect(finalFrame.pos[2]).toBeLessThanOrEqual(0.35);

          const q = new THREE.Quaternion(...finalFrame.quat);

          // Target face points strictly straight up (0, +1, 0)
          const targetWorld = LOCAL_FACE_NORMALS[targetFace].clone().applyQuaternion(q);
          expect(targetWorld.x).toBeCloseTo(WORLD_UP.x, 4);
          expect(targetWorld.y).toBeCloseTo(WORLD_UP.y, 4);
          expect(targetWorld.z).toBeCloseTo(WORLD_UP.z, 4);

          // Opposite face points strictly down (0, -1, 0)
          const oppositeFace = 7 - targetFace;
          const oppWorld = LOCAL_FACE_NORMALS[oppositeFace].clone().applyQuaternion(q);
          expect(oppWorld.x).toBeCloseTo(0, 4);
          expect(oppWorld.y).toBeCloseTo(-1, 4);
          expect(oppWorld.z).toBeCloseTo(0, 4);

          // All 4 side faces lie strictly flat (|y| < 1e-4)
          for (let other = 1; other <= 6; other++) {
            if (other === targetFace || other === oppositeFace) continue;
            const sideWorld = LOCAL_FACE_NORMALS[other].clone().applyQuaternion(q);
            expect(Math.abs(sideWorld.y)).toBeLessThan(1e-4);
          }
        }
      }
    }
  });

  it('produces valid resting quaternions pointing each face +Y with natural 3D yaw', () => {
    for (let face = 1; face <= 6; face++) {
      const q = new THREE.Quaternion(...getRestingDieQuaternion(face, 0.42));
      const up = LOCAL_FACE_NORMALS[face].clone().applyQuaternion(q);
      expect(up.x).toBeCloseTo(0, 5);
      expect(up.y).toBeCloseTo(1, 5);
      expect(up.z).toBeCloseTo(0, 5);

      const opp = LOCAL_FACE_NORMALS[7 - face].clone().applyQuaternion(q);
      expect(opp.y).toBeCloseTo(-1, 5);
    }
  });

  it('is strictly deterministic for identical (seed, targetFace) pairs', () => {
    const a = simulateSingleDie('same_seed_123', 4);
    const b = simulateSingleDie('same_seed_123', 4);
    expect(a).toEqual(b);
  });
});
