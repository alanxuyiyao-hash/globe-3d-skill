import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGlobeStore } from './store';
import { latLngToVector3 } from './utils/geoUtils';
import {
  AUTO_ROTATE_SPEED,
  ATMOSPHERE_INNER_RADIUS,
  ATMOSPHERE_OUTER_RADIUS,
  ATMOSPHERE_ROTATE_SPEED,
  EARTH_TEXTURE_URL,
  categoryColor,
  GLOBE_RADIUS,
  GLOBE_SEGMENTS,
  GRID_RADIUS,
  MAX_ZOOM,
  MIN_ZOOM,
  MOUSE_ROTATE_FACTOR,
  MOUSE_ROTATE_LERP,
  STAR_ROTATE_SPEED,
  ZOOM_LERP,
} from './utils/constants';
import { UI_MARKER_LIMIT } from './utils/uiMetrics';
import { buildMarkerLocationLayouts, resolveDisplayLocation } from './utils/locationUtils';
import EventPanel, { EventDetailModal } from './components/EventPanel';
import type { CyberEvent } from '../types';

const createGlowTexture = () => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const gradient = context.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(132, 196, 255, 0.9)');
  gradient.addColorStop(0.35, 'rgba(79, 168, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(79, 168, 255, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
};

const createRadarTexture = () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const center = size / 2;
  const maxRadius = size * 0.39;

  context.clearRect(0, 0, size, size);
  context.translate(center, center);

  const baseGlow = context.createRadialGradient(0, 0, 0, 0, 0, maxRadius);
  baseGlow.addColorStop(0, 'rgba(255,255,255,0.34)');
  baseGlow.addColorStop(0.2, 'rgba(255,255,255,0.12)');
  baseGlow.addColorStop(0.55, 'rgba(255,255,255,0.04)');
  baseGlow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = baseGlow;
  context.beginPath();
  context.arc(0, 0, maxRadius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(255,255,255,0.22)';
  context.lineWidth = 1.8;
  [0.18, 0.34, 0.52, 0.72, 0.92].forEach((ratio) => {
    context.beginPath();
    context.arc(0, 0, maxRadius * ratio, 0, Math.PI * 2);
    context.stroke();
  });

  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 1;
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    context.beginPath();
    context.moveTo(Math.cos(angle) * maxRadius * 0.14, Math.sin(angle) * maxRadius * 0.14);
    context.lineTo(Math.cos(angle) * maxRadius, Math.sin(angle) * maxRadius);
    context.stroke();
  }

  const sweepGradient = context.createRadialGradient(0, 0, 0, 0, 0, maxRadius);
  sweepGradient.addColorStop(0, 'rgba(255,255,255,0.34)');
  sweepGradient.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  sweepGradient.addColorStop(1, 'rgba(255,255,255,0)');

  context.fillStyle = sweepGradient;
  context.beginPath();
  context.moveTo(0, 0);
  context.arc(0, 0, maxRadius, -0.18, 0.62);
  context.closePath();
  context.fill();

  context.strokeStyle = 'rgba(255,255,255,0.6)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(Math.cos(0.62) * maxRadius, Math.sin(0.62) * maxRadius);
  context.stroke();

  context.fillStyle = 'rgba(255,255,255,0.82)';
  context.beginPath();
  context.arc(0, 0, 8, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const CYLINDER_UP_AXIS = new THREE.Vector3(0, 1, 0);
const LOCAL_PULSE_KINDS = new Set([
  'pulse-runner',
]);
const placeBeamBetweenPoints = (mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3) => {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(direction.length(), 0.0001);
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(CYLINDER_UP_AXIS, direction.normalize());
};

const WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT_AXIS = new THREE.Vector3(1, 0, 0);

const buildSurfaceBasis = (normal: THREE.Vector3) => {
  const basisUp = Math.abs(normal.y) > 0.92 ? WORLD_RIGHT_AXIS : WORLD_UP_AXIS;
  const tangent = new THREE.Vector3().crossVectors(basisUp, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { tangent, bitangent };
};

const createLocationLabelElement = (
  label: string,
  count: number,
  accentColor: string,
  isApproximate: boolean,
) => {
  const root = document.createElement('div');
  root.className = `globe-location-tag${isApproximate ? ' is-approximate' : ''}`;

  const dot = document.createElement('span');
  dot.className = 'globe-location-dot';
  dot.style.background = accentColor;
  dot.style.boxShadow = `0 0 12px ${accentColor}88`;
  root.appendChild(dot);

  const text = document.createElement('span');
  text.className = 'globe-location-text';
  text.textContent = label;
  root.appendChild(text);

  if (count > 1) {
    const countBadge = document.createElement('span');
    countBadge.className = 'globe-location-count';
    countBadge.textContent = String(count);
    root.appendChild(countBadge);
  }

  if (isApproximate) {
    const approx = document.createElement('span');
    approx.className = 'globe-location-meta';
    approx.textContent = 'approx';
    root.appendChild(approx);
  }

  return root;
};

const rankMarkerEvents = (items: CyberEvent[]) => items
  .slice()
  .sort((left, right) => {
    if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
    return right.intensity - left.intensity;
  });


export default function GlobeApp() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const {
    events,
    filters,
    timeline,
    activeEventId,
    setSelectedEventId,
  } = useGlobeStore();

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const atmosphereOuterRef = useRef<THREE.Mesh | null>(null);
  const atmosphereInnerRef = useRef<THREE.Mesh | null>(null);
  const starFieldRef = useRef<THREE.Points | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const markerMapRef = useRef<Map<number, THREE.Group>>(new Map());
  const arcGroupRef = useRef<THREE.Group | null>(null);
  const earthTextureRef = useRef<THREE.Texture | null>(null);
  const haloSpriteRef = useRef<THREE.Sprite | null>(null);
  const glassShellRef = useRef<THREE.Mesh | null>(null);
  const radarTextureRef = useRef<THREE.Texture | null>(null);

  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const targetRotationRef = useRef({ x: -0.12, y: 3.7 });
  const currentRotationRef = useRef({ x: -0.12, y: 3.7 });
  const targetZoomRef = useRef(6.9);
  const currentZoomRef = useRef(6.9);
  const lastInteractionTimeRef = useRef(Date.now());

  const animateRef = useRef<number | null>(null);
  const markerAnimationDataRef = useRef<Map<number, { offset: number; ringPhases: number[] }>>(new Map());
  const activeEventIdRef = useRef<number | null>(activeEventId);
  const markerEventsRef = useRef<CyberEvent[]>([]);
  const featuredBeamEventIdRef = useRef<number | null>(null);
  const liveEventIdsRef = useRef<Set<number>>(new Set());
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const visibleEvents = useMemo(() => {
    if (timeline >= 100 || events.length === 0) return events;
    const times = events.filter((event) => event.hasTimestamp).map((event) => event.timestamp);
    if (!times.length) return events;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const cutoff = min + (max - min) * timeline / 100;
    return events.filter((event) => !event.hasTimestamp || event.timestamp <= cutoff);
  }, [events, timeline]);

  const markerEvents = useMemo(() => {
    if (filters.types.length === 0) return [];

    const ambientEvents = visibleEvents;
    return rankMarkerEvents(
      ambientEvents.filter((event) => filters.types.includes(event.type)),
    ).slice(0, UI_MARKER_LIMIT);
  }, [visibleEvents, filters.types]);

  const liveEvents = useMemo(() => {
    if (filters.types.length === 0) return [];

    return rankMarkerEvents(
      visibleEvents.filter((event) => filters.types.includes(event.type)),
    );
  }, [visibleEvents, filters.types]);

  const liveEventIds = useMemo(() => new Set(liveEvents.map((event) => event.id)), [liveEvents]);
  const markerLocationData = useMemo(() => buildMarkerLocationLayouts(markerEvents), [markerEvents]);
  const liveLocationData = useMemo(() => buildMarkerLocationLayouts(liveEvents), [liveEvents]);
  const labeledLocationKeys = useMemo(() => {
    const keys = new Set(liveLocationData.locations.slice(0, 14).map((location) => location.key));
    const activeKey = activeEventId != null ? markerLocationData.layoutByEventId.get(activeEventId)?.key : null;
    if (activeKey) keys.add(activeKey);
    return keys;
  }, [activeEventId, liveLocationData.locations, markerLocationData.layoutByEventId]);

  const featuredBeamEventId = useMemo(() => {
    if (activeEventId != null && markerEvents.some((event) => event.id === activeEventId)) {
      return activeEventId;
    }

    if (liveEvents.length > 0) return liveEvents[0].id;
    if (markerEvents.length > 0) return markerEvents[0].id;

    return null;
  }, [activeEventId, liveEvents, markerEvents]);

  useEffect(() => {
    markerEventsRef.current = markerEvents;
  }, [markerEvents]);

  useEffect(() => {
    activeEventIdRef.current = activeEventId;
  }, [activeEventId]);

  useEffect(() => {
    featuredBeamEventIdRef.current = featuredBeamEventId;
  }, [featuredBeamEventId]);

  useEffect(() => {
    liveEventIdsRef.current = liveEventIds;
  }, [liveEventIds]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const container = canvasRef.current;
    const markerMap = markerMapRef.current;
    const markerAnimationData = markerAnimationDataRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060915, 0.042);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      34,
      Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
      0.1,
      1000,
    );
    camera.position.set(0, 0, currentZoomRef.current);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.className = 'three-stage-canvas';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.className = 'three-stage-labels';
    container.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    scene.add(new THREE.AmbientLight(0x6d88c8, 0.34));

    const hemisphereLight = new THREE.HemisphereLight(0x9fbaf7, 0x02040a, 0.54);
    hemisphereLight.position.set(0, 10, 0);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xf4f8ff, 0.78);
    keyLight.position.set(6, 2, 7);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x6f98ff, 0.28);
    fillLight.position.set(-5, 1, 4);
    scene.add(fillLight);

    const cyanRimLight = new THREE.PointLight(0x57b9ff, 0.95, 30);
    cyanRimLight.position.set(-4, 3, 6);
    scene.add(cyanRimLight);

    const magentaAccentLight = new THREE.PointLight(0xff4b9d, 0.28, 24);
    magentaAccentLight.position.set(-3, 4, -2);
    scene.add(magentaAccentLight);

    const globeGroup = new THREE.Group();
    globeGroup.position.set(0.06, 0.08, 0);
    globeGroup.scale.setScalar(0.82);
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const earthGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, GLOBE_SEGMENTS, GLOBE_SEGMENTS);
    const earthMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02,
      emissive: new THREE.Color(0x02050b),
      emissiveIntensity: 0.08,
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    globeGroup.add(earthMesh);

    const glassShell = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS + 0.045, GLOBE_SEGMENTS, GLOBE_SEGMENTS),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x6fa7ff),
        transparent: true,
        opacity: 0.075,
        transmission: 0.72,
        thickness: 0.34,
        roughness: 0.12,
        metalness: 0,
        ior: 1.16,
        clearcoat: 1,
        clearcoatRoughness: 0.14,
        attenuationColor: new THREE.Color(0x2d6bff),
        attenuationDistance: 2.8,
        reflectivity: 0.38,
        depthWrite: false,
      }),
    );
    globeGroup.add(glassShell);
    glassShellRef.current = glassShell;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');
    textureLoader.load(
      EARTH_TEXTURE_URL,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        earthMaterial.map = texture;
        earthMaterial.bumpMap = texture;
        earthMaterial.bumpScale = 0.018;
        earthMaterial.needsUpdate = true;
        earthTextureRef.current = texture;
      },
      undefined,
      () => {
        earthMaterial.color = new THREE.Color(0x203451);
      },
    );

    const atmosphereOuter = new THREE.Mesh(
      new THREE.SphereGeometry(ATMOSPHERE_OUTER_RADIUS, GLOBE_SEGMENTS, GLOBE_SEGMENTS),
      new THREE.MeshBasicMaterial({
        color: 0x65b9ff,
        transparent: true,
        opacity: 0.14,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    globeGroup.add(atmosphereOuter);
    atmosphereOuterRef.current = atmosphereOuter;

    const atmosphereInner = new THREE.Mesh(
      new THREE.SphereGeometry(ATMOSPHERE_INNER_RADIUS, GLOBE_SEGMENTS, GLOBE_SEGMENTS),
      new THREE.MeshBasicMaterial({
        color: 0x2a86e8,
        transparent: true,
        opacity: 0.055,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    globeGroup.add(atmosphereInner);
    atmosphereInnerRef.current = atmosphereInner;

    const haloTexture = createGlowTexture();
    if (haloTexture) {
      haloTexture.colorSpace = THREE.SRGBColorSpace;
      const haloSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: 0x5fa9ff,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      haloSprite.scale.set(6, 6, 1);
      haloSprite.position.set(-0.02, -0.1, -0.5);
      scene.add(haloSprite);
      haloSpriteRef.current = haloSprite;
    }

    const radarTexture = createRadarTexture();
    if (radarTexture) {
      radarTexture.colorSpace = THREE.SRGBColorSpace;
      radarTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      radarTextureRef.current = radarTexture;
    }

    const markerGroup = new THREE.Group();
    globeGroup.add(markerGroup);
    markerGroupRef.current = markerGroup;

    const arcGroup = new THREE.Group();
    globeGroup.add(arcGroup);
    arcGroupRef.current = arcGroup;

    const gridLines = new THREE.Group();
    globeGroup.add(gridLines);

    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = (90 - lat) * (Math.PI / 180);
      const points: THREE.Vector3[] = [];
      for (let lng = 0; lng <= 360; lng += 6) {
        const theta = (lng + 180) * (Math.PI / 180);
        points.push(
          new THREE.Vector3(
            -(GRID_RADIUS * Math.sin(phi) * Math.cos(theta)),
            GRID_RADIUS * Math.cos(phi),
            GRID_RADIUS * Math.sin(phi) * Math.sin(theta),
          ),
        );
      }
      gridLines.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x4a77d7,
          transparent: true,
          opacity: 0.07,
          blending: THREE.AdditiveBlending,
        }),
      ));
    }

    for (let lng = 0; lng < 360; lng += 30) {
      const theta = (lng + 180) * (Math.PI / 180);
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 6) {
        const phi = (90 - lat) * (Math.PI / 180);
        points.push(
          new THREE.Vector3(
            -(GRID_RADIUS * Math.sin(phi) * Math.cos(theta)),
            GRID_RADIUS * Math.cos(phi),
            GRID_RADIUS * Math.sin(phi) * Math.sin(theta),
          ),
        );
      }
      gridLines.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x4a77d7,
          transparent: true,
          opacity: 0.07,
          blending: THREE.AdditiveBlending,
        }),
      ));
    }

    const STAR_COUNT = 1800;
    const starPositions = new Float32Array(STAR_COUNT * 3);
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const radius = 26 + Math.random() * 36;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[index * 3 + 2] = radius * Math.cos(phi);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xcad8ff,
        size: 0.075,
        transparent: true,
        opacity: 0.58,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    starField.position.z = -8;
    scene.add(starField);
    starFieldRef.current = starField;

    const resizeRenderer = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height, false);
      labelRendererRef.current?.setSize(width, height);
    };

    resizeRenderer();
    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(container);

    const handlePointerDown = (event: PointerEvent) => {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
      pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
      lastInteractionTimeRef.current = Date.now();
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    // Raycasting for marker click detection
    const raycaster = new THREE.Raycaster();
    const pointerVec = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      // Skip if it was a drag (moved more than 5px from pointer down)
      const downPos = pointerDownPosRef.current;
      if (downPos) {
        const dist = Math.sqrt((event.clientX - downPos.x) ** 2 + (event.clientY - downPos.y) ** 2);
        if (dist > 5) return;
      }
      if (!markerGroupRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerVec, camera);
      const intersects = raycaster.intersectObjects(markerGroupRef.current.children, true);

      if (intersects.length > 0) {
        // Walk up to find the top-level marker group
        let target: THREE.Object3D | null = intersects[0].object;
        while (target && target.parent !== markerGroupRef.current) {
          target = target.parent;
        }
        if (target) {
          const currentEvents = markerEventsRef.current;
          const foundEvent = currentEvents.find((evt) => {
            const marker = markerMapRef.current.get(evt.id);
            return marker === target;
          });
          if (foundEvent) {
            setSelectedEventId(foundEvent.id);
          }
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = event.clientX - previousMousePositionRef.current.x;
      const deltaY = event.clientY - previousMousePositionRef.current.y;
      targetRotationRef.current.y += deltaX * MOUSE_ROTATE_FACTOR;
      targetRotationRef.current.x += deltaY * MOUSE_ROTATE_FACTOR;
      targetRotationRef.current.x = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, targetRotationRef.current.x));
      previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
      lastInteractionTimeRef.current = Date.now();
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetZoomRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRef.current + event.deltaY * 0.001));
      lastInteractionTimeRef.current = Date.now();
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('click', handleClick);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('click', handleClick);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (animateRef.current !== null) cancelAnimationFrame(animateRef.current);

      earthGeometry.dispose();
      earthMaterial.dispose();
      glassShell.geometry.dispose();
      if (glassShell.material instanceof THREE.Material) glassShell.material.dispose();
      atmosphereOuter.geometry.dispose();
      if (atmosphereOuter.material instanceof THREE.Material) atmosphereOuter.material.dispose();
      atmosphereInner.geometry.dispose();
      if (atmosphereInner.material instanceof THREE.Material) atmosphereInner.material.dispose();
      starGeometry.dispose();
      if (starField.material instanceof THREE.Material) starField.material.dispose();
      earthTextureRef.current?.dispose();
      earthTextureRef.current = null;
      radarTextureRef.current?.dispose();
      radarTextureRef.current = null;

      if (haloSpriteRef.current?.material instanceof THREE.SpriteMaterial) {
        haloSpriteRef.current.material.map?.dispose();
        haloSpriteRef.current.material.dispose();
      }

      markerMap.forEach((marker) => {
        marker.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
            else child.material.dispose();
          }
        });
      });
      markerMap.clear();
      markerAnimationData.clear();

      gridLines.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });

      arcGroup.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });

      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (labelRendererRef.current && container.contains(labelRendererRef.current.domElement)) {
        container.removeChild(labelRendererRef.current.domElement);
      }
      labelRendererRef.current = null;
    };
  }, [setSelectedEventId]);

  const rebuildArcs = useCallback(() => {
    if (!arcGroupRef.current) return;

    while (arcGroupRef.current.children.length > 0) {
      const arc = arcGroupRef.current.children[0];
      arcGroupRef.current.remove(arc);
      if (arc instanceof THREE.Line) {
        arc.geometry.dispose();
        arc.material.dispose();
      }
    }
  }, []);

  const removeMarker = useCallback((eventId: number) => {
    const marker = markerMapRef.current.get(eventId);
    if (!marker || !markerGroupRef.current) return;

    markerGroupRef.current.remove(marker);
    marker.traverse((child) => {
      if (child instanceof CSS2DObject) child.element.remove();
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material.dispose();
      }
    });
    markerMapRef.current.delete(eventId);
    markerAnimationDataRef.current.delete(eventId);
  }, []);

  const addMarker = useCallback((event: CyberEvent) => {
    if (!markerGroupRef.current) return;
    if (markerMapRef.current.has(event.id)) removeMarker(event.id);

    const layout = markerLocationData.layoutByEventId.get(event.id) ?? {
      ...resolveDisplayLocation(event),
      clusterIndex: 0,
      clusterSize: 1,
      isLeader: true,
      locationCount: 1,
      clusterAngle: 0,
    };
    const markerColor = categoryColor(event.type);
    const accentColor = new THREE.Color(markerColor);
    const shellTint = accentColor.clone().lerp(new THREE.Color(0xf3fbff), 0.68);
    const isClusterLeader = layout.isLeader;
    const densityBoost = Math.min(Math.log2(layout.locationCount + 1), 3.4);
    const pulseScale = isClusterLeader ? 1.18 + densityBoost * 0.22 : 0.48;
    const markerGroup = new THREE.Group();
    const baseMarkerPosition = latLngToVector3(layout.lat, layout.lng, GLOBE_RADIUS + 0.004);
    const surfaceNormal = baseMarkerPosition.clone().normalize();
    const { tangent, bitangent } = buildSurfaceBasis(surfaceNormal);
    const clusterRadius = layout.clusterSize > 1
      ? Math.min(0.004 + Math.sqrt(layout.clusterIndex) * 0.0026, 0.018)
      : 0;
    const clusterOffset = tangent.clone().multiplyScalar(Math.cos(layout.clusterAngle) * clusterRadius)
      .add(bitangent.clone().multiplyScalar(Math.sin(layout.clusterAngle) * clusterRadius))
      .add(surfaceNormal.clone().multiplyScalar(isClusterLeader ? 0 : clusterRadius * 0.14));
    markerGroup.position.copy(baseMarkerPosition.clone().add(clusterOffset));
    markerGroup.lookAt(new THREE.Vector3(0, 0, 0));

    const orbCenter = new THREE.Vector3(0, 0, isClusterLeader ? 0.012 : 0.009);
    const beamVector = new THREE.Vector3(
      0,
      0,
      isClusterLeader ? 0.188 + densityBoost * 0.012 : 0.052,
    );
    const beamStart = orbCenter.clone().add(new THREE.Vector3(0, 0, 0.004));
    const beamEnd = orbCenter.clone().add(beamVector);

    if (isClusterLeader) {
      const hitTarget = new THREE.Mesh(
        new THREE.SphereGeometry(0.05 + densityBoost * 0.006, 18, 18),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
        }),
      );
      hitTarget.position.copy(orbCenter);
      hitTarget.userData.kind = 'hit-target';
      markerGroup.add(hitTarget);
    }

    const surfaceGlow = new THREE.Mesh(
      isClusterLeader
        ? new THREE.RingGeometry(0.026, 0.056 + densityBoost * 0.004, 56)
        : new THREE.CircleGeometry(0.014, 24),
      new THREE.MeshBasicMaterial({
        color: markerColor,
        transparent: true,
        opacity: isClusterLeader ? 0.13 : 0.08,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    surfaceGlow.position.z = 0.001;
    surfaceGlow.userData.kind = 'surface-glow';
    surfaceGlow.scale.setScalar(isClusterLeader ? pulseScale * 1.38 : pulseScale * 0.7);
    surfaceGlow.userData.baseScale = surfaceGlow.scale.clone();
    surfaceGlow.renderOrder = 18;
    markerGroup.add(surfaceGlow);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.0052, 14, 14),
      new THREE.MeshBasicMaterial({
        color: markerColor,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    core.position.copy(orbCenter);
    core.userData.kind = 'core';
    core.scale.setScalar(isClusterLeader ? pulseScale * 0.96 : pulseScale * 0.9);
    core.userData.baseScale = core.scale.clone();
    core.renderOrder = 27;
    markerGroup.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(isClusterLeader ? 0.03 : 0.012, 20, 20),
      new THREE.MeshBasicMaterial({
        color: markerColor,
        transparent: true,
        opacity: isClusterLeader ? 0.14 : 0.08,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.position.copy(orbCenter);
    halo.userData.kind = 'halo';
    halo.scale.setScalar(isClusterLeader ? pulseScale * 1.34 : pulseScale * 0.76);
    halo.userData.baseScale = halo.scale.clone();
    halo.renderOrder = 23;
    markerGroup.add(halo);

    if (isClusterLeader) {
      const glassOrbCore = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 28, 28),
        new THREE.MeshStandardMaterial({
          color: shellTint,
          emissive: accentColor.clone().multiplyScalar(0.92),
          emissiveIntensity: 0.9,
          roughness: 0.14,
          metalness: 0.02,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      );
      glassOrbCore.position.copy(orbCenter.clone().add(new THREE.Vector3(0, 0, 0.003)));
      glassOrbCore.userData.kind = 'glass-orb-core';
      glassOrbCore.scale.set(pulseScale * 1.26, pulseScale * 1.26, pulseScale * 0.96);
      glassOrbCore.userData.baseScale = glassOrbCore.scale.clone();
      glassOrbCore.renderOrder = 25;
      markerGroup.add(glassOrbCore);

      const glassOrbShell = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 28, 28),
        new THREE.MeshPhysicalMaterial({
          color: shellTint,
          emissive: accentColor.clone().multiplyScalar(0.22),
          emissiveIntensity: 0.3,
          transparent: true,
          opacity: 0.29,
          transmission: 0.94,
          thickness: 0.24,
          roughness: 0.04,
          metalness: 0.01,
          ior: 1.16,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          reflectivity: 0.7,
          depthWrite: false,
        }),
      );
      glassOrbShell.position.copy(orbCenter.clone().add(new THREE.Vector3(0, 0, 0.002)));
      glassOrbShell.userData.kind = 'glass-orb-shell';
      glassOrbShell.scale.set(pulseScale * 1.42, pulseScale * 1.42, pulseScale * 0.82);
      glassOrbShell.userData.baseScale = glassOrbShell.scale.clone();
      glassOrbShell.renderOrder = 24;
      markerGroup.add(glassOrbShell);

      const orbitRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.034 + densityBoost * 0.002, 0.0018, 12, 80),
        new THREE.MeshBasicMaterial({
          color: shellTint,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      orbitRing.position.copy(orbCenter);
      orbitRing.userData.kind = 'orbit-ring';
      orbitRing.scale.setScalar(pulseScale * 1.18);
      orbitRing.userData.baseScale = orbitRing.scale.clone();
      orbitRing.renderOrder = 22;
      markerGroup.add(orbitRing);

      const orbitRingOuter = new THREE.Mesh(
        new THREE.TorusGeometry(0.047 + densityBoost * 0.003, 0.0013, 12, 80),
        new THREE.MeshBasicMaterial({
          color: shellTint,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      orbitRingOuter.position.copy(orbCenter);
      orbitRingOuter.userData.kind = 'orbit-ring-secondary';
      orbitRingOuter.scale.setScalar(pulseScale * 1.14);
      orbitRingOuter.userData.baseScale = orbitRingOuter.scale.clone();
      orbitRingOuter.renderOrder = 21;
      markerGroup.add(orbitRingOuter);
    }

    if (isClusterLeader) {
      const beamGlow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0028 + densityBoost * 0.00016, 0.0032 + densityBoost * 0.00018, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      placeBeamBetweenPoints(beamGlow, beamStart, beamEnd);
      beamGlow.userData.kind = 'beam-glow';
      beamGlow.renderOrder = 25;
      markerGroup.add(beamGlow);

      const beamCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.001 + densityBoost * 0.00008, 0.00125 + densityBoost * 0.00008, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          transparent: true,
          opacity: 0.94,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      placeBeamBetweenPoints(beamCore, beamStart, beamEnd);
      beamCore.userData.kind = 'beam-core';
      beamCore.renderOrder = 26;
      markerGroup.add(beamCore);

      const topNode = new THREE.Mesh(
        new THREE.SphereGeometry(0.0058 + densityBoost * 0.0005, 14, 14),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      topNode.position.copy(beamEnd);
      topNode.userData.kind = 'top-node';
      topNode.scale.setScalar(1 + densityBoost * 0.08);
      topNode.userData.baseScale = topNode.scale.clone();
      topNode.renderOrder = 28;
      markerGroup.add(topNode);

      const pulseRunner = new THREE.Mesh(
        new THREE.SphereGeometry(0.0043 + densityBoost * 0.0004, 10, 10),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      pulseRunner.position.copy(beamStart);
      pulseRunner.userData.kind = 'pulse-runner';
      pulseRunner.userData.start = beamStart.clone();
      pulseRunner.userData.end = beamEnd.clone();
      pulseRunner.renderOrder = 30;
      markerGroup.add(pulseRunner);
    }

    if (layout.isLeader && labeledLocationKeys.has(layout.key)) {
      const labelDirection = new THREE.Vector3(
        Math.cos(layout.clusterAngle || 0) * 0.028,
        Math.sin(layout.clusterAngle || 0) * 0.016,
        0,
      );
      const locationLabel = createLocationLabelElement(
        layout.label,
        layout.locationCount,
        `#${markerColor.toString(16).padStart(6, '0')}`,
        layout.isApproximate,
      );
      const locationLabelObject = new CSS2DObject(locationLabel);
      locationLabelObject.position.copy(
        beamEnd.clone().add(labelDirection).add(new THREE.Vector3(0, 0.01, 0.012)),
      );
      locationLabelObject.name = 'location-label';
      markerGroup.add(locationLabelObject);
    }

    markerGroupRef.current.add(markerGroup);
    markerMapRef.current.set(event.id, markerGroup);
    markerAnimationDataRef.current.set(event.id, {
      offset: Math.random() * Math.PI * 2,
      ringPhases: Array.from({ length: 3 }, (_, index) => (index / 3) * Math.PI * 2),
    });
  }, [labeledLocationKeys, markerLocationData.layoutByEventId, removeMarker]);

  useEffect(() => {
    // Rebuild the bounded marker layer so changed coordinates/category for an existing ID
    // are reflected on file replacement and API refresh.
    [...markerMapRef.current.keys()].forEach(removeMarker);
    markerEvents.forEach(addMarker);

    rebuildArcs();
  }, [addMarker, markerEvents, rebuildArcs, removeMarker]);

  useEffect(() => {
    if (activeEventId == null) return;

    const event = events.find((item) => item.id === activeEventId);
    if (!event) return;

    const focusLocation = resolveDisplayLocation(event);
    const point = latLngToVector3(focusLocation.lat, focusLocation.lng, GLOBE_RADIUS).normalize();
    const front = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(point, front);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');

    targetRotationRef.current.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 2.3, Math.PI / 2.3);
    targetRotationRef.current.y = euler.y;
    lastInteractionTimeRef.current = Date.now();
  }, [activeEventId, events]);

  useEffect(() => {
    const animate = () => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const labelRenderer = labelRendererRef.current;
      const globeGroup = globeGroupRef.current;
      const glassShell = glassShellRef.current;
      const atmosphereOuter = atmosphereOuterRef.current;
      const atmosphereInner = atmosphereInnerRef.current;
      const starField = starFieldRef.current;

      if (!scene || !camera || !renderer) return;

      const now = Date.now();
      const time = now * 0.001;
      if (now - lastInteractionTimeRef.current > 1_200) {
        targetRotationRef.current.y += AUTO_ROTATE_SPEED * 0.8;
      }

      currentRotationRef.current.x += (targetRotationRef.current.x - currentRotationRef.current.x) * MOUSE_ROTATE_LERP;
      currentRotationRef.current.y += (targetRotationRef.current.y - currentRotationRef.current.y) * MOUSE_ROTATE_LERP;

      if (globeGroup) {
        globeGroup.rotation.x = currentRotationRef.current.x;
        globeGroup.rotation.y = currentRotationRef.current.y;
        globeGroup.rotation.z = Math.sin(time * 0.18) * 0.04;
        globeGroup.position.y = 0.08 + Math.sin(time * 0.35) * 0.03;
      }

      if (glassShell?.material instanceof THREE.MeshPhysicalMaterial) {
        glassShell.rotation.y -= 0.0008;
        glassShell.material.opacity = 0.12 + Math.sin(time * 0.9) * 0.015;
      }

      if (atmosphereOuter?.material instanceof THREE.MeshBasicMaterial) {
        atmosphereOuter.rotation.y += ATMOSPHERE_ROTATE_SPEED * 0.8;
        atmosphereOuter.material.opacity = 0.16 + Math.sin(time * 1.2) * 0.03;
      }

      if (atmosphereInner?.material instanceof THREE.MeshBasicMaterial) {
        atmosphereInner.rotation.y -= ATMOSPHERE_ROTATE_SPEED * 0.55;
        atmosphereInner.material.opacity = 0.08 + Math.sin(time * 0.8) * 0.015;
      }

      if (haloSpriteRef.current?.material instanceof THREE.SpriteMaterial) {
        haloSpriteRef.current.material.opacity = 0.24 + Math.sin(time * 0.75) * 0.04;
      }

      if (starField) {
        starField.rotation.y += STAR_ROTATE_SPEED * 0.55;
        starField.rotation.x = Math.sin(time * 0.05) * 0.08;
      }

      arcGroupRef.current?.children.forEach((arc) => {
        if (arc instanceof THREE.Line && arc.material instanceof THREE.LineBasicMaterial) {
          const offset = arc.userData.offset ?? 0;
          arc.material.opacity = 0.22 + (Math.sin(time * 1.7 + offset) + 1) * 0.08;
        }
      });

      markerMapRef.current.forEach((marker, eventId) => {
        const animationData = markerAnimationDataRef.current.get(eventId);
        if (!animationData) return;
        const isLiveHotspot = liveEventIdsRef.current.has(eventId);
        const opacityMultiplier = isLiveHotspot ? 1 : 0.52;
        const showLocalPulse = featuredBeamEventIdRef.current === eventId;

        // Back-face culling: hide markers on the far side of the globe
        const markerWorldPos = new THREE.Vector3();
        marker.getWorldPosition(markerWorldPos);
        const cameraDir = markerWorldPos.clone().sub(camera.position).normalize();
        const surfaceNormal = markerWorldPos.clone().normalize();
        const dotProduct = cameraDir.dot(surfaceNormal);
        const isFrontFacing = dotProduct < 0.15; // visible from camera side
        marker.visible = isFrontFacing;

        if (!isFrontFacing) return; // skip animation for hidden markers

        marker.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const basicMaterial = child.material instanceof THREE.MeshBasicMaterial ? child.material : null;
          const standardMaterial = child.material instanceof THREE.MeshStandardMaterial ? child.material : null;
          const physicalMaterial = child.material instanceof THREE.MeshPhysicalMaterial ? child.material : null;
          if (!basicMaterial && !standardMaterial && !physicalMaterial) return;

          const setOpacity = (value: number) => {
            if (basicMaterial) basicMaterial.opacity = value;
            if (standardMaterial) standardMaterial.opacity = value;
            if (physicalMaterial) physicalMaterial.opacity = value;
          };

          const kind = child.userData.kind as string | undefined;

          if (kind && LOCAL_PULSE_KINDS.has(kind)) {
            child.visible = showLocalPulse;
            if (!showLocalPulse) return;
          } else {
            child.visible = true;
          }

          switch (kind) {
            case 'core':
              {
                const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
                const scalePulse = 1 + Math.sin(time * 3.1 + animationData.offset) * 0.05;
                if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z * scalePulse);
                else child.scale.setScalar(scalePulse);
              }
              setOpacity(Math.min(1, (0.78 + (Math.sin(time * 3.2 + animationData.offset) + 1) * 0.08) * Math.max(opacityMultiplier, 0.82)));
              break;
            case 'glass-orb-core': {
              const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
              const scalePulse = 1 + Math.sin(time * 1.8 + animationData.offset) * 0.035;
              if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z * scalePulse);
              else child.scale.setScalar(scalePulse);
              setOpacity((0.62 + (Math.sin(time * 1.8 + animationData.offset) + 1) * 0.05) * Math.max(opacityMultiplier, 0.84));
              if (standardMaterial) {
                standardMaterial.emissiveIntensity = 0.66 + (Math.sin(time * 2 + animationData.offset) + 1) * 0.08;
              }
              break;
            }
            case 'glass-orb-shell': {
              const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
              const scalePulse = 1 + Math.sin(time * 1.45 + animationData.offset) * 0.025;
              if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z * scalePulse);
              else child.scale.setScalar(scalePulse);
              setOpacity((0.18 + (Math.sin(time * 1.45 + animationData.offset) + 1) * 0.04) * Math.max(opacityMultiplier, 0.8));
              if (physicalMaterial) {
                physicalMaterial.emissiveIntensity = 0.22 + (Math.sin(time * 1.7 + animationData.offset) + 1) * 0.03;
              }
              break;
            }
            case 'halo': {
              const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
              const scalePulse = 1 + Math.sin(time * 1.9 + animationData.offset) * 0.08;
              if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z * scalePulse);
              else child.scale.setScalar(scalePulse);
              setOpacity((0.08 + (Math.sin(time * 2.1 + animationData.offset) + 1) * 0.035) * Math.max(opacityMultiplier, 0.74));
              break;
            }
            case 'orbit-ring':
              child.rotation.z = time * 0.42 + animationData.offset * 0.2;
              {
                const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
                if (baseScale) child.scale.copy(baseScale);
              }
              setOpacity((0.11 + (Math.sin(time * 1.55 + animationData.offset) + 1) * 0.03) * Math.max(opacityMultiplier, 0.78));
              break;
            case 'orbit-ring-secondary':
              child.rotation.z = -(time * 0.28 + animationData.offset * 0.24);
              {
                const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
                if (baseScale) child.scale.copy(baseScale);
              }
              setOpacity((0.07 + (Math.sin(time * 1.3 + animationData.offset) + 1) * 0.025) * Math.max(opacityMultiplier, 0.72));
              break;
            case 'beam-glow':
              setOpacity((0.16 + (Math.sin(time * 1.8 + animationData.offset) + 1) * 0.06) * Math.max(opacityMultiplier, 0.84));
              break;
            case 'beam-core':
              setOpacity((0.62 + (Math.sin(time * 2.3 + animationData.offset) + 1) * 0.12) * Math.max(opacityMultiplier, 0.88));
              break;
            case 'top-node':
              {
                const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
                const scalePulse = 1 + Math.sin(time * 3.1 + animationData.offset) * 0.08;
                if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z * scalePulse);
                else child.scale.setScalar(scalePulse);
              }
              setOpacity(Math.min(1, (0.68 + (Math.sin(time * 2.8 + animationData.offset) + 1) * 0.12) * Math.max(opacityMultiplier, 0.86)));
              break;
            case 'pulse-runner': {
              const start = child.userData.start as THREE.Vector3 | undefined;
              const end = child.userData.end as THREE.Vector3 | undefined;
              if (start && end) {
                const progress = (time * 0.8 + animationData.offset * 0.2) % 1;
                child.position.copy(start).lerp(end, progress);
                child.scale.setScalar(1 + Math.sin(time * 4.2 + animationData.offset) * 0.12);
                setOpacity(Math.min(1, 0.7 + Math.sin(progress * Math.PI) * 0.22));
              }
              break;
            }
            case 'surface-glow': {
              const baseScale = child.userData.baseScale as THREE.Vector3 | undefined;
              const scalePulse = 1 + Math.sin(time * 1.6 + animationData.offset) * 0.14;
              if (baseScale) child.scale.set(baseScale.x * scalePulse, baseScale.y * scalePulse, baseScale.z);
              else child.scale.set(scalePulse, scalePulse, 1);
              setOpacity((0.08 + (Math.sin(time * 1.4 + animationData.offset) + 1) * 0.04) * Math.max(opacityMultiplier, 0.74));
              break;
            }
            default:
              break;
          }
        });
      });

      currentZoomRef.current += (targetZoomRef.current - currentZoomRef.current) * ZOOM_LERP;
      camera.position.z = currentZoomRef.current;
      camera.lookAt(0.1, 0.06, 0);

      renderer.render(scene, camera);
      labelRenderer?.render(scene, camera);
      animateRef.current = requestAnimationFrame(animate);
    };

    animateRef.current = requestAnimationFrame(animate);
    return () => {
      if (animateRef.current !== null) cancelAnimationFrame(animateRef.current);
    };
  }, []);

  return (
    <div className="desktop-shell">
      <div className="product-window">
        <div className="app-stage app-stage--standalone">
          <div className="scene-backdrop-glow" />
          <div ref={canvasRef} className="scene-canvas" />
          <div className="scene-grid-overlay" />
          <div className="scanline-overlay" />
          <EventPanel />
          <EventDetailModal />
        </div>
      </div>
    </div>
  );
}
