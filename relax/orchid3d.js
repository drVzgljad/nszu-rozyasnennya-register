/* Процедурна 3D-орхідея (Three.js) для «Оранжереї».
   Вмикається кнопкою «3D-режим» у грі; SVG-версія лишається типовою. */
(function () {
  'use strict';
  let scene, camera, renderer, plant, raf = 0, host = null;
  let targetRX = 0.05, targetRY = 0, curRX = 0.05, curRY = 0;

  function petalGeo(THREE) {
    // пелюстка: вигнута площина-«крапля»
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.5, 0.25, 0.55, 1.15, 0, 1.5);
    shape.bezierCurveTo(-0.55, 1.15, -0.5, 0.25, 0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 10 });
    // легкий вигин назовні
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + Math.sin((y / 1.5) * Math.PI) * 0.22);
    }
    g.computeVertexNormals();
    return g;
  }

  function bloom(THREE, color) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide });
    const pg = petalGeo(THREE);
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(pg, mat);
      p.rotation.z = (i / 5) * Math.PI * 2;
      p.rotation.x = -0.35;
      grp.add(p);
    }
    const lip = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc2185b, roughness: 0.5 }));
    lip.scale.set(1, 0.7, 0.9); lip.position.set(0, -0.15, 0.25);
    grp.add(lip);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 }));
    core.position.z = 0.2;
    grp.add(core);
    grp.scale.setScalar(0.55);
    return grp;
  }

  function build(THREE) {
    plant = new THREE.Group();
    // горщик
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.65, 1.1, 24),
      new THREE.MeshStandardMaterial({ color: 0xb06a3d, roughness: 0.8 }));
    pot.position.y = -2.2; plant.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xc97f4c, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -1.66; plant.add(rim);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.1, 20),
      new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 }));
    soil.position.y = -1.66; plant.add(soil);
    // листя: вигнуті «язики»
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9142, roughness: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(petalGeo(THREE), leafMat);
      leaf.scale.set(1.15, 1.9, 1);
      leaf.rotation.x = Math.PI / 2.4;
      leaf.rotation.z = (i / 4) * Math.PI * 2 + 0.4;
      leaf.position.y = -1.6;
      plant.add(leaf);
    }
    // два стебла-дуги з квітами
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5d9c3f, roughness: 0.6 });
    const colors = [0xec84b6, 0xc9a7f5, 0xf0a1c6];
    [[-0.5, 0.55], [0.45, -0.4]].forEach((cfg, s) => {
      const pts = [];
      for (let t = 0; t <= 1; t += 0.1) {
        pts.push(new THREE.Vector3(cfg[0] * t * 1.6 + Math.sin(t * 2.2) * cfg[1], -1.6 + t * 3.6, Math.cos(t * 3) * 0.25));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      plant.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.05, 6), stemMat));
      for (let b = 0; b < 3; b++) {
        const bl = bloom(THREE, colors[(s + b) % 3]);
        const at = curve.getPoint(0.55 + b * 0.2);
        bl.position.copy(at);
        bl.lookAt(at.x * 3, at.y + 0.4, 5);
        plant.add(bl);
      }
    });
    scene.add(plant);
  }

  function loop() {
    curRX += (targetRX - curRX) * 0.06;
    curRY += (targetRY - curRY) * 0.06;
    plant.rotation.x = curRX;
    plant.rotation.y = curRY + Math.sin(Date.now() / 3000) * 0.08;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  window.Orchid3D = {
    async start(container) {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      host = container;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, container.offsetWidth / container.offsetHeight, 0.1, 50);
      camera.position.set(0, 0.4, 8.5);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(container.offsetWidth, container.offsetHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.className = 'orchid-3d-canvas';
      container.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xfff4e0, 1.4); key.position.set(3, 5, 4); scene.add(key);
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
      scene = camera = renderer = plant = null;
    },
    active() { return !!raf; }
  };
})();
