import { describe, expect, it } from 'vitest';
import {
  FACE_NORMALS,
  quatToCssMatrix3d,
  rotateVecByQuat,
  simulateSingleDie,
  type Vec3,
} from '@utils/dicePhysics';

function parseCssMatrix3d(css: string): number[] {
  const match = css.match(/^matrix3d\(([^)]+)\)$/);
  if (!match) {
    throw new Error(`Invalid CSS matrix3d string: ${css}`);
  }
  const nums = match[1].split(',').map((s) => Number(s.trim()));
  expect(nums).toHaveLength(16);
  for (const n of nums) {
    expect(Number.isFinite(n)).toBe(true);
  }
  return nums;
}

/**
 * Applies a CSS column-major 4x4 matrix3d to a 3D direction vector.
 * Columns are [0..3], [4..7], [8..11], [12..15].
 */
function transformDirByCssMatrix(m: number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

describe('3D dice physics & cube rotation group remapping', () => {
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

  it('lands flat with targetFace strictly facing +Z for all 6 faces across diverse seeds', () => {
    for (let targetFace = 1; targetFace <= 6; targetFace++) {
      for (const seed of seeds) {
        const sim = simulateSingleDie(seed, targetFace);

        expect(sim.frames.length).toBeGreaterThan(30);
        expect(sim.bounceFrames.length).toBeGreaterThanOrEqual(1);
        expect(sim.settleFrame).toBe(sim.frames.length - 1);
        expect(sim.durationMs).toBeGreaterThan(500);

        const finalFrame = sim.frames[sim.settleFrame];
        expect(finalFrame.z).toBe(0);

        // 1) Verify via quaternion rotation directly
        const targetNormal = FACE_NORMALS[targetFace];
        const worldViaQuat = rotateVecByQuat(targetNormal, finalFrame.quat);
        expect(worldViaQuat[0]).toBeCloseTo(0, 4);
        expect(worldViaQuat[1]).toBeCloseTo(0, 4);
        expect(worldViaQuat[2]).toBeCloseTo(1, 4);

        // 2) Verify via CSS matrix3d output (exact column-major transform used by browser)
        const css = quatToCssMatrix3d(finalFrame.quat);
        const m = parseCssMatrix3d(css);
        const worldViaCss = transformDirByCssMatrix(m, targetNormal);
        expect(worldViaCss[0]).toBeCloseTo(0, 4);
        expect(worldViaCss[1]).toBeCloseTo(0, 4);
        expect(worldViaCss[2]).toBeCloseTo(1, 4);

        // 3) Verify opposite face points strictly -Z and side faces lie strictly flat (z ~ 0)
        const oppositeFace = 7 - targetFace;
        const oppWorld = transformDirByCssMatrix(m, FACE_NORMALS[oppositeFace]);
        expect(oppWorld[2]).toBeCloseTo(-1, 4);

        for (let other = 1; other <= 6; other++) {
          if (other === targetFace || other === oppositeFace) continue;
          const sideWorld = transformDirByCssMatrix(m, FACE_NORMALS[other]);
          expect(Math.abs(sideWorld[2])).toBeLessThan(1e-4);
        }
      }
    }
  });

  it('is strictly deterministic for identical (seed, targetFace) pairs', () => {
    const a = simulateSingleDie('same_seed_123', 4);
    const b = simulateSingleDie('same_seed_123', 4);
    expect(a).toEqual(b);
  });
});
