import * as THREE from './vendor/three/three.module.min.js';

// Local geometry and lighting keep the scene independent of remote assets.
let currentScene;
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function createScene(host) {
  const shell = host.closest('[data-scene-shell]') || host.parentElement;
  host.querySelectorAll('.aman-scene-canvas').forEach(canvas => canvas.remove());
  const fallback = host.querySelector('[data-scene-fallback]');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    host.dataset.sceneReady = 'false';
    shell.querySelectorAll('[data-scene-turn], [data-scene-reset], [data-scene-motion]').forEach(button => { button.disabled = true; });
    return { host, dispose() {} };
  }

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.className = 'aman-scene-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbdb2d6, 1.8));
  const key = new THREE.DirectionalLight(0xfff6ed, 3.2);
  key.position.set(-3.5, 6, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 18 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 8;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd8ccff, 2);
  rim.position.set(5, 2, -3);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(1, -1, 5);
  scene.add(fill);

  const colors = { purple: 0x7555cf, purpleEdge: 0x6546b4, lilac: 0xc5b4ed, cream: 0xf5f0e7, mint: 0xb5ddcb, green: 0x3b776b, peach: 0xffb99a, peachEdge: 0xe99a82, gold: 0xe8c478 };
  const materials = {};
  for (const [name, color] of Object.entries(colors)) {
    materials[name] = new THREE.MeshStandardMaterial({ color, roughness: name === 'purple' ? 0.3 : 0.4, metalness: name === 'gold' ? 0.2 : 0.03 });
  }
  const mesh = (geometry, material, parent = world) => {
    const item = new THREE.Mesh(geometry, material);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  };
  const extrude = (shape, depth, material, parent, bevel = 0.08) => mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 24, steps: 1 }), material, parent);

  const stage = new THREE.Group();
  world.add(stage);
  const lower = mesh(new THREE.CylinderGeometry(1.82, 1.89, 0.22, 80), materials.cream, stage);
  lower.position.y = -1.71;
  const upper = mesh(new THREE.CylinderGeometry(1.66, 1.73, 0.18, 80), materials.lilac, stage);
  upper.position.y = -1.52;
  const rimRing = mesh(new THREE.TorusGeometry(1.64, 0.027, 10, 80), materials.cream, stage);
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = -1.421;

  const shield = new THREE.Group();
  shield.rotation.set(0.025, -0.28, -0.055);
  shield.position.set(-0.05, 0.15, 0.1);
  world.add(shield);
  const shieldShape = new THREE.Shape();
  shieldShape.moveTo(0, 1.22);
  shieldShape.bezierCurveTo(0.35, 1.15, 0.7, 1.04, 0.94, 0.93);
  shieldShape.lineTo(0.88, -0.12);
  shieldShape.bezierCurveTo(0.86, -0.62, 0.39, -1.07, 0, -1.28);
  shieldShape.bezierCurveTo(-0.39, -1.07, -0.86, -0.62, -0.88, -0.12);
  shieldShape.lineTo(-0.94, 0.93);
  shieldShape.bezierCurveTo(-0.7, 1.04, -0.35, 1.15, 0, 1.22);
  const body = extrude(shieldShape, 0.31, [materials.purple, materials.purpleEdge], shield, 0.12);
  body.position.z = -0.17;
  const inset = extrude(shieldShape, 0.02, materials.purple, shield, 0.055);
  inset.scale.set(0.86, 0.86, 1);
  inset.position.z = 0.23;

  const tickShape = new THREE.Shape();
  tickShape.moveTo(-0.53, 0.03);
  tickShape.lineTo(-0.15, -0.36);
  tickShape.quadraticCurveTo(-0.10, -0.4, -0.05, -0.34);
  tickShape.lineTo(0.59, 0.38);
  tickShape.lineTo(0.41, 0.54);
  tickShape.lineTo(-0.13, -0.06);
  tickShape.lineTo(-0.37, 0.2);
  tickShape.closePath();
  const tick = extrude(tickShape, 0.065, materials.mint, shield, 0.045);
  tick.position.set(0, 0.07, 0.35);

  const heart = new THREE.Group();
  heart.position.set(-1.76, 1.03, 0.22);
  heart.rotation.set(-0.05, 0.25, 0.18);
  world.add(heart);
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.65);
  heartShape.bezierCurveTo(-0.2, -0.44, -0.72, -0.08, -0.72, 0.28);
  heartShape.bezierCurveTo(-0.72, 0.77, -0.17, 0.9, 0, 0.47);
  heartShape.bezierCurveTo(0.17, 0.9, 0.72, 0.77, 0.72, 0.28);
  heartShape.bezierCurveTo(0.72, -0.08, 0.2, -0.44, 0, -0.65);
  const heartBody = extrude(heartShape, 0.2, [materials.peach, materials.peachEdge], heart, 0.095);
  heartBody.scale.setScalar(0.55);

  const chat = new THREE.Group();
  chat.position.set(1.57, 0.02, 0.35);
  chat.rotation.set(0.04, -0.24, -0.15);
  world.add(chat);
  const chatShape = new THREE.Shape();
  chatShape.moveTo(-0.49, 0.42);
  chatShape.lineTo(0.49, 0.42);
  chatShape.quadraticCurveTo(0.65, 0.42, 0.65, 0.26);
  chatShape.lineTo(0.65, -0.24);
  chatShape.quadraticCurveTo(0.65, -0.4, 0.49, -0.4);
  chatShape.lineTo(-0.15, -0.4);
  chatShape.lineTo(-0.43, -0.62);
  chatShape.lineTo(-0.43, -0.4);
  chatShape.lineTo(-0.49, -0.4);
  chatShape.quadraticCurveTo(-0.65, -0.4, -0.65, -0.24);
  chatShape.lineTo(-0.65, 0.26);
  chatShape.quadraticCurveTo(-0.65, 0.42, -0.49, 0.42);
  extrude(chatShape, 0.19, materials.mint, chat, 0.07);
  for (let i = -1; i <= 1; i++) {
    const dot = mesh(new THREE.SphereGeometry(0.077, 16, 12), materials.green, chat);
    dot.position.set(i * 0.25, 0.015, 0.27);
    dot.scale.z = 0.42;
  }

  const satellites = [];
  for (const [x, y, z, size, color] of [[1.6, 1.54, -0.15, 0.16, 'lilac'], [-1.68, -0.58, 0.72, 0.14, 'gold'], [0.75, -1.24, 1.1, 0.12, 'peach'], [-0.95, 1.75, -0.15, 0.065, 'mint']]) {
    const sphere = mesh(new THREE.SphereGeometry(size, 24, 16), materials[color]);
    sphere.position.set(x, y, z);
    satellites.push({ mesh: sphere, baseY: y });
  }
  const sparkle = new THREE.Shape();
  sparkle.moveTo(0, 0.35);
  sparkle.quadraticCurveTo(0.065, 0.065, 0.31, 0);
  sparkle.quadraticCurveTo(0.065, -0.065, 0, -0.35);
  sparkle.quadraticCurveTo(-0.065, -0.065, -0.31, 0);
  sparkle.quadraticCurveTo(-0.065, 0.065, 0, 0.35);
  const star = extrude(sparkle, 0.05, materials.gold, world, 0.025);
  star.position.set(1.26, 1.02, -0.15);
  star.rotation.set(0, -0.25, -0.13);

  const orbit = mesh(new THREE.TorusGeometry(2.04, 0.012, 6, 100, Math.PI * 1.65), materials.lilac);
  orbit.position.set(0, -0.05, -0.2);
  orbit.rotation.set(1.08, 0.26, -0.34);
  orbit.castShadow = false;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ color: 0x71618e, opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.83;
  ground.receiveShadow = true;
  scene.add(ground);

  let disposed = false;
  let visible = true;
  let paused = motionPreference.matches;
  let contextLost = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let turn = 0;
  let renderedTurn = 0;
  let tiltX = 0;
  let tiltY = 0;
  let moveX = 0;
  let moveY = 0;
  const cleanup = [];
  const listen = (element, event, handler, options) => {
    element.addEventListener(event, handler, options);
    cleanup.push(() => element.removeEventListener(event, handler, options));
  };
  const showFallback = () => {
    if (fallback) fallback.hidden = false;
    host.dataset.sceneReady = 'false';
    renderer.domElement.style.visibility = 'hidden';
    shell.querySelectorAll('[data-scene-turn], [data-scene-reset], [data-scene-motion]').forEach(button => { button.disabled = true; });
  };
  const draw = () => {
    if (disposed || contextLost) return;
    renderer.render(scene, camera);
  };
  function resize() {
    if (disposed) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const distance = Math.max(8.25, 7.8 / camera.aspect);
    camera.position.set(0, 1.35, distance);
    camera.lookAt(0, -0.04, 0);
    camera.updateProjectionMatrix();
    draw();
  }
  function updateControls() {
    shell.querySelectorAll('[data-scene-motion]').forEach(button => {
      button.setAttribute('aria-pressed', String(paused));
      button.dataset.paused = String(paused);
      const text = button.querySelector('[data-scene-motion-label]');
      const playLabel = button.dataset.playLabel || button.dataset.labelPlay;
      const pauseLabel = button.dataset.pauseLabel || button.dataset.labelPause;
      if (text && playLabel && pauseLabel) text.textContent = paused ? playLabel : pauseLabel;
    });
  }
  function animate(time) {
    frame = 0;
    if (disposed || !visible || document.hidden || paused || contextLost) return;
    elapsed += lastTime ? Math.min((time - lastTime) / 1000, 0.06) : 0;
    lastTime = time;
    tiltX += (moveX - tiltX) * 0.055;
    tiltY += (moveY - tiltY) * 0.055;
    renderedTurn += (turn - renderedTurn) * 0.065;
    world.rotation.y = renderedTurn + tiltX * 0.15;
    world.rotation.x = tiltY * 0.075;
    shield.position.y = 0.15 + Math.sin(elapsed * 0.9) * 0.055;
    shield.rotation.z = -0.055 + Math.sin(elapsed * 0.55) * 0.016;
    heart.position.y = 1.03 + Math.sin(elapsed * 0.85 + 1) * 0.1;
    heart.rotation.y = 0.25 + Math.sin(elapsed * 0.65) * 0.13;
    chat.position.y = 0.02 + Math.sin(elapsed * 0.82 + 3) * 0.075;
    satellites.forEach(({ mesh: item, baseY }, i) => { item.position.y = baseY + Math.sin(elapsed * 0.8 + i) * 0.045; });
    draw();
    frame = requestAnimationFrame(animate);
  }
  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (!disposed && visible && !document.hidden && !paused && !contextLost) frame = requestAnimationFrame(animate);
    updateControls();
  }
  function applyTurn(next) {
    turn = next;
    if (paused || motionPreference.matches) {
      renderedTurn = turn;
      world.rotation.y = turn;
      draw();
    }
  }
  listen(host, 'pointermove', event => {
    if (event.pointerType !== 'mouse' || paused || motionPreference.matches) return;
    const bounds = host.getBoundingClientRect();
    moveX = (event.clientX - bounds.left) / bounds.width * 2 - 1;
    moveY = (event.clientY - bounds.top) / bounds.height * 2 - 1;
  }, { passive: true });
  listen(host, 'pointerleave', () => { moveX = 0; moveY = 0; });
  shell.querySelectorAll('[data-scene-turn]').forEach(button => listen(button, 'click', () => applyTurn(turn + Math.PI / 4)));
  shell.querySelectorAll('[data-scene-reset]').forEach(button => listen(button, 'click', () => {
    moveX = 0;
    moveY = 0;
    applyTurn(0);
  }));
  shell.querySelectorAll('[data-scene-motion]').forEach(button => listen(button, 'click', () => { paused = !paused; syncMotion(); }));
  listen(document, 'visibilitychange', syncMotion);
  listen(motionPreference, 'change', () => { paused = motionPreference.matches; syncMotion(); });
  listen(renderer.domElement, 'webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    syncMotion();
    showFallback();
  });
  listen(renderer.domElement, 'webglcontextrestored', () => {
    contextLost = false;
    resize();
    renderer.domElement.style.visibility = 'visible';
    if (fallback) fallback.hidden = true;
    host.dataset.sceneReady = 'true';
    shell.querySelectorAll('[data-scene-turn], [data-scene-reset], [data-scene-motion]').forEach(button => { button.disabled = false; });
    syncMotion();
  });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    syncMotion();
  }, { rootMargin: '60px' });
  intersectionObserver.observe(host);
  try {
    resize();
    if (fallback) fallback.hidden = true;
    host.dataset.sceneReady = 'true';
    syncMotion();
  } catch {
    contextLost = true;
    showFallback();
  }

  return {
    host,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      cleanup.forEach(remove => remove());
      const geometries = new Set();
      const usedMaterials = new Set();
      scene.traverse(item => {
        if (item.geometry) geometries.add(item.geometry);
        if (item.material) (Array.isArray(item.material) ? item.material : [item.material]).forEach(material => usedMaterials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose());
      usedMaterials.forEach(material => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

function mount() {
  const host = document.querySelector('[data-aman-scene]');
  if (currentScene?.host === host) return;
  currentScene?.dispose();
  currentScene = undefined;
  if (host) currentScene = createScene(host);
}

window.AmanScene = { mount, dispose() { currentScene?.dispose(); currentScene = undefined; } };
// Replacing the bilingual page removes the old canvas and its animation loop.
const pageObserver = new MutationObserver(mount);
pageObserver.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
mount();
