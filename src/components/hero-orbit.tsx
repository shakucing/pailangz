"use client";

import { useEffect, useRef } from "react";

function mountOrbit(canvas: HTMLCanvasElement, THREE: typeof import("three")) {
  const host = canvas.parentElement;
  if (!host) return () => {};

  let renderer: InstanceType<typeof THREE.WebGLRenderer>;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return () => {};
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 7;

  const ringGroup = new THREE.Group();
  scene.add(ringGroup);

  function makeRing(
    radiusX: number,
    radiusY: number,
    rotation: [number, number, number],
  ) {
    const points = Array.from({ length: 180 }, (_, index) => {
      const angle = (index / 180) * Math.PI * 2;
      return new THREE.Vector3(
        Math.cos(angle) * radiusX,
        Math.sin(angle) * radiusY,
        0,
      );
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xa0323e,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const ring = new THREE.LineLoop(geometry, material);
    ring.rotation.set(...rotation);
    ringGroup.add(ring);
    return { geometry, material };
  }

  const rings = [
    makeRing(2.52, 1.76, [0.2, -0.2, 0.48]),
    makeRing(2.45, 1.39, [-0.24, 0.28, -0.57]),
  ];

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 128;
  const context = glowCanvas.getContext("2d");
  if (!context) {
    rings.forEach(({ geometry, material }) => {
      geometry.dispose();
      material.dispose();
    });
    renderer.dispose();
    return () => {};
  }
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.13, "rgba(255,255,255,.84)");
  gradient.addColorStop(0.46, "rgba(255,255,255,.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xf45462,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(1.35, 1.35, 1);

  const coreGeometry = new THREE.SphereGeometry(0.06, 12, 8);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffccd0,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  const orb = new THREE.Group();
  orb.position.z = 0.8;
  orb.add(glow, core);
  scene.add(orb);

  const trailPositions = new Float32Array(18 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  const trailAttribute = new THREE.BufferAttribute(trailPositions, 3);
  trailGeometry.setAttribute("position", trailAttribute);
  const trailMaterial = new THREE.LineBasicMaterial({
    color: 0xf45462,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const trail = new THREE.Line(trailGeometry, trailMaterial);
  scene.add(trail);

  const target = new THREE.Vector3(0, 0, 0.8);
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let hovered = false;
  let inView = true;
  let running = false;
  let lastFrame = 0;

  function render() {
    renderer.render(scene, camera);
  }

  function updatePalette() {
    const setting = document.documentElement.dataset.theme;
    const dark = setting === "dark" || (setting !== "light" && scheme.matches);
    rings[0].material.color.set(dark ? 0xa0323e : 0x86212c);
    rings[1].material.color.set(dark ? 0x852932 : 0x9d343d);
    glowMaterial.color.set(dark ? 0xf45462 : 0xa72f3d);
    coreMaterial.color.set(dark ? 0xffccd0 : 0x7b1827);
    trailMaterial.color.copy(glowMaterial.color);
    render();
  }

  function resize() {
    const width = host!.clientWidth;
    const height = host!.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  }

  function move(event: PointerEvent) {
    const bounds = host!.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
    const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * 7;
    target.set(
      x * Math.min(2.55, (visibleHeight * camera.aspect) / 2 - 0.3),
      y * Math.min(1.95, visibleHeight / 2 - 0.3),
      0.8,
    );
    hovered = true;
    if (reducedMotion.matches) {
      orb.position.copy(target);
      glowMaterial.opacity = 0.55;
      coreMaterial.opacity = 1;
      render();
    }
  }

  function leave() {
    hovered = false;
    target.set(0, 0, 0.8);
    if (reducedMotion.matches) {
      glowMaterial.opacity = 0;
      coreMaterial.opacity = 0;
      render();
    }
  }

  function animate(time: number) {
    const delta = Math.min((time - (lastFrame || time)) / 1000, 0.05);
    lastFrame = time;
    const ease = 1 - Math.exp(-11 * delta);
    orb.position.lerp(target, ease);
    ringGroup.rotation.x +=
      ((hovered ? target.y * 0.045 : 0) - ringGroup.rotation.x) * ease;
    ringGroup.rotation.y +=
      ((hovered ? target.x * 0.04 : 0) - ringGroup.rotation.y) * ease;
    ringGroup.rotation.z = Math.sin(time * 0.00022) * 0.026;
    for (const { material } of rings) {
      material.opacity += ((hovered ? 0.66 : 0.4) - material.opacity) * ease;
    }
    glowMaterial.opacity +=
      ((hovered ? 0.68 : 0) - glowMaterial.opacity) * ease;
    coreMaterial.opacity += ((hovered ? 1 : 0) - coreMaterial.opacity) * ease;
    trailMaterial.opacity +=
      ((hovered ? 0.32 : 0) - trailMaterial.opacity) * ease;
    for (let index = 17; index > 0; index--) {
      const offset = index * 3;
      const previous = offset - 3;
      trailPositions[offset] +=
        (trailPositions[previous] - trailPositions[offset]) * 0.34;
      trailPositions[offset + 1] +=
        (trailPositions[previous + 1] - trailPositions[offset + 1]) * 0.34;
      trailPositions[offset + 2] = 0.7;
    }
    trailPositions[0] = orb.position.x;
    trailPositions[1] = orb.position.y;
    trailPositions[2] = 0.7;
    trailAttribute.needsUpdate = true;
    render();
  }

  function syncAnimation() {
    const shouldRun = !reducedMotion.matches && inView && !document.hidden;
    if (shouldRun === running) return;
    running = shouldRun;
    lastFrame = 0;
    renderer.setAnimationLoop(shouldRun ? animate : null);
    if (!shouldRun) render();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncAnimation();
  });
  intersectionObserver.observe(host);
  const themeObserver = new MutationObserver(updatePalette);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", syncAnimation);
  scheme.addEventListener("change", updatePalette);
  reducedMotion.addEventListener("change", syncAnimation);
  resize();
  updatePalette();
  host.dataset.orbitReady = "true";
  syncAnimation();

  return () => {
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    themeObserver.disconnect();
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", syncAnimation);
    scheme.removeEventListener("change", updatePalette);
    reducedMotion.removeEventListener("change", syncAnimation);
    delete host.dataset.orbitReady;
    rings.forEach(({ geometry, material }) => {
      geometry.dispose();
      material.dispose();
    });
    glowTexture.dispose();
    glowMaterial.dispose();
    coreGeometry.dispose();
    coreMaterial.dispose();
    trailGeometry.dispose();
    trailMaterial.dispose();
    renderer.dispose();
  };
}

export function HeroOrbit() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("three")
      .then((THREE) => {
        if (!cancelled) dispose = mountOrbit(element, THREE);
      })
      .catch(() => {
        // The CSS orbit remains visible if WebGL cannot load.
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <canvas className="hero-orbit-canvas" ref={canvas} aria-hidden="true" />
  );
}
