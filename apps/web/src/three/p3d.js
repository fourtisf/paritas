// Platform 3D helpers (coin carousel + spinning coin), extracted VERBATIM from prototypes/paritas-platform.html.
// Only changes: npm `three` imports, wrapped in installP3D(). It sets window.P3D = { carousel, spinCoin } and
// dispatches "p3d-ready", exactly as the prototype's page code expects.
// Port target: components/three/CoinCarousel.tsx and SpinCoin.tsx calling these functions from useEffect.
// Next.js changes: next/font renames the family, so the coin labels resolve it from --font-archivo; installP3D() is
// idempotent and returns a promise of window.P3D (null without WebGL).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function installP3D() {
  if (window.__p3dInstall) return window.__p3dInstall;
  const FONT = getComputedStyle(document.documentElement).getPropertyValue("--font-archivo").trim() || '"Archivo"';

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let envTex = null;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const ease = t => t * t * (3 - 2 * t);
  const texCache = new Map();
  function coinTex(label) {
    if (texCache.has(label)) return texCache.get(label);
    const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
    const gr = g.createRadialGradient(190, 160, 30, 256, 256, 270); gr.addColorStop(0, "#fbfbfd"); gr.addColorStop(.5, "#a9a9b2"); gr.addColorStop(1, "#44444c"); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "rgba(14,14,17,.55)"; g.lineWidth = 7; g.beginPath(); g.arc(256, 256, 238, 0, 7); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(256, 256, 214, 0, 7); g.stroke();
    const R0 = 30, r0 = 11, d0 = 15, k = (R0 - r0) / r0, T = Math.PI * 2 * r0, sc = 196 / (R0 - r0 + d0);
    g.save(); g.translate(256, 256); g.strokeStyle = "rgba(14,14,17,.16)"; g.lineWidth = 1.1; g.beginPath();
    for (let i = 0; i <= 1600; i++) { const t = i / 1600 * T, x = ((R0 - r0) * Math.cos(t) + d0 * Math.cos(k * t)) * sc, y = ((R0 - r0) * Math.sin(t) - d0 * Math.sin(k * t)) * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.restore();
    g.save(); g.translate(256, 256); g.rotate(-Math.PI / 2); g.fillStyle = "#0c0c0f"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `800 ${label.length > 3 ? 112 : 132}px ${FONT}, Arial, sans-serif`; g.fillText(label, 0, -8);
    g.font = `600 30px ${FONT}, Arial, sans-serif`; g.fillStyle = "rgba(12,12,15,.7)"; g.fillText("Stock Token", 0, 78); g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(label, t); return t;
  }
  function makeCtx(el, { fov = 30, ratio = 1.75 } = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, ratio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; pm.dispose();
    const camera = new THREE.PerspectiveCamera(fov, 1, .1, 60);
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6e8fb8, 1.8); rim.position.set(-4, -1, -3); scene.add(rim);
    el.appendChild(renderer.domElement);
    const size = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    return { renderer, scene, camera, ro };
  }
  const edgeMat = () => new THREE.MeshStandardMaterial({ color: 0xd2d2d8, metalness: 1, roughness: .22 });
  function coinMesh(label, r = .55, h = .08, metal = .7) {
    const geo = new THREE.CylinderGeometry(r, r, h, 72); geo.rotateX(Math.PI / 2);
    const face = new THREE.MeshStandardMaterial({ map: coinTex(label), metalness: metal, roughness: .32, envMapIntensity: .95 });
    return new THREE.Mesh(geo, [edgeMat(), face, face]);
  }
  function glowPlane(size = 6) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,.35)"); gr.addColorStop(.4, "rgba(170,180,200,.1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; return m;
  }

  function carousel(el, labels, { start = 0, onFocus, onPick } = {}) {
    const { renderer, scene, camera, ro } = makeCtx(el, { fov: 30 });
    camera.position.set(0, 1.25, 8.4); camera.lookAt(0, -.05, 0);
    const N = labels.length, R = 2.7, group = new THREE.Group(); scene.add(group);
    const coins = labels.map((lbl, i) => { const c = coinMesh(lbl); const a = i / N * Math.PI * 2; c.position.set(Math.sin(a) * R, 0, Math.cos(a) * R); c.rotation.y = a; c.userData = { i, a }; group.add(c); return c; });
    const floor = glowPlane(7.5); floor.position.y = -.95; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, .006, 6, 200), new THREE.MeshBasicMaterial({ color: 0x8a8a93, transparent: true, opacity: .35 })); ring.rotation.x = Math.PI / 2; ring.position.y = -.62; scene.add(ring);
    let rot = -start / N * Math.PI * 2, vel = 0, drag = null, hover = false, focus = -1, raf = 0, t = 0, last = performance.now();
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(coins)[0]; return hit ? hit.object.userData.i : -1; };
    const down = e => { drag = { x: e.clientX, rot, moved: 0, t: performance.now() }; el.setPointerCapture && el.setPointerCapture(e.pointerId); };
    const move = e => { if (drag) { const dx = e.clientX - drag.x; drag.moved = Math.max(drag.moved, Math.abs(dx)); const nr = drag.rot + dx * .008; vel = (nr - rot) / Math.max(.016, (performance.now() - drag.t) / 1000) * .016; drag.t = performance.now(); rot = nr; } else el.style.cursor = pick(e) >= 0 ? "pointer" : "grab"; };
    const up = e => { if (drag && drag.moved < 5) { const i = pick(e); if (i >= 0) onPick && onPick(i); } drag = null; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", () => drag = null);
    el.addEventListener("pointerenter", () => hover = true); el.addEventListener("pointerleave", () => { hover = false; drag = null; });
    function frame() {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
      if (!drag) { rot += vel; vel *= .92; if (!reduce) rot += dt * (hover ? .04 : .16); }
      group.rotation.y = rot;
      const cz = camera.aspect < 1.3 ? 11 : 8.4; if (camera.position.z !== cz) { camera.position.set(0, 1.25, cz); camera.lookAt(0, -.05, 0); }
      let best = -1, bz = -1e9;
      coins.forEach(c => { c.position.y = Math.sin(t * 1.3 + c.userData.i) * .07; c.rotation.z = Math.sin(t * .9 + c.userData.i) * .06; const wa = c.userData.a + rot, z = Math.cos(wa); if (z > bz) { bz = z; best = c.userData.i; } c.scale.setScalar(1 + Math.max(0, z) * .18); });
      if (best !== focus) { focus = best; onFocus && onFocus(best); }
      renderer.render(scene, camera);
      if (!reduce || drag || Math.abs(vel) > 1e-4) raf = requestAnimationFrame(frame); else raf = 0;
    }
    frame(); el.classList.add("ready");
    if (reduce) el.addEventListener("pointermove", () => { if (!raf) raf = requestAnimationFrame(frame); });
    return { dispose() { cancelAnimationFrame(raf); ro.disconnect(); el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); el.classList.remove("ready"); } };
  }

  function spinCoin(el, label, { celebrate = false } = {}) {
    const { renderer, scene, camera, ro } = makeCtx(el, { fov: 28, ratio: 2 });
    camera.position.set(0, 0, celebrate ? 4.2 : 3.4); camera.lookAt(0, 0, 0);
    const coin = coinMesh(label, celebrate ? .9 : .62, celebrate ? .12 : .09, celebrate ? .6 : .4); scene.add(coin);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(0, 0, 5); scene.add(fill);
    let raf = 0, t = 0, last = performance.now(), spin = celebrate ? 34 : 0, ang = 0;
    let sparks = null;
    if (celebrate) {
      const n = 60, pos = new Float32Array(n * 3), vel = []; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.2; vel.push([Math.cos(a) * s, Math.sin(a) * s, (Math.random() - .5) * s]); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      sparks = new THREE.Points(geo, new THREE.PointsMaterial({ size: .06, color: 0xf5f5f7, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })); sparks.userData.vel = vel; scene.add(sparks);
    }
    function frame() {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
      if (celebrate) { spin *= Math.pow(.18, dt); ang += spin * dt; if (spin < .6) { const target = Math.round(ang / (Math.PI * 2)) * Math.PI * 2; ang += (target - ang) * Math.min(1, dt * 6); } coin.rotation.set(Math.sin(t * 1.6) * .12, ang, 0); coin.position.y = Math.sin(t * 2) * .06;
        const p = sparks.geometry.attributes.position, v = sparks.userData.vel; for (let i = 0; i < v.length; i++) { p.array[i * 3] = v[i][0] * t * (1 - t * .25); p.array[i * 3 + 1] = v[i][1] * t * (1 - t * .25); p.array[i * 3 + 2] = v[i][2] * t; } p.needsUpdate = true; sparks.material.opacity = Math.max(0, 1 - t / 1.6); }
      else { const ph = (t * .16) % 1, flip = ph < .14 ? ease(ph / .14) * Math.PI * 2 : 0; coin.rotation.set(Math.sin(t * .8) * .18, Math.sin(t * 1.1) * .55 + flip, 0); }
      renderer.render(scene, camera);
      if (!reduce || (celebrate && t < 2.5)) raf = requestAnimationFrame(frame);
    }
    frame(); el.classList.add("ready");
    return { dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); el.classList.remove("ready"); } };
  }

  window.__p3dInstall = (async () => {
    try { await Promise.race([document.fonts.load(`800 110px ${FONT}`), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
    const test = document.createElement("canvas"); if (!(test.getContext("webgl2") || test.getContext("webgl"))) return null;
    window.P3D = { carousel, spinCoin };
    window.dispatchEvent(new Event("p3d-ready"));
    return window.P3D;
  })();
  return window.__p3dInstall;
}
