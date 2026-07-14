/* Процедурна 3D-орхідея (Three.js) для «Оранжереї».
   Інтерактивна: квіти розкриваються з рахунком (setBlooms),
   рослина підстрибує від догляду (joy). */
(function () {
  'use strict';
  let scene, camera, renderer, plant, raf = 0, host = null;
  let targetRX = 0.05, targetRY = 0, curRX = 0.05, curRY = 0;
  let blooms = [];      // {grp, target, phase}
  let joyV = 0, joyY = 0;

  function petalGeo(THREE) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.42, 0.22, 0.5, 1.1, 0, 1.5);
    shape.bezierCurveTo(-0.5, 1.1, -0.42, 0.22, 0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false, curveSegments: 12 });
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + Math.sin((y / 1.5) * Math.PI) * 0.18);
    }
    g.computeVertexNormals();
    return g;
  }

  function bloom(THREE, pg, color) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(pg, mat);
      p.rotation.z = (i / 5) * Math.PI * 2 + 0.3;
      p.rotation.x = -0.3;
      grp.add(p);
    }
    const lip = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc2185b, roughness: 0.45 }));
    lip.scale.set(1, 0.65, 0.85); lip.position.set(0, -0.14, 0.22);
    grp.add(lip);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.35 }));
    core.position.z = 0.18;
    grp.add(core);
    return grp;
  }

  function build(THREE) {
    plant = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.65, 1.1, 28),
      new THREE.MeshStandardMaterial({ color: 0xb06a3d, roughness: 0.8 }));
    pot.position.y = -2.2; plant.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xc97f4c, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -1.66; plant.add(rim);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 }));
    soil.position.y = -1.66; plant.add(soil);

    const pg = petalGeo(THREE);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9142, roughness: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(pg, leafMat);
      leaf.scale.set(1.05, 1.85, 1);
      leaf.rotation.x = Math.PI / 2.5;
      leaf.rotation.z = (i / 5) * Math.PI * 2 + 0.4;
      leaf.position.y = -1.62;
      plant.add(leaf);
    }

    // 10 квіток уздовж двох стебел — розкриваються з рахунком
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5d9c3f, roughness: 0.6 });
    const colors = [0xec84b6, 0xc9a7f5, 0xf0a1c6, 0xf7b6d5];
    blooms = [];
    [[-0.55, 0.5], [0.5, -0.45]].forEach((cfg, s) => {
      const pts = [];
      for (let t = 0; t <= 1.001; t += 0.1) {
        pts.push(new THREE.Vector3(
          cfg[0] * t * 1.7 + Math.sin(t * 2.2) * cfg[1] * 0.6,
          -1.6 + t * 3.7,
          Math.sin(t * 2.6 + s) * 0.3));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      plant.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.05, 6), stemMat));
      for (let b = 0; b < 5; b++) {
        const t = 0.42 + b * 0.145;
        const bl = bloom(THREE, pg, colors[(s * 2 + b) % 4]);
        const at = curve.getPoint(t);
        const side = (b % 2 ? 1 : -1);
        bl.position.set(at.x + side * 0.32, at.y + 0.1, at.z + 0.28);
        // квітка дивиться назовні й трохи на глядача
        bl.lookAt(at.x + side * 2.2, at.y + 0.6, 6);
        bl.scale.setScalar(0.001);
        blooms.push({ grp: bl, target: 0, phase: Math.random() * 6.28 });
        plant.add(bl);
      }
    });
    blooms.sort((a, b2) => a.grp.position.y - b2.grp.position.y);
    scene.add(plant);
  }

  function fit() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 420;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }

  function loop() {
    fit(); // сцена могла отримати розміри вже після старту
    const now = Date.now();
    curRX += (targetRX - curRX) * 0.06;
    curRY += (targetRY - curRY) * 0.06;
    plant.rotation.x = curRX;
    plant.rotation.y = curRY + Math.sin(now / 3000) * 0.08;
    // пружинка радості
    joyV += -joyY * 0.12 - joyV * 0.12;
    joyY += joyV;
    plant.position.y = joyY;
    // розкриття та пульс квіток
    for (const b of blooms) {
      const cur = b.grp.scale.x;
      const pulse = b.target > 0 ? 1 + Math.sin(now / 900 + b.phase) * 0.05 : 1;
      const goal = (b.target || 0.001) * pulse * 0.5;
      b.grp.scale.setScalar(cur + (goal - cur) * 0.08);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  window.Orchid3D = {
    async start(container) {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      host = container;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, (container.clientWidth || 640) / (container.clientHeight || 420), 0.1, 50);
      camera.position.set(0, 0.4, 8.5);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(container.clientWidth || 640, container.clientHeight || 420);
      window.addEventListener('resize', fit);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.className = 'orchid-3d-canvas';
      container.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xfff4e0, 1.5); key.position.set(3, 5, 4); scene.add(key);
      const fill = new THREE.DirectionalLight(0xbdd7ff, 0.5); fill.position.set(-4, 2, -3); scene.add(fill);
      build(THREE);
      container.addEventListener('pointermove', (e) => {
        const r = container.getBoundingClientRect();
        targetRY = ((e.clientX - r.left) / r.width - 0.5) * 1.1;
        targetRX = ((e.clientY - r.top) / r.height - 0.5) * 0.45 + 0.05;
      });
      loop();
    },
    stop() {
      cancelAnimationFrame(raf); raf = 0;
      if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
      scene = camera = renderer = plant = null; blooms = [];
    },
    active() { return !!raf; },
    setBlooms(n) {
      blooms.forEach((b, i) => { b.target = i < n ? 1 : 0; });
    },
    joy() { joyV = 0.16; }
  };
})();
