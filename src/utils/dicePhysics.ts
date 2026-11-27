import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export type Quat = [number, number, number, number]; // [x, y, z, w]

export interface DiceFrame {
  pos: [number, number, number];
  quat: Quat;
}

export interface DiceSimulation {
  frames: DiceFrame[];
  bounceFrames: number[];
  settleFrame: number;
  durationMs: number;
}

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const DIE_HALF_EXTENT = 0.62; // die size = 1.24

/**
 * Three.js BoxGeometry material face order:
 * 0:+X -> 3, 1:-X -> 4, 2:+Y -> 1, 3:-Y -> 6, 4:+Z -> 2, 5:-Z -> 5
 */
export const DIE_FACE_MATERIAL_ORDER = [3, 4, 1, 6, 2, 5] as const;

export const LOCAL_FACE_NORMALS: Readonly<Record<number, THREE.Vector3>> = {
  1: new THREE.Vector3(0, 1, 0),
  2: new THREE.Vector3(0, 0, 1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  5: new THREE.Vector3(0, 0, -1),
  6: new THREE.Vector3(0, -1, 0),
};

const PIP_COORDS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.27, 0.5],
    [0.27, 0.75],
    [0.73, 0.25],
    [0.73, 0.5],
    [0.73, 0.75],
  ],
};

/**
 * Precompute all 24 proper rotation quaternions (det = +1) of the cube symmetry group O.
 */
function buildCubeGroupRotations(): THREE.Quaternion[] {
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];

  const rotations: THREE.Quaternion[] = [];
  const zAxis = new THREE.Vector3();
  const mat = new THREE.Matrix4();

  for (const xAxis of axes) {
    for (const yAxis of axes) {
      if (Math.abs(xAxis.dot(yAxis)) > 0.01) continue;
      zAxis.crossVectors(xAxis, yAxis);
      mat.makeBasis(xAxis, yAxis, zAxis);
      rotations.push(new THREE.Quaternion().setFromRotationMatrix(mat).normalize());
    }
  }
  return rotations;
}

export const CUBE_ROTATIONS_24: readonly THREE.Quaternion[] = buildCubeGroupRotations();

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createPrng(seed: string): () => number {
  let state = hashSeed(seed || 'dice') || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Finds the nearest flat resting orientation (keeping natural yaw around world Y)
 * where one of the 6 local cube axes points straight up (0, 1, 0).
 */
function computeNearestFlatQuaternion(q: THREE.Quaternion): THREE.Quaternion {
  const localAxes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];

  let bestWorldNormal = new THREE.Vector3(0, 1, 0);
  let bestDot = -Infinity;

  for (const axis of localAxes) {
    const worldNormal = axis.clone().applyQuaternion(q);
    if (worldNormal.y > bestDot) {
      bestDot = worldNormal.y;
      bestWorldNormal = worldNormal;
    }
  }

  bestWorldNormal.normalize();
  const align = new THREE.Quaternion();
  if (bestWorldNormal.dot(WORLD_UP) < -0.9999) {
    align.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    align.setFromUnitVectors(bestWorldNormal, WORLD_UP);
  }

  return align.multiply(q).normalize();
}

/**
 * Finds a proper cube rotation R among the 24 group elements so that
 * (qEnd * R) * LOCAL_FACE_NORMALS[targetFace] === (0, 1, 0).
 */
function findRemapRotation(qEnd: THREE.Quaternion, targetFace: number): THREE.Quaternion {
  const localNormal = LOCAL_FACE_NORMALS[targetFace] ?? LOCAL_FACE_NORMALS[1];
  const candidate = new THREE.Quaternion();
  const transformed = new THREE.Vector3();

  let bestRot = CUBE_ROTATIONS_24[0];
  let bestDot = -Infinity;

  for (const r of CUBE_ROTATIONS_24) {
    candidate.copy(qEnd).multiply(r);
    transformed.copy(localNormal).applyQuaternion(candidate);
    if (transformed.y > bestDot) {
      bestDot = transformed.y;
      bestRot = r;
    }
  }
  return bestRot.clone();
}

/**
 * Deterministic 3D rigid-body simulation (cannon-es) of a single die tossed into
 * a velvet tray, with exact 24-element cube symmetry group remapping so
 * LOCAL_FACE_NORMALS[targetFace] points strictly straight up (0, 1, 0) on settle.
 */
export function simulateSingleDie(seed: string, targetFace: number): DiceSimulation {
  const safeFace = Math.min(6, Math.max(1, Math.round(targetFace)));
  const rng = createPrng(seed || 'dice');

  const world = new CANNON.World();
  world.gravity.set(0, -44, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  const groundMat = new CANNON.Material('ground');
  const wallMat = new CANNON.Material('wall');
  const diceMat = new CANNON.Material('dice');

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, groundMat, {
      restitution: 0.44,
      friction: 0.36,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, wallMat, {
      restitution: 0.56,
      friction: 0.14,
    }),
  );

  // Tray floor plane at y = 0
  const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // 4 invisible tray containment walls at x = ±1.45, z = ±1.05
  const wallSpecs: Array<{ pos: [number, number, number]; euler: [number, number, number] }> = [
    { pos: [1.45, 0, 0], euler: [0, -Math.PI / 2, 0] },
    { pos: [-1.45, 0, 0], euler: [0, Math.PI / 2, 0] },
    { pos: [0, 0, 1.05], euler: [0, Math.PI, 0] },
    { pos: [0, 0, -1.05], euler: [0, 0, 0] },
  ];
  for (const spec of wallSpecs) {
    const wall = new CANNON.Body({ mass: 0, material: wallMat });
    wall.addShape(new CANNON.Plane());
    wall.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    wall.quaternion.setFromEuler(spec.euler[0], spec.euler[1], spec.euler[2]);
    world.addBody(wall);
  }

  const randSpin = () => (rng() < 0.5 ? -1 : 1) * randRange(rng, 11, 19);
  const startX = randRange(rng, -0.72, 0.72);
  const startY = randRange(rng, 2.35, 3.05);
  const startZ = randRange(rng, -0.35, 0.35);

  const die = new CANNON.Body({
    mass: 1,
    material: diceMat,
    linearDamping: 0.16,
    angularDamping: 0.16,
  });
  die.addShape(new CANNON.Box(new CANNON.Vec3(DIE_HALF_EXTENT, DIE_HALF_EXTENT, DIE_HALF_EXTENT)));
  die.position.set(startX, startY, startZ);
  die.velocity.set(
    randRange(rng, -3.2, 3.2) - startX * 2.1,
    randRange(rng, 0.9, 2.5),
    randRange(rng, -2.4, 2.4) - startZ * 2.1,
  );
  die.angularVelocity.set(randSpin(), randSpin(), randSpin());
  die.quaternion.setFromEuler(
    randRange(rng, 0, Math.PI * 2),
    randRange(rng, 0, Math.PI * 2),
    randRange(rng, 0, Math.PI * 2),
  );
  world.addBody(die);

  const totalFrames = 72;
  const settleStart = 52;
  const settleFrame = 66;
  const bounceFrames: number[] = [];
  let lastBounceFrame = -10;
  let currentFrame = 0;

  die.addEventListener('collide', (ev: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    if (ev.body !== groundBody) return;
    const impactSpeed = Math.abs(ev.contact.getImpactVelocityAlongNormal());
    if (impactSpeed > 1.5 && currentFrame - lastBounceFrame >= 5 && currentFrame < settleStart) {
      bounceFrames.push(currentFrame);
      lastBounceFrame = currentFrame;
    }
  });

  const rawPos: THREE.Vector3[] = [];
  const rawQuat: THREE.Quaternion[] = [];

  for (let f = 0; f < totalFrames; f++) {
    currentFrame = f;
    if (f >= 48) {
      const t = (f - 47) / (totalFrames - 47);
      const damp = 0.16 + t * 0.74;
      die.linearDamping = damp;
      die.angularDamping = damp;
    }

    const prevVy = die.velocity.y;
    world.step(1 / 60);

    // Secondary bounce check in case contact impact velocity threshold was missed
    if (
      f < settleStart &&
      f - lastBounceFrame >= 5 &&
      prevVy < -2.2 &&
      die.velocity.y > -0.2 &&
      die.position.y <= DIE_HALF_EXTENT + 0.35
    ) {
      bounceFrames.push(f);
      lastBounceFrame = f;
    }

    rawPos.push(
      new THREE.Vector3(die.position.x, Math.max(DIE_HALF_EXTENT, die.position.y), die.position.z),
    );
    rawQuat.push(
      new THREE.Quaternion(
        die.quaternion.x,
        die.quaternion.y,
        die.quaternion.z,
        die.quaternion.w,
      ).normalize(),
    );
  }

  if (bounceFrames.length === 0) {
    bounceFrames.push(18);
  }

  // Smoothstep frames 52..66 onto exact flat resting orientation at y = DIE_HALF_EXTENT
  const qFlat = computeNearestFlatQuaternion(rawQuat[settleStart]);
  const restX = THREE.MathUtils.clamp(rawPos[settleFrame].x, -0.45, 0.45);
  const restZ = THREE.MathUtils.clamp(rawPos[settleFrame].z, -0.35, 0.35);

  for (let f = settleStart; f < totalFrames; f++) {
    if (f >= settleFrame) {
      rawPos[f].set(restX, DIE_HALF_EXTENT, restZ);
      rawQuat[f].copy(qFlat);
    } else {
      const alpha = smoothstep(settleStart, settleFrame, f);
      rawPos[f].x = THREE.MathUtils.lerp(rawPos[f].x, restX, alpha);
      rawPos[f].z = THREE.MathUtils.lerp(rawPos[f].z, restZ, alpha);
      rawPos[f].y = THREE.MathUtils.lerp(rawPos[f].y, DIE_HALF_EXTENT, alpha);
      rawQuat[f].slerp(qFlat, alpha).normalize();
    }
  }

  // Remap body faces via the 24-element cube symmetry group so targetFace points straight up (+Y)
  const remap = findRemapRotation(qFlat, safeFace);
  const frames: DiceFrame[] = rawPos.map((p, i) => {
    const q = rawQuat[i].clone().multiply(remap).normalize();
    return {
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w],
    };
  });

  return {
    frames,
    bounceFrames,
    settleFrame,
    durationMs: 1200,
  };
}

/**
 * Returns a resting quaternion with `face` pointing strictly up (+Y) and rotated
 * by `yawRad` around world Y (~24 deg by default) so the top face and two bevelled
 * side faces are clearly visible in 3D perspective.
 */
export function getRestingDieQuaternion(face: number, yawRad = 0.42): Quat {
  const safeFace = Math.min(6, Math.max(1, Math.round(face)));
  const localNormal = LOCAL_FACE_NORMALS[safeFace] ?? LOCAL_FACE_NORMALS[1];

  const align = new THREE.Quaternion();
  if (localNormal.dot(WORLD_UP) < -0.9999) {
    align.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    align.setFromUnitVectors(localNormal, WORLD_UP);
  }

  const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yawRad);
  const q = yaw.multiply(align).normalize();
  return [q.x, q.y, q.z, q.w];
}

/**
 * Builds a bevelled/rounded cube geometry preserving Three.js BoxGeometry's 6 material groups.
 */
export function createRoundedDieGeometry(
  size = 1.24,
  radius = 0.14,
  segments = 8,
): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const half = size * 0.5;
  const inner = half - radius;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      THREE.MathUtils.clamp(v.x, -inner, inner),
      THREE.MathUtils.clamp(v.y, -inner, inner),
      THREE.MathUtils.clamp(v.z, -inner, inner),
    );
    d.subVectors(v, c);
    if (d.lengthSq() > 1e-8) {
      d.normalize();
      pos.setXYZ(i, c.x + d.x * radius, c.y + d.y * radius, c.z + d.z * radius);
      norm.setXYZ(i, d.x, d.y, d.z);
    }
  }
  pos.needsUpdate = true;
  norm.needsUpdate = true;
  return geo;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Generates a high-DPI procedural ivory face texture with bevel rim, subtle
 * player-accent inner ring, and recessed shaded pips (crimson red 1 ace, espresso/slate 2-6).
 */
export function createDieFaceTexture(
  value: number,
  accentColor = '#d97706',
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Glossy warm ivory surface gradient
    const bgGrad = ctx.createRadialGradient(
      size * 0.32,
      size * 0.28,
      16,
      size * 0.5,
      size * 0.5,
      size * 0.74,
    );
    bgGrad.addColorStop(0, '#fffefb');
    bgGrad.addColorStop(0.62, '#fbf1dc');
    bgGrad.addColorStop(1, '#e2cca1');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle beveled outer rim shading
    const edgeGrad = ctx.createLinearGradient(0, 0, size, size);
    edgeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
    edgeGrad.addColorStop(0.5, 'rgba(176, 138, 30, 0.12)');
    edgeGrad.addColorStop(1, 'rgba(74, 44, 26, 0.26)');
    ctx.strokeStyle = edgeGrad;
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, size - 14, size - 14);

    // Subtle active-player accent inner ring
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 4.5;
    drawRoundedRectPath(ctx, 22, 22, size - 44, size - 44, 28);
    ctx.stroke();
    ctx.restore();

    // Recessed shaded pips
    const pips = PIP_COORDS[value] ?? PIP_COORDS[1];
    const pipRadius = value === 1 ? 31 : 21;
    for (const [px, py] of pips) {
      const cx = px * size;
      const cy = py * size;

      // Bottom highlight rim for recessed depth
      ctx.beginPath();
      ctx.arc(cx, cy + 2.5, pipRadius + 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 252, 240, 0.85)';
      ctx.fill();

      // Subtle upper inner socket shadow
      ctx.beginPath();
      ctx.arc(cx, cy - 1.2, pipRadius + 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(43, 29, 18, 0.32)';
      ctx.fill();

      // Pip body
      const pipGrad = ctx.createRadialGradient(
        cx - pipRadius * 0.22,
        cy - pipRadius * 0.22,
        pipRadius * 0.12,
        cx,
        cy,
        pipRadius,
      );
      if (value === 1) {
        pipGrad.addColorStop(0, '#f43f5e');
        pipGrad.addColorStop(0.62, '#dc2626');
        pipGrad.addColorStop(1, '#7f1d1d');
      } else {
        pipGrad.addColorStop(0, '#473328');
        pipGrad.addColorStop(0.68, '#1e120a');
        pipGrad.addColorStop(1, '#090503');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, pipRadius, 0, Math.PI * 2);
      ctx.fillStyle = pipGrad;
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
