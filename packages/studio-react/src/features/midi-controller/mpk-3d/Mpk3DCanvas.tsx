import { MPK_MINI_MK3_LAYOUT } from '@studio/midi-akai-mpk-mini-mk3';
import { useEffect, useRef, useState } from 'react';
import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MOUSE,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildMpkScene, type ActivityMap } from './scene';

export interface CameraPose {
  /** Elevation above the panel in degrees (90 = straight down). */
  readonly elevationDeg: number;
  /** Rotation around the vertical axis in degrees (0 = from the front). */
  readonly azimuthDeg: number;
}

const DEFAULT_POSE: CameraPose = { elevationDeg: 50, azimuthDeg: 0 };
const FOV = 32;
/** Point the camera orbits around (slightly towards the keybed). */
const TARGET = new Vector3(0, 0, 0.25);

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Renderer, camera and controls around the procedural model. Independent of the Studio
 * session: live activity is pulled through `readActivity` every frame.
 */
export function Mpk3DCanvas({
  className,
  readActivity,
  pose = DEFAULT_POSE,
}: {
  className?: string | undefined;
  readActivity: () => ActivityMap;
  pose?: CameraPose;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readRef = useRef(readActivity);
  const [failed, setFailed] = useState(() => !webglAvailable());

  useEffect(() => {
    readRef.current = readActivity;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || failed) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      // Context creation can still fail (blocklisted GPU, too many contexts).
      queueMicrotask(() => setFailed(true));
      return;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    const scene = new Scene();
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT);
    scene.add(model.root);

    const hemi = new HemisphereLight(0xf2f3ff, 0x1a1b22, 1.4);
    scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 14, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    const cam = key.shadow.camera;
    cam.left = -8;
    cam.right = 8;
    cam.top = 6;
    cam.bottom = -6;
    cam.near = 1;
    cam.far = 30;
    scene.add(key);
    const rim = new DirectionalLight(0xb9b0ff, 0.6);
    rim.position.set(6, 5, -8);
    scene.add(rim);

    // Soft contact shadow on an otherwise invisible floor.
    const floorGeo = new PlaneGeometry(40, 40);
    const floorMat = new ShadowMaterial({ opacity: 0.35 });
    const floor = new Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.92;
    floor.receiveShadow = true;
    scene.add(floor);

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(TARGET);
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = (70 * Math.PI) / 180;
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };

    let userMoved = false;
    let dirty = true;
    const onStart = () => {
      userMoved = true;
    };
    const onChange = () => {
      dirty = true;
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('change', onChange);

    /** Distance that fits the device into the viewport at the given aspect. */
    const fitDistance = (aspect: number) => {
      const vFov = (FOV * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const radiusW = (model.width / 2) * 1.1;
      const radiusD = (model.depth / 2) * 1.12 + Math.abs(TARGET.z);
      return Math.max(radiusW / Math.tan(hFov / 2), radiusD / Math.tan(vFov / 2)) + 0.6;
    };

    const placeCamera = (aspect: number) => {
      const dist = fitDistance(aspect);
      const el = (pose.elevationDeg * Math.PI) / 180;
      const az = (pose.azimuthDeg * Math.PI) / 180;
      camera.position.set(
        TARGET.x + Math.sin(az) * Math.cos(el) * dist,
        TARGET.y + Math.sin(el) * dist,
        TARGET.z + Math.cos(az) * Math.cos(el) * dist,
      );
      camera.lookAt(TARGET);
      controls.minDistance = dist * 0.5;
      controls.maxDistance = dist * 1.6;
      controls.update();
    };

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!userMoved) placeCamera(camera.aspect);
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let raf = 0;
    let last = performance.now();
    let moving = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (model.applyActivity(readRef.current())) moving = true;
      if (moving) {
        moving = model.step(dt, reducedMotion);
        dirty = true;
      }
      if (controls.update()) dirty = true;
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('change', onChange);
      controls.dispose();
      model.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      key.shadow.map?.dispose();
      key.dispose();
      rim.dispose();
      hemi.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [pose, failed]);

  if (failed) {
    return (
      <div
        className={className}
        role="status"
        style={{ display: 'grid', placeItems: 'center', color: '#8f95a1', fontSize: 12 }}
      >
        3D view unavailable: this browser has no WebGL.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={className}
      role="img"
      aria-label="3D model of the AKAI Professional MPK Mini MK3. Drag to orbit, scroll to zoom."
      data-testid="mpk-3d-view"
      style={{ position: 'relative', minHeight: 0, touchAction: 'none' }}
    />
  );
}
