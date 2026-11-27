export type Quat = [number, number, number, number]; // [x, y, z, w]
export type Vec3 = [number, number, number];

export interface DiceFrame {
  x: number;
  y: number;
  z: number;
  quat: Quat;
}

export interface DiceSimulation {
  frames: DiceFrame[];
  bounceFrames: number[];
  settleFrame: number;
  durationMs: number;
}

/**
 * Local outward normals for each face (1..6) matching the CSS 3D cube convention:
 * - Face 1: rotateY(0deg)   translateZ(half) -> ( 0,  0,  1)
 * - Face 6: rotateY(180deg) translateZ(half) -> ( 0,  0, -1)
 * - Face 3: rotateY(90deg)  translateZ(half) -> ( 1,  0,  0)
 * - Face 4: rotateY(-90deg) translateZ(half) -> (-1,  0,  0)
 * - Face 2: rotateX(90deg)  translateZ(half) -> ( 0, -1,  0)
 * - Face 5: rotateX(-90deg) translateZ(half) -> ( 0,  1,  0)
 */
export const FACE_NORMALS: Record<number, Vec3> = {
  1: [0, 0, 1],
  2: [0, -1, 0],
  3: [1, 0, 0],
  4: [-1, 0, 0],
  5: [0, 1, 0],
  6: [0, 0, -1],
};

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createPrng(seed: string): () => number {
  let a = hashSeed(seed || 'dice') || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-12) return [0, 0, 0, 1];
  const inv = 1 / len;
  return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-12) return [0, 0, 0, 1];
  const half = angleRad * 0.5;
  const s = Math.sin(half) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + t * (bx - a[0]),
      a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]),
      a[3] + t * (bw - a[3]),
    ]);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return quatNormalize([
    s0 * a[0] + s1 * bx,
    s0 * a[1] + s1 * by,
    s0 * a[2] + s1 * bz,
    s0 * a[3] + s1 * bw,
  ]);
}

export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v' = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Generates the exact 24-element proper cube rotation group (octahedral group O).
 * Every element maps the cube onto itself while preserving orientation (det = +1).
 */
function buildCubeRotationGroup(): Quat[] {
  const halfPi = Math.PI / 2;
  const faceToTop: Quat[] = [
    [0, 0, 0, 1], // Face 1 -> +Z
    quatFromAxisAngle([1, 0, 0], -halfPi), // Face 2 (0,-1,0) -> +Z
    quatFromAxisAngle([0, 1, 0], -halfPi), // Face 3 (1,0,0) -> +Z
    quatFromAxisAngle([0, 1, 0], halfPi), // Face 4 (-1,0,0) -> +Z
    quatFromAxisAngle([1, 0, 0], halfPi), // Face 5 (0,1,0) -> +Z
    quatFromAxisAngle([0, 1, 0], Math.PI), // Face 6 (0,0,-1) -> +Z
  ];

  const group: Quat[] = [];
  for (const base of faceToTop) {
    for (let k = 0; k < 4; k++) {
      const zSpin = quatFromAxisAngle([0, 0, 1], k * halfPi);
      group.push(quatNormalize(quatMultiply(zSpin, base)));
    }
  }
  return group;
}

export const CUBE_GROUP_QUATS: readonly Quat[] = buildCubeRotationGroup();

/**
 * Computes the nearest flat orientation (some local cube axis aligned strictly with +Z,
 * preserving the current yaw around world Z) so the resting die lies flush on the tray.
 */
function snapFlatToFloor(q: Quat): Quat {
  // Find which of the 6 local face normals currently points closest to +Z
  let bestNormal: Vec3 = [0, 0, 1];
  let bestDot = -Infinity;
  for (let face = 1; face <= 6; face++) {
    const worldN = rotateVecByQuat(FACE_NORMALS[face], q);
    if (worldN[2] > bestDot) {
      bestDot = worldN[2];
      bestNormal = worldN;
    }
  }

  // Shortest-arc rotation bringing bestNormal -> (0, 0, 1)
  const up: Vec3 = [0, 0, 1];
  const d = Math.max(-1, Math.min(1, dot3(bestNormal, up)));
  let alignQ: Quat = [0, 0, 0, 1];
  if (d < 0.999999) {
    const axis = cross3(bestNormal, up);
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
    if (axisLen > 1e-6) {
      alignQ = quatFromAxisAngle(axis, Math.acos(d));
    } else {
      alignQ = quatFromAxisAngle([1, 0, 0], Math.PI);
    }
  }

  return quatNormalize(quatMultiply(alignQ, q));
}

/**
 * Picks a symmetry element `qRemap` in the 24-element cube rotation group such that
 * `qSimFinal * qRemap` maps `FACE_NORMALS[targetFace]` strictly to `(0, 0, +1)`.
 */
function findRemapQuat(qSimFinal: Quat, targetFace: number, rand: () => number): Quat {
  const targetNormal = FACE_NORMALS[targetFace] ?? FACE_NORMALS[1];
  const candidates: Quat[] = [];
  let bestScore = -Infinity;
  let bestQuat: Quat = CUBE_GROUP_QUATS[0];

  for (const g of CUBE_GROUP_QUATS) {
    const combined = quatNormalize(quatMultiply(qSimFinal, g));
    const worldN = rotateVecByQuat(targetNormal, combined);
    const score = worldN[2];
    if (score > bestScore) {
      bestScore = score;
      bestQuat = g;
    }
    if (score > 0.999) {
      candidates.push(g);
    }
  }

  if (candidates.length > 0) {
    const pick = Math.floor(rand() * candidates.length);
    return candidates[pick];
  }
  return bestQuat;
}

const CUBE_CORNERS: readonly Vec3[] = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
];

/**
 * Pure TypeScript 3D rigid-body single-die bounce simulation at 60 FPS.
 * Coordinates (x, y, z) are in subtle CSS pixels relative to the tray center
 * (x, y within ~[-38, 38], z >= 0 height above tray surface).
 *
 * Guarantees mathematically via 24-element cube group remapping that the final
 * resting orientation puts `targetFace` strictly facing +Z (toward the viewer)
 * while lying completely flat on the tray (z = 0).
 */
export function simulateSingleDie(seed: string, targetFace: number): DiceSimulation {
  const safeFace = Math.min(6, Math.max(1, Math.round(targetFace)));
  const rand = createPrng(`${seed}:face=${safeFace}`);

  const fps = 60;
  const dt = 1 / fps;
  const totalFrames = 62; // ~1033ms crisp, snappy tabletop roll
  const settleBlendStart = 50;

  // Die half-size in virtual tray pixels for realistic floor contact clearance
  const halfSize = 18;
  const trayBound = 36;
  const gravity = -1950;

  // Initial throw state: tossed from slightly off-center with energetic spin
  let x = (rand() - 0.5) * 34;
  let y = (rand() - 0.5) * 28;
  let z = 62 + rand() * 28;

  let vx = (rand() - 0.5) * 145 - x * 1.4;
  let vy = (rand() - 0.5) * 145 - y * 1.4;
  let vz = 95 + rand() * 85;

  let wx = (rand() > 0.5 ? 1 : -1) * (10 + rand() * 9);
  let wy = (rand() > 0.5 ? 1 : -1) * (10 + rand() * 9);
  let wz = (rand() - 0.5) * 12;

  let q: Quat = quatNormalize([
    rand() - 0.5,
    rand() - 0.5,
    rand() - 0.5,
    rand() - 0.5,
  ]);

  const rawFrames: DiceFrame[] = [];
  const bounceFrames: number[] = [];
  let lastBounceFrame = -10;

  for (let i = 0; i < totalFrames; i++) {
    // Integrate linear velocity and position
    vz += gravity * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    // Integrate angular velocity into quaternion: dq = 0.5 * [w, 0] * q
    const spinSpeed = Math.hypot(wx, wy, wz);
    if (spinSpeed > 1e-4) {
      const dq = quatFromAxisAngle([wx, wy, wz], spinSpeed * dt);
      q = quatNormalize(quatMultiply(dq, q));
    }

    // Soft tray wall collisions
    if (x > trayBound) {
      x = trayBound;
      vx = -Math.abs(vx) * 0.58;
      wy += 2.2;
    } else if (x < -trayBound) {
      x = -trayBound;
      vx = Math.abs(vx) * 0.58;
      wy -= 2.2;
    }
    if (y > trayBound) {
      y = trayBound;
      vy = -Math.abs(vy) * 0.58;
      wx -= 2.2;
    } else if (y < -trayBound) {
      y = -trayBound;
      vy = Math.abs(vy) * 0.58;
      wx += 2.2;
    }

    // Find lowest corner of the rotated cube to detect authentic floor contact
    let minCornerZ = Infinity;
    let lowestCorner: Vec3 = [0, 0, -halfSize];
    for (const c of CUBE_CORNERS) {
      const wc = rotateVecByQuat([c[0] * halfSize, c[1] * halfSize, c[2] * halfSize], q);
      if (wc[2] < minCornerZ) {
        minCornerZ = wc[2];
        lowestCorner = wc;
      }
    }

    const clearance = -minCornerZ - halfSize; // extra lift when tilted on edge/corner
    const floorZ = Math.max(0, clearance);

    if (z <= floorZ) {
      const impactSpeed = -vz;
      z = floorZ;

      if (impactSpeed > 65) {
        vz = impactSpeed * 0.44;
        vx *= 0.72;
        vy *= 0.72;

        // Corner torque impulse on impact
        wx = wx * 0.68 + (lowestCorner[1] / halfSize) * (impactSpeed * 0.015);
        wy = wy * 0.68 - (lowestCorner[0] / halfSize) * (impactSpeed * 0.015);
        wz *= 0.72;

        if (i - lastBounceFrame >= 4) {
          bounceFrames.push(i);
          lastBounceFrame = i;
        }
      } else {
        vz = 0;
        vx *= 0.82;
        vy *= 0.82;
        wx *= 0.76;
        wy *= 0.76;
        wz *= 0.78;
      }
    } else {
      // Gentle air drag
      vx *= 0.992;
      vy *= 0.992;
      wx *= 0.988;
      wy *= 0.988;
      wz *= 0.988;
    }

    // Gentle recentering pull toward tray middle so final die stays well framed
    x *= 0.985;
    y *= 0.985;

    rawFrames.push({
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      z: Math.round(Math.max(0, z) * 100) / 100,
      quat: q,
    });
  }

  // Ensure at least one audible bounce if initial toss was unusually soft
  if (bounceFrames.length === 0) {
    bounceFrames.push(18);
  }

  // Snap the final resting frames smoothly to a completely flat floor orientation
  const settleBaseQuat = rawFrames[settleBlendStart].quat;
  const flatEndQuat = snapFlatToFloor(rawFrames[totalFrames - 1].quat);
  const finalX = rawFrames[totalFrames - 1].x * 0.65;
  const finalY = rawFrames[totalFrames - 1].y * 0.65;
  const startBlendX = rawFrames[settleBlendStart].x;
  const startBlendY = rawFrames[settleBlendStart].y;
  const startBlendZ = rawFrames[settleBlendStart].z;

  for (let i = settleBlendStart; i < totalFrames; i++) {
    const rawT = (i - settleBlendStart) / (totalFrames - 1 - settleBlendStart);
    // Smoothstep easing for tactile settling onto the velvet felt
    const ease = rawT * rawT * (3 - 2 * rawT);
    rawFrames[i] = {
      x: Math.round((startBlendX + (finalX - startBlendX) * ease) * 100) / 100,
      y: Math.round((startBlendY + (finalY - startBlendY) * ease) * 100) / 100,
      z: Math.round(startBlendZ * (1 - ease) * 100) / 100,
      quat: quatSlerp(settleBaseQuat, flatEndQuat, ease),
    };
  }

  // Exact 24-element cube rotation group remapping so targetFace ends strictly facing +Z
  const qRemap = findRemapQuat(flatEndQuat, safeFace, rand);
  const remappedFrames: DiceFrame[] = rawFrames.map((frame) => ({
    x: frame.x,
    y: frame.y,
    z: frame.z,
    quat: quatNormalize(quatMultiply(frame.quat, qRemap)),
  }));

  // Guarantee exact zero height on the final settled frame
  remappedFrames[remappedFrames.length - 1].z = 0;

  return {
    frames: remappedFrames,
    bounceFrames,
    settleFrame: totalFrames - 1,
    durationMs: Math.round((totalFrames / fps) * 1000),
  };
}

/**
 * Converts a unit quaternion [x, y, z, w] to a CSS `matrix3d(...)` string
 * in column-major order matching standard CSS 3D right-handed coordinates.
 */
export function quatToCssMatrix3d(quat: Quat): string {
  const [x, y, z, w] = quatNormalize(quat);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  const m00 = 1 - 2 * (yy + zz);
  const m01 = 2 * (xy - wz);
  const m02 = 2 * (xz + wy);

  const m10 = 2 * (xy + wz);
  const m11 = 1 - 2 * (xx + zz);
  const m12 = 2 * (yz - wx);

  const m20 = 2 * (xz - wy);
  const m21 = 2 * (yz + wx);
  const m22 = 1 - 2 * (xx + yy);

  const f = (n: number) => (Math.abs(n) < 1e-7 ? '0' : n.toFixed(6));

  // Column-major order for CSS matrix3d
  return `matrix3d(${f(m00)},${f(m10)},${f(m20)},0,${f(m01)},${f(m11)},${f(m21)},0,${f(m02)},${f(m12)},${f(m22)},0,0,0,0,1)`;
}
