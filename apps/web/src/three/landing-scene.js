// Landing page 3D scene, extracted VERBATIM from prototypes/paritas-landing.html (module script).
// Only changes: imports point at the npm `three` package, and the code is wrapped in mountLandingScene().
// It expects the landing DOM from the prototype: <canvas id="gl">, sections with data-pose="hero|quote|...",
// the .no-gl poster fallback, and it listens for the `paritas:route` CustomEvent.
// Use from a client component: const dispose = mountLandingScene({ fontFamily }) in useEffect, call dispose() on unmount.
// Porting changes: mountLandingScene returns dispose() (cancels the frame loop, removes every listener, frees GPU
// resources), and takes the font family because next/font renames "Archivo". dispose() also loses the WebGL context,
// so give each mount a fresh <canvas id="gl"> (components/three/LandingCanvas.tsx does).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export function mountLandingScene({ fontFamily = '"Archivo"' } = {}) {

  const canvas = document.getElementById("gl");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let disposed = false, raf = 0;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  async function main() {
    const small = innerWidth < 900;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.3 : 1.6));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050506);
    scene.fog = new THREE.FogExp2(0x050506, .05);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    cleanups.push(() => {
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
      });
      scene.environment.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss();
    });

    const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 120);
    camera.position.set(0, 0, 10);

    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 5, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6e8fb8, 2.4); rim.position.set(-6, -2, -4); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, .08));

    /* Core: two woven chrome rosettes */
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    function rosette(R, r, d, radius, depth, steps) {
      const k = (R - r) / r, T = Math.PI * 2 * (r / gcd(R, r)), sc = radius / (R - r + d), pts = [];
      for (let i = 0; i < steps; i++) { const t = i / steps * T; pts.push(new THREE.Vector3(((R - r) * Math.cos(t) + d * Math.cos(k * t)) * sc, ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * sc, Math.cos(k * t) * depth)); }
      return new THREE.CatmullRomCurve3(pts, true, "centripetal");
    }
    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe9e9ee, metalness: 1, roughness: .2, clearcoat: .6, clearcoatRoughness: .15, envMapIntensity: .75 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x9aa6bc, metalness: 1, roughness: .3, envMapIntensity: .65 });
    const world = new THREE.Group(); scene.add(world);
    const core = new THREE.Group(); world.add(core);
    const ros1 = new THREE.Mesh(new THREE.TubeGeometry(rosette(30, 11, 15, 1.55, .22, 1100), small ? 900 : 1600, .022, 8, true), chrome);
    const ros2 = new THREE.Mesh(new THREE.TubeGeometry(rosette(20, 8, 9, .95, .16, 700), small ? 500 : 900, .018, 8, true), steel);
    core.add(ros1, ros2);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(.07, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    core.add(heart);
    const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,.9)"); gr.addColorStop(.18, "rgba(220,226,240,.35)"); gr.addColorStop(.5, "rgba(140,155,180,.08)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .45 }));
    halo.scale.set(1.8, 1.8, 1); core.add(halo);

    /* Venue rings */
    const VCOL = { vault: 0xf5f5f7, pool: 0x8a8a93, rfq: 0x6e8fb8 };
    const ringDefs = [{ id: "vault", r: 2.35, tilt: [1.2, .2, 0], speed: .16 }, { id: "pool", r: 2.85, tilt: [1.45, -.45, .3], speed: -.11 }, { id: "rfq", r: 3.35, tilt: [1.0, .55, -.4], speed: .08 }];
    const rings = ringDefs.map(d => {
      const pivot = new THREE.Group(); pivot.rotation.set(...d.tilt); core.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      const mat = new THREE.MeshBasicMaterial({ color: VCOL[d.id], transparent: true, opacity: .32 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, .0055, 8, 260), mat); spin.add(ring);
      return { ...d, pivot, spin, mat, coins: [] };
    });

    /* Coins */
    try { await Promise.race([document.fonts.load(`800 110px ${fontFamily}`), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
    if (disposed) return;
    const R0 = 30, r0 = 11, d0 = 15;
    function coinTex(label) {
      const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
      const gr = g.createRadialGradient(190, 160, 30, 256, 256, 270); gr.addColorStop(0, "#fbfbfd"); gr.addColorStop(.5, "#a9a9b2"); gr.addColorStop(1, "#44444c"); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
      g.strokeStyle = "rgba(14,14,17,.55)"; g.lineWidth = 7; g.beginPath(); g.arc(256, 256, 238, 0, 7); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(256, 256, 214, 0, 7); g.stroke();
      g.save(); g.translate(256, 256); g.strokeStyle = "rgba(14,14,17,.16)"; g.lineWidth = 1.1; g.beginPath();
      const k = (R0 - r0) / r0, T = Math.PI * 2 * r0, sc = 196 / (R0 - r0 + d0); for (let i = 0; i <= 1600; i++) { const t = i / 1600 * T, x = ((R0 - r0) * Math.cos(t) + d0 * Math.cos(k * t)) * sc, y = ((R0 - r0) * Math.sin(t) - d0 * Math.sin(k * t)) * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.restore();
      g.save(); g.translate(256, 256); g.rotate(-Math.PI / 2);
      g.fillStyle = "#0c0c0f"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `800 ${label.length > 3 ? 112 : 132}px ${fontFamily}, Arial, sans-serif`; g.fillText(label, 0, -8);
      g.font = `600 30px ${fontFamily}, Arial, sans-serif`; g.fillStyle = "rgba(12,12,15,.7)"; g.fillText("Stock Token", 0, 78); g.restore();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
    }
    const coinGeo = new THREE.CylinderGeometry(.3, .3, .05, 72); coinGeo.rotateX(Math.PI / 2);
    const edge = new THREE.MeshStandardMaterial({ color: 0xd2d2d8, metalness: 1, roughness: .22 });
    const plan = { vault: ["NVDA", "AAPL", "MSFT"], pool: ["SPY", "QQQ"], rfq: ["TSLA", "AMZN", "PLTR"] };
    rings.forEach(rg => plan[rg.id].forEach((lbl, i, arr) => {
      const face = new THREE.MeshStandardMaterial({ map: coinTex(lbl), metalness: .7, roughness: .3, envMapIntensity: .9 });
      const coin = new THREE.Mesh(coinGeo, [edge, face, face]);
      coin.userData = { a: i / arr.length * Math.PI * 2 + rg.r, spin: .6 + Math.random() * .6, wob: Math.random() * 6 };
      rg.spin.add(coin); rg.coins.push(coin);
    }));

    /* Trade particles: spiral in to the core, then out onto a venue ring */
    const PN = small ? 70 : 150, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), parts = [];
    const vlist = ["vault", "pool", "rfq"];
    for (let i = 0; i < PN; i++) parts.push({ u: Math.random(), sp: .06 + Math.random() * .08, a0: Math.random() * Math.PI * 2, y0: (Math.random() - .5) * 3, v: vlist[i % 3] });
    const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.35, "rgba(255,255,255,.5)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const pMat = new THREE.PointsMaterial({ size: .09, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(pGeo, pMat); core.add(points);
    const tmpV = new THREE.Vector3(), cols = { vault: new THREE.Color(0xffffff), pool: new THREE.Color(0x9a9aa3), rfq: new THREE.Color(0x7fa3d0) };
    let favored = null;
    on(window, "paritas:route", e => { favored = e.detail; });

    /* Dust */
    const DN = small ? 500 : 1300, dPos = new Float32Array(DN * 3);
    for (let i = 0; i < DN; i++) { const r = 4 + Math.random() * 16, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); dPos[i * 3] = r * Math.sin(ph) * Math.cos(th); dPos[i * 3 + 1] = r * Math.cos(ph) * .6; dPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 4; }
    const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
    const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: .03, map: dotTex, color: 0x9a9aa3, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dust);

    /* Post */
    let composer = null, bloom = null;
    if (!small) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .32, .55, .9);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      cleanups.push(() => { bloom.dispose(); composer.dispose(); });
    }

    /* Scroll choreography */
    /* p: core position, r: tilt, s: scale, e: exposure (dimmed behind content, bright in hero and CTA) */
    const POSES = small ? {
      hero: { p: [0, 2.35, -1.6], r: [.3, 0], s: .6, e: .95 }, quote: { p: [0, 1.4, -12], r: [.6, .4], s: 1, e: .3 }, router: { p: [0, 0, -12], r: [1.2, .2], s: 1.2, e: .3 }, receipt: { p: [0, -1.4, -12], r: [.2, .8], s: 1, e: .3 }, hours: { p: [0, 1.6, -12], r: [.9, -.3], s: 1, e: .3 }, app: { p: [0, 2.4, -12], r: [1.3, .1], s: 1, e: .3 }, vaults: { p: [0, -1.4, -12], r: [.4, -.6], s: 1, e: .3 }, safety: { p: [0, 1.4, -12], r: [.7, .9], s: 1, e: .3 }, faq: { p: [0, -1.2, -12], r: [.2, .3], s: 1, e: .3 }, cta: { p: [0, -1.9, -2.5], r: [.2, 0], s: .8, e: .9 }
    } : {
      hero: { p: [3.05, .6, 0], r: [.32, -.25], s: .92, e: 1 }, quote: { p: [0, .3, -12], r: [.55, .55], s: 1.4, e: .4 }, router: { p: [0, -.4, -12], r: [1.25, .15], s: 1.7, e: .38 }, receipt: { p: [-9.8, -.4, -5], r: [.15, .9], s: 1.15, e: .7 }, hours: { p: [10, 1.2, -6], r: [.95, -.35], s: 1.2, e: .65 }, app: { p: [0, 4.6, -11], r: [1.35, .05], s: 1.2, e: .45 }, vaults: { p: [-10.3, .2, -6], r: [.45, -.7], s: 1.2, e: .7 }, safety: { p: [10.2, .4, -6], r: [.75, 1.0], s: 1.2, e: .65 }, faq: { p: [-10.3, -.3, -6], r: [.25, .4], s: 1.2, e: .65 }, cta: { p: [0, -2.3, -1.2], r: [.25, 0], s: .9, e: .95 }
    };
    let anchors = [];
    function measure() { anchors = [...document.querySelectorAll("[data-pose]")].map(el => ({ y: el.offsetTop + el.offsetHeight / 2 - innerHeight / 2, pose: POSES[el.dataset.pose] })).sort((a, b) => a.y - b.y); if (anchors.length) anchors[0].y = 0; }
    const ease = t => t * t * (3 - 2 * t);
    const lerp = (a, b, t) => a + (b - a) * t;
    function poseAt(y) {
      if (!anchors.length) return POSES.hero;
      if (y <= anchors[0].y) return anchors[0].pose;
      for (let i = 0; i < anchors.length - 1; i++) { const a = anchors[i], b = anchors[i + 1]; if (y <= b.y) { const t = ease((y - a.y) / Math.max(1, b.y - a.y)); return { p: a.pose.p.map((v, k) => lerp(v, b.pose.p[k], t)), r: a.pose.r.map((v, k) => lerp(v, b.pose.r[k], t)), s: lerp(a.pose.s, b.pose.s, t), e: lerp(a.pose.e, b.pose.e, t) }; } }
      return anchors[anchors.length - 1].pose;
    }
    measure(); on(window, "resize", () => { measure(); }, { passive: true }); on(window, "load", measure);
    const remeasure = setTimeout(measure, 1200); cleanups.push(() => clearTimeout(remeasure));

    const cur = { p: [...POSES.hero.p], r: [...POSES.hero.r], s: POSES.hero.s, e: POSES.hero.e };
    const qParent = new THREE.Quaternion(), qOsc = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    on(window, "pointermove", e => { mouse.tx = e.clientX / innerWidth - .5; mouse.ty = e.clientY / innerHeight - .5; }, { passive: true });

    function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); composer && composer.setSize(w, h); }
    on(window, "resize", resize);

    const clock = new THREE.Clock(); let t = 0, running = true, first = true;
    on(document, "visibilitychange", () => { running = !document.hidden; if (running) { clock.getDelta(); loop(); } });
    function frame(dt) {
      t += dt;
      const target = poseAt(scrollY), k = first ? 1 : 1 - Math.pow(.0016, dt);
      for (let i = 0; i < 3; i++) cur.p[i] += (target.p[i] - cur.p[i]) * k;
      for (let i = 0; i < 2; i++) cur.r[i] += (target.r[i] - cur.r[i]) * k;
      cur.s += (target.s - cur.s) * k; cur.e += (target.e - cur.e) * k; first = false;
      renderer.toneMappingExposure = 1.02 * cur.e; if (bloom) bloom.strength = .32 * cur.e;
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 3); mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 3);
      camera.position.set(mouse.x * .9, -mouse.y * .6, 10); camera.lookAt(mouse.x * .3, -mouse.y * .2, 0); camera.updateMatrixWorld();
      core.position.set(...cur.p); core.scale.setScalar(cur.s);
      core.rotation.x = cur.r[0] + Math.sin(t * .25) * .05; core.rotation.y = cur.r[1] + Math.sin(t * .18) * .08;
      ros1.rotation.z = t * .12; ros2.rotation.z = -t * .2; ros2.rotation.x = Math.sin(t * .3) * .25;
      heart.scale.setScalar(1 + Math.sin(t * 2.2) * .08); halo.material.opacity = .75 + Math.sin(t * 2.2) * .12;
      rings.forEach(rg => {
        rg.spin.rotation.z += dt * rg.speed;
        const want = favored ? (favored === rg.id ? .85 : .16) : .32; rg.mat.opacity += (want - rg.mat.opacity) * Math.min(1, dt * 3);
        rg.spin.updateMatrixWorld(); rg.spin.getWorldQuaternion(qParent); qParent.invert();
        rg.coins.forEach(c => {
          const a = c.userData.a, w = c.userData.wob; c.position.set(Math.cos(a) * rg.r, Math.sin(a) * rg.r, 0);
          const ph = (t * .09 + w / 6) % 1, flip = ph < .12 ? ease(ph / .12) * Math.PI * 2 : 0;
          qOsc.setFromAxisAngle(yAxis, Math.sin(t * c.userData.spin + w) * .75 + flip);
          c.quaternion.copy(qParent).multiply(camera.quaternion).multiply(qOsc);
        });
      });
      for (let i = 0; i < PN; i++) {
        const q = parts[i]; q.u += dt * q.sp; if (q.u > 1) { q.u -= 1; q.a0 = Math.random() * Math.PI * 2; q.v = favored && Math.random() < .55 ? favored : vlist[i % 3]; }
        const rg = rings[vlist.indexOf(q.v)];
        if (q.u < .55) { const s = ease(q.u / .55), rad = lerp(7, .15, s), ang = q.a0 + s * 3.2; tmpV.set(Math.cos(ang) * rad, q.y0 * (1 - s), Math.sin(ang) * rad * .6); }
        else { const s = ease((q.u - .55) / .45), ang = q.a0 + 3.2 + s * 2.4; tmpV.set(Math.cos(ang) * lerp(.15, rg.r, s), Math.sin(ang) * lerp(.15, rg.r, s), 0).applyEuler(rg.pivot.rotation); }
        pPos[i * 3] = tmpV.x; pPos[i * 3 + 1] = tmpV.y; pPos[i * 3 + 2] = tmpV.z;
        const c = cols[q.v], fade = q.u < .08 ? q.u / .08 : q.u > .9 ? (1 - q.u) / .1 : 1; pCol[i * 3] = c.r * fade; pCol[i * 3 + 1] = c.g * fade; pCol[i * 3 + 2] = c.b * fade;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
      dust.rotation.y = t * .012; dust.position.y = -scrollY * .0006;
      composer ? composer.render() : renderer.render(scene, camera);
    }
    function loop() { if (!running || disposed) return; frame(Math.min(clock.getDelta(), .05)); if (!reduce) raf = requestAnimationFrame(loop); }
    if (reduce) { frame(0); on(window, "scroll", () => frame(0), { passive: true }); } else loop();
    window.__paritas3d = { renderer, frame }; cleanups.push(() => { delete window.__paritas3d; });
    requestAnimationFrame(() => canvas.classList.add("ready"));
  }
  main().catch(err => { if (disposed) return; console.warn("3D scene unavailable:", err); document.documentElement.classList.add("no-gl"); });

  return function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { /* already gone */ } }
    cleanups.length = 0;
    canvas.classList.remove("ready");
    document.documentElement.classList.remove("no-gl");
  };
}
