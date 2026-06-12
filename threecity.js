// Three.js City Builder - 3D mesmerizing version
// No build tools required; uses global THREE from CDN.

// Clash-of-Clans style camera controller: left-drag to pan, wheel to zoom, fixed tilt and yaw
class CoCCameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;
    this.pitch = THREE.MathUtils.degToRad(55); // fixed tilt
    this.yaw = -Math.PI / 4; // isometric yaw
    this.distance = 40; // starting distance
    this.minDistance = 12;
    this.maxDistance = 120;
    this.panSpeed = 0.0025; // pixels -> world scale
    this.zoomSpeed = 0.0015; // wheel delta -> distance
    this.target = new THREE.Vector3();
    this.bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };

    this._dragging = false;
    this.hasDragged = false;
    this._last = new THREE.Vector2();

    // Mouse events
    this._onMouseDown = (e) => {
      if (!this.enabled || e.button !== 0) return; // left button pans
      this._dragging = true;
      this.hasDragged = false;
      this.domElement.style.cursor = 'grabbing';
      this._last.set(e.clientX, e.clientY);
    };
    this._onMouseMove = (e) => {
      if (!this.enabled || !this._dragging) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      if (Math.hypot(dx, dy) > 2) {
        this.hasDragged = true;
      }
      this._pan(dx, dy);
      this._last.set(e.clientX, e.clientY);
    };
    this._onMouseUp = () => { this._dragging = false; this.domElement.style.cursor = 'default'; };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const factor = Math.exp(e.deltaY * this.zoomSpeed);
      this.setDistance(this.distance * factor);
    };
    this._onContextMenu = (e) => e.preventDefault();

    // Touch: one finger pan, two finger pinch zoom
    this._touchState = { active: false, last: null, pinchDist: 0 };
    this._onTouchStart = (e) => {
      if (!this.enabled) return;
      this.hasDragged = false;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._touchState.active = true; this._touchState.last = { x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 2) {
        this._touchState.active = false; // pinch mode
        this._touchState.pinchDist = this._touchDistance(e.touches[0], e.touches[1]);
      }
    };
    this._onTouchMove = (e) => {
      if (!this.enabled) return;
      if (e.touches.length === 1 && this._touchState.active) {
        const t = e.touches[0];
        const dx = t.clientX - this._touchState.last.x;
        const dy = t.clientY - this._touchState.last.y;
        if (Math.hypot(dx, dy) > 2) {
          this.hasDragged = true;
        }
        this._pan(dx, dy);
        this._touchState.last = { x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 2) {
        this.hasDragged = true;
        const d = this._touchDistance(e.touches[0], e.touches[1]);
        const delta = d - this._touchState.pinchDist;
        this._touchState.pinchDist = d;
        const factor = Math.exp(-delta * 0.003); // invert for natural pinch
        this.setDistance(this.distance * factor);
      }
      e.preventDefault();
    };
    this._onTouchEnd = () => { this._touchState.active = false; };

    domElement.addEventListener('contextmenu', this._onContextMenu);
    domElement.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('touchstart', this._onTouchStart, { passive: false });
    domElement.addEventListener('touchmove', this._onTouchMove, { passive: false });
    domElement.addEventListener('touchend', this._onTouchEnd);
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('contextmenu', this._onContextMenu);
    el.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('touchstart', this._onTouchStart);
    el.removeEventListener('touchmove', this._onTouchMove);
    el.removeEventListener('touchend', this._onTouchEnd);
  }

  setTarget(v3) { this.target.copy(v3); this._updateCamera(); }
  setDistance(d) { this.distance = THREE.MathUtils.clamp(d, this.minDistance, this.maxDistance); this._updateCamera(); }
  setBounds(b) { this.bounds = { ...this.bounds, ...b }; this._clampTarget(); this._updateCamera(); }

  _touchDistance(a, b) { const dx = a.clientX - b.clientX; const dy = a.clientY - b.clientY; return Math.hypot(dx, dy); }

  _pan(dx, dy) {
    const scale = this.distance * this.panSpeed;
    // Camera right and forward projected to XZ
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(right); // this returns forward; we derive right via cross with up
    const forward = right.clone();
    right.crossVectors(new THREE.Vector3(0,1,0), forward).normalize();
    forward.y = 0; forward.normalize();
    // Move opposite to screen motion for right; same for forward (drag up moves forward)
    const move = new THREE.Vector3()
      .addScaledVector(right, -dx * scale)
      .addScaledVector(forward, dy * scale);
    this.target.add(move);
    this._clampTarget();
    this._updateCamera();
  }

  _clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  _updateCamera() {
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.cos(this.yaw) * cosP, sinP, Math.sin(this.yaw) * cosP);
    const pos = this.target.clone().addScaledVector(dir, this.distance);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  update() { /* no-op; camera updates applied on interactions */ }
}

class City3DGame {
  constructor({ containerId, gridSize = 5, cellSize = 6, buildingCost = 50, coinIncrement = 10 }) {
    this.container = document.getElementById(containerId);
    this.gridSize = gridSize;
    this.cellSize = cellSize; // world units per cell (meters)
    this.buildingCost = buildingCost;
    this.coinIncrement = coinIncrement;
    this.expandCost = 100;

  this.coins = 0;
  this.population = 0;
  this.happiness = 1.0; // 0..1
  this.level = 1;
  this.buildings = []; // store meshes
  this.grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  this.raycaster = new THREE.Raycaster();
  this.mouse = new THREE.Vector2();
  this.ghost = null; // preview mesh
  this.currentPlacement = null; // { type, cost }
  this.isRelocating = null; // building being moved
  this.textureCache = {};
  this.placementRotation = 0; // radians; used during placement
  this.smokePuffs = [];
  this._lastTime = performance.now() * 0.001;
  this.cars = [];
  this.people = [];
  this._carSpawnTimer = 0;
  this._maxCars = 6;
  // Street lights
  this.streetLightPoints = [];
  // Simulation speed control (0 = paused, 1/2/3 = normal/2x/3x)
  this.timeScale = 1;
  this._lastLevel = 1;

    this._initThree();
    this._initScene();
    this._animate();
    this._updateUI();
    this._bindResize();

    // Gentle welcome feed if feed panel exists
    this._feed('Welcome to City Simulator');
  }

  introCinematic() {
    const planeSize = this.gridSize * this.cellSize;
    const half = planeSize / 2;
    const startDist = Math.min(80, planeSize*1.2);
    const endDist = Math.max(26, planeSize*0.9);
    const startTarget = new THREE.Vector3(half*0.3, 0, half*0.3);
    const endTarget = new THREE.Vector3(half, 0, half);
    const dur = 1400;
    const t0 = performance.now();
    const ease = (x)=> x<0?0: x>1?1: (x<0.5? 2*x*x : 1 - Math.pow(-2*x+2,2)/2);
    const animate = (t)=>{
      const k = ease(Math.min(1,(t-t0)/dur));
      const tpos = startTarget.clone().lerp(endTarget, k);
      const d = startDist + (endDist - startDist)*k;
      this.controls.setTarget(tpos);
      this.controls.setDistance(d);
      if (k<1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  _initThree() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

  this.scene = new THREE.Scene();
  // Disable fog so the city doesn't fade when zoomed out
  this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  this.camera.position.set(20, 24, 24);

  this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Punch up brightness and dynamic range a touch
  if (THREE.ACESFilmicToneMapping) this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

  // Initialize CoC-style controller
  this.controls = new CoCCameraController(this.camera, this.renderer.domElement);
  }

  _initScene() {
    // Ground plane (grid)
  const planeSize = this.gridSize * this.cellSize;
  const half = planeSize / 2;

  const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      new THREE.MeshStandardMaterial({ color: 0x1e1f25, roughness: 0.9, metalness: 0.0 })
    );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(half, 0, half);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

  // Grid helper lines
  const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, 0x3a3e4a, 0x2a2e38);
  gridHelper.position.set(half, 0.01, half); // align to ground and avoid z-fighting
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;

    // Lights: sun + bounce + ambient
  const sun = new THREE.DirectionalLight(0xffe2b3, 1.8);
    sun.position.set(20, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    this.scene.add(sun);

  const bounce = new THREE.HemisphereLight(0x88aaff, 0x222233, 0.6);
    this.scene.add(bounce);

  const ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(ambient);

    // Gentle skybox gradient via large sphere
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x151826) },
        bottomColor: { value: new THREE.Color(0x0e0f14) },
        offset: { value: 400 },
        exponent: { value: 0.6 },
      },
      vertexShader: `varying vec3 vWorldPosition;\nvoid main(){\n vec4 worldPosition = modelMatrix * vec4(position, 1.0);\n vWorldPosition = worldPosition.xyz;\n gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n}`,
      fragmentShader: `uniform vec3 topColor;\nuniform vec3 bottomColor;\nuniform float offset;\nuniform float exponent;\nvarying vec3 vWorldPosition;\nvoid main(){\n // shift world position upward to bias gradient\n vec3 shifted = vWorldPosition + vec3(0.0, offset, 0.0);\n float h = normalize(shifted).y;\n float f = clamp(pow(max(h, 0.0), exponent), 0.0, 1.0);\n gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);\n}`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    // Subtle post-like sparkle via animated emissive on buildings (handled per frame)

  // Set camera controller bounds and initial view
  this.controls.setBounds({ minX: -4, maxX: planeSize + 4, minZ: -4, maxZ: planeSize + 4 });
  this.controls.setTarget(new THREE.Vector3(half, 0, half));
  this.controls.setDistance(Math.max(planeSize * 0.9, 26));

    // UI refs
  this.coinTextEl = document.getElementById('coinText') || null;
  this.popTextEl = document.getElementById('popText') || null;
  this.happyTextEl = document.getElementById('happyText') || null;
  this.getCoinsBtn = document.getElementById('getCoinsBtn') || null;
  this.expandCityBtn = document.getElementById('expandCityBtn') || null;
    // Store buttons
    this.ui = {
      buyRoad: document.getElementById('buyRoad'),
      buyHouse: document.getElementById('buyHouse'),
      buyTower: document.getElementById('buyTower'),
      buyFactory: document.getElementById('buyFactory'),
      buyPark: document.getElementById('buyPark'),
      cancelPlacement: document.getElementById('cancelPlacement')
    };

    // Hook buttons
    if (this.getCoinsBtn) {
      this.getCoinsBtn.addEventListener('click', () => {
        this.coins += this.coinIncrement;
        this._updateUI();
      });
    }
    if (this.expandCityBtn) {
      this.expandCityBtn.addEventListener('click', () => this._tryExpandCity());
    }

  // Hook store selections
  this._hookStore('buyRoad', { type: 'road', cost: 5 });
  this._hookStore('buyHouse', { type: 'house', cost: 50 });
  this._hookStore('buyTower', { type: 'tower', cost: 75 });
  this._hookStore('buyFactory', { type: 'factory', cost: 100 });
  this._hookStore('buyPark', { type: 'park', cost: 30 });
  if (this.ui.cancelPlacement) this.ui.cancelPlacement.addEventListener('click', () => this._cancelPlacement());

  // Mouse interactions for placement and moving
  this.renderer.domElement.addEventListener('mousemove', (e) => this._onPointerMove(e));
  this.renderer.domElement.addEventListener('click', (e) => this._onClick(e));
  this.renderer.domElement.addEventListener('dblclick', (e) => this._onDoubleClick(e));
  window.addEventListener('keydown', (e) => this._onKeyDown(e));
  // (River creation removed)
  }

  _gridToWorld(col, row) {
    const x = (col + 0.5) * this.cellSize;
    const z = (row + 0.5) * this.cellSize;
    return { x, z };
  }

  _worldToGrid(x, z) {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(z / this.cellSize);
    if (col < 0 || row < 0 || col >= this.gridSize || row >= this.gridSize) return null;
    return { col, row };
  }

  _hookStore(id, placement) {
    const el = this.ui[id];
    if (!el) return;
    el.addEventListener('click', () => {
      this.currentPlacement = placement; // {type, cost}
      this.isRelocating = null;
      this._ensureGhost(placement.type);
  this.placementRotation = 0;
      this._updateUI();
    });
  }

  _ensureGhost(type) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    const mesh = this._createBuildingMesh(type, { ghost: true });
    mesh.visible = false; // hidden until over grid
    this.scene.add(mesh);
    this.ghost = mesh;
  }

  _setGhostColor(mesh, hex) {
    const apply = (mat) => { if (mat && mat.color) mat.color.setHex(hex); };
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material);
  }

  _onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this.ghost && !this.isRelocating) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    // Intersect with ground plane at y=0 using a plane
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, point);
    const cell = this._worldToGrid(point.x, point.z);
    if (!cell) { if (this.ghost) this.ghost.visible = false; return; }
    const { col, row } = cell;
    const { x, z } = this._gridToWorld(col, row);
    if (this.ghost) {
      this.ghost.position.set(x, 0.01, z);
      this.ghost.visible = true;
  const free = !this.grid[row][col];
  this._setGhostColor(this.ghost, free ? 0x66ff99 : 0xff6666);
    }
  }

  _onClick(event) {
    // Place selected type or confirm relocation
    if (this.controls && this.controls.hasDragged) return; // avoid placing while panning
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return;
    const cell = this._worldToGrid(point.x, point.z);
    if (!cell) return;
    const { col, row } = cell;

  if (this.isRelocating) {
      // move existing building
      if (this.grid[row][col]) return; // occupied
      const mesh = this.isRelocating;
      // clear previous grid cell
      const prev = mesh.userData.grid;
      if (prev) this.grid[prev.row][prev.col] = null;
      const pos = this._gridToWorld(col, row);
      mesh.position.set(pos.x, mesh.position.y, pos.z);
      mesh.userData.grid = { col, row };
      this.grid[row][col] = mesh;
      // If moving a road, refresh road textures around old and new spots
      if (mesh.userData.type === 'road') {
        if (prev) this._refreshRoadAndNeighbors(prev.row, prev.col);
        this._refreshRoadAndNeighbors(row, col);
      }
      // If moving a park, move its people (respawn at new location)
      if (mesh.userData.type === 'park') {
        this._removePeopleForPark(mesh);
        this._spawnPeopleForPark(mesh, row, col);
      }

      this.isRelocating = null;
      this._recomputeCityStats();
      this._feed('Building moved');
      if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
      return;
    }

    if (!this.currentPlacement) return;
  if (this.grid[row][col]) return; // occupied
    if (this.coins < this.currentPlacement.cost) return; // not enough coins



    const mesh = this._createBuildingMesh(this.currentPlacement.type);
    const pos = this._gridToWorld(col, row);
    mesh.position.set(pos.x, mesh.position.y, pos.z);
    mesh.userData = { type: this.currentPlacement.type, grid: { col, row } };
    this.scene.add(mesh);
    this.buildings.push(mesh);
    this.grid[row][col] = mesh;
    this.coins -= this.currentPlacement.cost;
    // If road, auto-connect lines by updating mask textures for this and neighbors
    if (mesh.userData.type === 'road') {
      this._refreshRoadAndNeighbors(row, col);
    }
    // If park, spawn people
    if (mesh.userData.type === 'park') {
      this._spawnPeopleForPark(mesh, row, col);
    }

    // Water: no coin cost; acts as decorative tile
    this._recomputeCityStats();
    this._updateUI();
    this._feed(`Placed ${mesh.userData.type}`);
  }

  _computeRandomPatch(startR, startC, targetCount) {
    const inside = (r,c)=> r>=0 && c>=0 && r<this.gridSize && c<this.gridSize;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const chosen = new Set();
    const key = (r,c)=>`${r},${c}`;
    const cells = [{r:startR,c:startC}];
    chosen.add(key(startR,startC));
    while (cells.length < targetCount) {
      // pick a random existing cell and grow to a random neighbor
      const base = cells[Math.floor(Math.random()*cells.length)];
      const d = dirs[Math.floor(Math.random()*dirs.length)];
      const nr = base.r + d[0], nc = base.c + d[1];
      if (!inside(nr,nc)) continue;
      const k = key(nr,nc);
      if (chosen.has(k)) continue;
      // avoid placing over occupied tiles
      if (this.grid[nr][nc]) continue;
      chosen.add(k);
      cells.push({r:nr,c:nc});
    }
    return cells;
  }

  _onDoubleClick(event) {
    // Pick building under cursor and enter relocating mode
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.buildings, false);
    if (intersects.length > 0) {
      this.isRelocating = intersects[0].object;
      this.currentPlacement = null;
  this._ensureGhost(this.isRelocating.userData.type);
  // Preserve rotation when relocating
  this.placementRotation = this.isRelocating.rotation.y;
  if (this.ghost) this.ghost.rotation.y = this.placementRotation;
    }
  }

  _cancelPlacement() {
    this.currentPlacement = null;
    this.isRelocating = null;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
  }

  _createBuildingMesh(type, opts = {}) {
    const ghost = !!opts.ghost;
    const heightBy = {
      road: 0.1,
      house: 1.2,
      tower: 2.0,
      factory: 1.0,
      park: 0.2,
    };
    const colorBy = {
      road: 0x2f2f36,
      house: 0xcfd8e3,
      tower: 0xbfc7ff,
      factory: 0xe6b691,
      park: 0x6fe39b,
      water: 0x2aa6b8,
    };
    const h = (this.cellSize) * (heightBy[type] || 1.0);
    let geo, mat, mesh;
  if (type === 'road') {
  // Road tile; keep visuals aligned with two-lane movement
  geo = new THREE.BoxGeometry(this.cellSize * 0.98, h, this.cellSize * 0.98);
  const roadTopTex = this._getRoadTexture();
      const topMat = new THREE.MeshStandardMaterial({ map: roadTopTex, roughness: 0.95, metalness: 0.05, color: 0xffffff, opacity: ghost ? 0.6 : 1, transparent: ghost });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 1.0, metalness: 0.0, opacity: ghost ? 0.6 : 1, transparent: ghost });
      // Order: [right,left,top,bottom,front,back]
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
      mesh = new THREE.Mesh(geo, mats);
  mesh.position.y = h / 2 + 0.001;
  mesh.receiveShadow = true;
  // For auto-connecting roads we keep rotation 0; texture adapts based on neighbors
  mesh.rotation.y = 0;
  } else if (type === 'park') {
      // Green tile with a simple tree
      const tileGeo = new THREE.BoxGeometry(this.cellSize * 0.98, h, this.cellSize * 0.98);
      const grassMat = new THREE.MeshStandardMaterial({ color: 0x2f7d44, roughness: 1.0, metalness: 0.0, opacity: ghost ? 0.6 : 1, transparent: ghost });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x2a5f39, roughness: 1.0, metalness: 0.0, opacity: ghost ? 0.6 : 1, transparent: ghost });
      mesh = new THREE.Mesh(tileGeo, [sideMat, sideMat, grassMat, sideMat, sideMat, sideMat]);
      mesh.position.y = h / 2;
      mesh.receiveShadow = true;
      if (!ghost) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.06, this.cellSize*0.08, this.cellSize*0.35, 8), new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(this.cellSize*0.22, this.cellSize*0.38, 12), new THREE.MeshStandardMaterial({ color: 0x3aa45f }));
        trunk.position.set(this.cellSize*0.18, h + this.cellSize*0.175, this.cellSize*0.18);
        leaves.position.set(trunk.position.x, trunk.position.y + this.cellSize*0.26, trunk.position.z);
        trunk.castShadow = true; leaves.castShadow = true; leaves.receiveShadow = true;
        mesh.add(trunk); mesh.add(leaves);
      }

    } else {
      // buildings with windowed facades and roof top
      geo = new THREE.BoxGeometry(this.cellSize * 0.9, h, this.cellSize * 0.9);
      const facadeTex = this._getFacadeTexture(type);
      facadeTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy?.() || 4);
      const sideMat = new THREE.MeshStandardMaterial({ map: facadeTex, color: 0xffffff, roughness: 0.55, metalness: 0.2, emissive: 0xffffff, emissiveMap: ghost ? null : facadeTex, emissiveIntensity: ghost ? 0.0 : 0.35, opacity: ghost ? 0.6 : 1, transparent: ghost });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8d8f96, roughness: 0.9, metalness: 0.1, opacity: ghost ? 0.6 : 1, transparent: ghost });
      const bottomMat = new THREE.MeshStandardMaterial({ color: 0x20232b });
      // Order: [right,left,top,bottom,front,back]
      mesh = new THREE.Mesh(geo, [sideMat, sideMat, roofMat, bottomMat, sideMat, sideMat]);
      mesh.position.y = h / 2;
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (!ghost) {
        if (type === 'house') {
          // gable roof for house
          const roof = new THREE.Mesh(new THREE.ConeGeometry(this.cellSize * 0.42, this.cellSize * 0.28, 4), new THREE.MeshStandardMaterial({ color: 0xb35c4b, roughness: 0.8 }));
          roof.position.y = h / 2 + this.cellSize * 0.18;
          roof.rotation.y = Math.PI / 4;
          roof.castShadow = true; roof.receiveShadow = true;
          mesh.add(roof);
        } else if (type === 'factory') {
          // Factory hall extension
          const hall = new THREE.Mesh(new THREE.BoxGeometry(this.cellSize*0.9, h*0.55, this.cellSize*0.5), new THREE.MeshStandardMaterial({ color: 0xbfb7ab, roughness: 0.8 }));
          hall.position.set(0, -h*0.2, -this.cellSize*0.15);
          hall.castShadow = true; hall.receiveShadow = true; mesh.add(hall);
          // Chimneys
          const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9d9fa8, roughness: 0.5, metalness: 0.5 });
          const mkChimney = (x,z,hMul=1) => {
            const ch = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.08, this.cellSize*0.12, h*0.7*hMul, 12), pipeMat);
            ch.position.set(x, h*0.55, z);
            ch.castShadow = true; ch.receiveShadow = true;
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.14, this.cellSize*0.14, this.cellSize*0.04, 16), new THREE.MeshStandardMaterial({ color: 0x585b63, roughness: 0.9 }));
            cap.position.y = h*0.35;
            ch.add(cap);
            mesh.add(ch);
            this._emitSmoke(ch);
          };
          mkChimney(this.cellSize*0.18, this.cellSize*0.05, 1.0);
          mkChimney(-this.cellSize*0.18, this.cellSize*0.1, 0.85);
          // Rooftop vents
          const vent = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.06, this.cellSize*0.06, this.cellSize*0.12, 10), new THREE.MeshStandardMaterial({ color: 0x6a6d75 }));
          vent.position.set(this.cellSize*0.0, h*0.55, -this.cellSize*0.28); vent.castShadow = true; vent.receiveShadow = true; mesh.add(vent);
        }
      }
    }
    if (!ghost) {
      // pop-in animation
      mesh.scale.y = 0.01;
      const targetScale = 1; const start = performance.now(); const duration = 450;
      const animateIn = (t) => { const e = Math.min((t - start) / duration, 1); mesh.scale.y = 0.01 + e * (targetScale - 0.01); if (e < 1) requestAnimationFrame(animateIn); };
      requestAnimationFrame(animateIn);
    }
    return mesh;
  }

  _emitSmoke(originMesh) {
    // Create a soft billboarded puff that rises and fades
    const size = 128; const c = document.createElement('canvas'); c.width=c.height=size; const ctx=c.getContext('2d');
    const grad = ctx.createRadialGradient(size/2,size/2,10,size/2,size/2,size/2);
    grad.addColorStop(0,'rgba(255,255,255,0.9)'); grad.addColorStop(1,'rgba(255,255,255,0.0)');
    ctx.fillStyle=grad; ctx.fillRect(0,0,size,size);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.0, color: 0xcfd6de });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(this.cellSize*0.7, this.cellSize*0.7, 1);
    const wp = new THREE.Vector3(); originMesh.getWorldPosition(wp);
    sprite.position.copy(wp).add(new THREE.Vector3(0, this.cellSize*0.2, 0));
    this.scene.add(sprite);
    this.smokePuffs.push({ sprite, t: 0, life: 2.8 + Math.random()*1.2, drift: new THREE.Vector3((Math.random()-0.5)*0.05, 0.24+Math.random()*0.06, (Math.random()-0.5)*0.05) });
  }

  _getRoadTexture(mask = 0) {
    // Cache per-mask texture so lines connect depending on neighbors
    if (!this.textureCache.road) this.textureCache.road = {};
    if (this.textureCache.road[mask]) return this.textureCache.road[mask];
    const makeTex = (m) => {
      const size = 256; const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
      // Asphalt base
      ctx.fillStyle = '#1e2127'; ctx.fillRect(0,0,size,size);
      const drawVertDash = () => {
        const dashW = 4, dashH = 24, gap = 16, cx = size/2 - dashW/2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        for (let y = 8; y < size - 8; y += dashH + gap) ctx.fillRect(cx, y, dashW, dashH);
      };
      const drawHorzDash = () => {
        const dashW = 24, dashH = 4, gap = 16, cy = size/2 - dashH/2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        for (let x = 8; x < size - 8; x += dashW + gap) ctx.fillRect(x, cy, dashW, dashH);
      };
      const N=1,E=2,S=4,W=8; const vert = (m & N) || (m & S); const horz = (m & E) || (m & W);
      if (!vert && !horz) { // default single tile vertical
        drawVertDash();
      } else {
        if (vert) { drawVertDash(); }
        if (horz) { drawHorzDash(); }
      }
      const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true; return tex;
    };
    const tex = makeTex(mask);
    this.textureCache.road[mask] = tex;
    return tex;
  }

  _onKeyDown(e) {
    if (!this.ghost) return;
    if (this.currentPlacement && this.currentPlacement.type === 'road') return; // auto-connect; ignore rotation for roads
    if (e.key === 'r' || e.key === 'R') {
      this.placementRotation = (this.placementRotation + Math.PI/2) % (Math.PI*2);
      this.ghost.rotation.y = this.placementRotation;
    }
  }

  _isRoadCell(row, col) {
    if (row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) return false;
    const m = this.grid[row][col];
    return !!(m && m.userData && m.userData.type === 'road');
  }

  _computeRoadMask(row, col) {
    const N=1,E=2,S=4,W=8; let mask=0;
    if (this._isRoadCell(row-1, col)) mask |= N;
    if (this._isRoadCell(row, col+1)) mask |= E;
    if (this._isRoadCell(row+1, col)) mask |= S;
    if (this._isRoadCell(row, col-1)) mask |= W;
    return mask;
  }

  _applyRoadTexture(mesh, row, col) {
    const mask = this._computeRoadMask(row, col);
    const tex = this._getRoadTexture(mask);
    if (Array.isArray(mesh.material)) {
      const top = mesh.material[2];
      if (top) { top.map = tex; top.needsUpdate = true; }
    } else {
      mesh.material.map = tex; mesh.material.needsUpdate = true;
    }
  }

  _refreshRoadAndNeighbors(row, col) {
    const list = [ {r:row,c:col}, {r:row-1,c:col}, {r:row+1,c:col}, {r:row,c:col-1}, {r:row,c:col+1} ];
    for (const it of list) {
      if (!this._isRoadCell(it.r, it.c)) continue;
      const m = this.grid[it.r][it.c];
      if (m) {
        this._applyRoadTexture(m, it.r, it.c);
        // Rebuild streetlight(s) for this tile based on connectivity
        this._rebuildStreetLightsForTile(it.r, it.c, m);
      }
    }
  }

  _updateAttachedStreetLight(roadMesh) {
    if (!roadMesh) return;
    roadMesh.traverse(n => {
      if (n.isPointLight) {
        n.intensity = 0.15;
      }
      if (n.material && n.material.emissive) {
        n.material.emissiveIntensity = 0.05;
      }
    });
  }

  _rebuildStreetLightsForTile(row, col, roadMesh) {
    if (!roadMesh) return;
    // Remove any existing lamps on this tile
    const toRemove = [];
    roadMesh.children.forEach(ch => { if (ch.userData && ch.userData.kind === 'streetlight') toRemove.push(ch); });
    for (const n of toRemove) {
      // Also prune tracked point lights
      n.traverse(x => {
        if (x.isPointLight) {
          const idx = this.streetLightPoints.indexOf(x);
          if (idx >= 0) this.streetLightPoints.splice(idx, 1);
        }
      });
      roadMesh.remove(n);
    }

    // Determine road connectivity to choose placement
    const N=1,E=2,S=4,W=8;
    const mask = this._computeRoadMask(row, col);
    const isIntersection = ((mask & N)?1:0)+((mask & E)?1:0)+((mask & S)?1:0)+((mask & W)?1:0) >= 3;
    if (isIntersection) {
      // Avoid clutter: place no lamps on 3- or 4-way intersections
      return;
    }

    // For straight segments, place one lamp on the right edge, staggered by checksum
    // For corners (L-shape), place one lamp on the outer corner
    const cs = ((row*31 + col*17) & 1); // simple stagger bit
    const half = this.cellSize * 0.5;
    const gutter = this.cellSize * 0.06; // offset from asphalt edge
    const yBase = this.cellSize * 0.05;

    const addLampAt = (lx, lz, faceDir) => {
      const lamp = this._createStreetLightMesh();
      lamp.position.set(lx, yBase, lz);
      lamp.userData.kind = 'streetlight';
      roadMesh.add(lamp);
      // Spot-like light: use PointLight for perf
      const intensity = 0.1;
      const p = new THREE.PointLight(0xfff2b6, intensity, this.cellSize * 2.6, 1.6);
      p.position.set(lx, yBase + this.cellSize*0.9, lz);
      p.castShadow = false;
      p.userData.kind = 'streetlight';
      roadMesh.add(p);
      this.streetLightPoints.push(p);
      // Aim the lamp head along faceDir by rotating the arm
      const dirYaw = this._yawForDir(faceDir);
      // The arm runs along +Z from the pole; rotate pole so arm points into the road
      lamp.rotation.y = dirYaw;
    };

    const placeStraight = (dir) => {
      if (dir==='N' || dir==='S') {
        // Vertical: right edge means +X in world, offset from edge and stagger along Z
        const edgeX = half - gutter; // relative to tile center
        const zOff = cs ? -half + gutter : half - gutter; // alternate ends
        addLampAt(edgeX, zOff, 'W');
      } else {
        // Horizontal: right edge means -Z in world
        const edgeZ = -half + gutter;
        const xOff = cs ? half - gutter : -half + gutter;
        addLampAt(xOff, edgeZ, 'N');
      }
    };

    const placeCorner = (outDir) => {
      // outDir indicates the diagonal outward from corner into sidewalk
      const o = half - gutter;
      let lx = 0, lz = 0, face = 'N';
      switch(outDir){
        case 'NE': lx = o; lz = -o; face = 'W'; break;
        case 'NW': lx = -o; lz = -o; face = 'S'; break;
        case 'SE': lx = o; lz = o; face = 'N'; break;
        case 'SW': lx = -o; lz = o; face = 'E'; break;
      }
      addLampAt(lx, lz, face);
    };

    // Decide shape
    const isVert = (mask & N) || (mask & S);
    const isHorz = (mask & E) || (mask & W);
    if ((isVert && isHorz) && !isIntersection) {
      // L turn: determine which corner is road and place lamp on outer corner
      if ((mask & N) && (mask & E)) placeCorner('SW');
      else if ((mask & E) && (mask & S)) placeCorner('NW');
      else if ((mask & S) && (mask & W)) placeCorner('NE');
      else if ((mask & W) && (mask & N)) placeCorner('SE');
    } else if (isVert && !isHorz) {
      placeStraight('N');
    } else if (!isVert && isHorz) {
      placeStraight('E');
    } else {
      // isolated road tile: put a single lamp at one edge
      const o = half - gutter;
      const lx = o, lz = cs ? -o : o;
      addLampAt(lx, lz, cs ? 'W' : 'N');
    }
  }

  _onKeyDown(e) {
    if (!this.ghost) return;
    if (e.key === 'r' || e.key === 'R') {
      // Rotate placement by 90 degrees
      this.placementRotation = (this.placementRotation + Math.PI/2) % (Math.PI*2);
      this.ghost.rotation.y = this.placementRotation;
    }
  }

  _getFacadeTexture(type) {
    const key = `facade_${type}`; if (this.textureCache[key]) return this.textureCache[key];
    const cols = 6, rows = 8; const w = 192, h = 256; const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    // Base wall
    ctx.fillStyle = type==='factory' ? '#c9b6a1' : '#d4d8e5'; ctx.fillRect(0,0,w,h);
    // Slight vertical gradient
    const grad = ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,'rgba(0,0,0,0.08)'); grad.addColorStop(1,'rgba(0,0,0,0.18)'); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
    // Windows grid
    const padX = 12, padY = 16; const winW = (w - padX*2) / cols - 6; const winH = (h - padY*2) / rows - 6;
    for (let r=0;r<rows;r++){
      for (let cidx=0;cidx<cols;cidx++){
        const x = padX + cidx*(winW+6), y = padY + r*(winH+6);
        const on = Math.random()>0.4; // ~60% lit
        ctx.fillStyle = on ? (Math.random()>0.5?'#ffd88a':'#fff4c2') : '#1b1f2a';
        ctx.fillRect(x,y,winW,winH);
        // mullions
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(x+winW*0.5-1,y,2,winH);
        ctx.fillRect(x,y+winH*0.5-1,winW,2);
      }
    }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true; this.textureCache[key] = tex; return tex;
  }

  _createStreetLightMesh() {
    const poleH = this.cellSize * 1.25;
    const poleR = this.cellSize * 0.015;
    const armLen = this.cellSize * 0.2;

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.6, metalness: 0.8 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, poleH, 8), poleMat);
    pole.position.y = poleH / 2;
    pole.castShadow = false; pole.receiveShadow = false;

    // Sleek arm attached near the top of the pole
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, armLen, 8), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0, poleH * 0.45, armLen / 2);
    pole.add(arm);

    // Simple head with anchor for bulb
    const anchor = new THREE.Object3D();
    anchor.name = 'lampAnchor';
    anchor.position.set(0, 0, armLen / 2);
    arm.add(anchor);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(this.cellSize * 0.035, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfff0c0,
        emissiveIntensity: this.timeOfDay === 'night' ? 2.0 : 0.1,
        roughness: 0.1
      })
    );
    bulb.position.set(0, -this.cellSize * 0.025, 0);
    anchor.add(bulb);

    return pole;
  }

  _addBuilding() {
    const idx = this.buildings.length;
    const row = Math.floor(idx / this.gridSize);
    const col = idx % this.gridSize;
    const { x, z } = this._gridToWorld(col, row);

    // Randomized tower-like building
    const baseSize = this.cellSize * 0.8;
    const height = THREE.MathUtils.randFloat(this.cellSize * 1.2, this.cellSize * 2.2);
    const color = new THREE.Color().setHSL(THREE.MathUtils.randFloat(0.55, 0.7), 0.5, 0.6);

    const geo = new THREE.BoxGeometry(baseSize, height, baseSize);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, emissive: 0x0b0b10, emissiveIntensity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, height / 2, z);

    // Entrance detail
    const doorGeo = new THREE.BoxGeometry(baseSize * 0.25, height * 0.12, baseSize * 0.05);
    const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x1b1f2a, metalness: 0.5, roughness: 0.3 }));
    door.position.set(0, -height * 0.35, baseSize * 0.53);
    mesh.add(door);

    // Roof detail
    const roofGeo = new THREE.ConeGeometry(baseSize * 0.4, baseSize * 0.3, 4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, -0.1, 0.1) }));
    roof.position.y = height * 0.55;
    roof.rotation.y = Math.PI / 4;
    mesh.add(roof);

    // Pop-in animation
    mesh.scale.y = 0.01;
    const targetScale = 1;
    const start = performance.now();
    const duration = 500;
    const animateIn = (t) => {
      const e = Math.min((t - start) / duration, 1);
      mesh.scale.y = 0.01 + e * (targetScale - 0.01);
      if (e < 1) requestAnimationFrame(animateIn);
    };
    requestAnimationFrame(animateIn);

    this.scene.add(mesh);
    this.buildings.push(mesh);
  }

  _updateUI() {
    if (this.coinTextEl) this.coinTextEl.textContent = `${this.coins}`;
    if (this.popTextEl) this.popTextEl.textContent = `${this.population}`;
    if (this.happyTextEl) this.happyTextEl.textContent = `${Math.round(this.happiness*100)}%`;
    if (this.expandCityBtn) {
      const canExpand = this.coins >= this.expandCost;
      this.expandCityBtn.disabled = !canExpand;
    }
  }

  _estimateIncomePerSecond() {
    return 0;
  }

  _recomputeCityStats() {
    let pop = 0;
    let happinessSum = 0;
    const basePerHouse = 5;
    const noRoadPenalty = 0.5;
    const factoryPenalty = 0.85;
    const parkBonus = 1.10;

    const hasNeighborType = (row,col,types,dist=1)=>{
      for (let dr=-dist; dr<=dist; dr++){
        for (let dc=-dist; dc<=dist; dc++){
          if (dr===0 && dc===0) continue;
          const nr=row+dr, nc=col+dc;
          if (nr<0||nc<0||nr>=this.gridSize||nc>=this.gridSize) continue;
          const m=this.grid[nr][nc];
          if (!m||!m.userData) continue;
          if (types.includes(m.userData.type)) return true;
        }
      }
      return false;
    };

    const countNeighborType = (row,col,type,maxDist=2)=>{
      let count=0;
      for (let dr=-maxDist; dr<=maxDist; dr++){
        for (let dc=-maxDist; dc<=maxDist; dc++){
          if (dr===0 && dc===0) continue;
          if ((dr*dr+dc*dc) > maxDist*maxDist) continue;
          const nr=row+dr, nc=col+dc;
          if (nr<0||nc<0||nr>=this.gridSize||nc>=this.gridSize) continue;
          const m=this.grid[nr][nc];
          if (!m||!m.userData) continue;
          if (m.userData.type===type) count++;
        }
      }
      return count;
    };

    let housesCount = 0;
    for (let r=0;r<this.gridSize;r++){
      for (let c=0;c<this.gridSize;c++){
        const m=this.grid[r][c];
        if (!m||!m.userData||m.userData.type!=='house') continue;
        housesCount++;
        const nearRoad = hasNeighborType(r,c,['road'],1);
        const factories = countNeighborType(r,c,'factory',2);
        const parks = countNeighborType(r,c,'park',2);
        const housePop = Math.round(basePerHouse * (nearRoad ? 1.0 : noRoadPenalty));
        pop += housePop;
        let h = 1.0;
        for (let i=0;i<factories;i++) h *= factoryPenalty;
        for (let i=0;i<parks;i++) h *= parkBonus;
        h = Math.max(0.2, Math.min(1.2, h));
        happinessSum += h;
        if (!nearRoad) this._toastAtCell(r,c,'House needs roads');
      }
    }

    this.population = pop;
    const avgH = housesCount ? (happinessSum / housesCount) : 1.0;
    this.happiness = Math.max(0.0, Math.min(1.0, avgH));
    // Level based on simple population milestones
    const milestones = [0, 20, 50, 100, 200, 400, 800];
    let lvl = 1; for (let i=0;i<milestones.length;i++){ if (this.population >= milestones[i]) lvl = i+1; else break; }
    this.level = lvl;
    if (this.level > this._lastLevel) {
      this._feed(`Level up! ${this.level}`);
      this._lastLevel = this.level;
    }
    this._updateUI();
  }

  _toastAtCell(row,col,msg){
    const status = document.getElementById('status'); if (!status) return;
    status.textContent = msg; status.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>{ status.style.display='none'; }, 1400);
  }

  _tryExpandCity() {
    if (this.coins < this.expandCost) return;
    this.coins -= this.expandCost;
    this._expandGridByOneRing();
    this._updateUI();
    this._feed(`City expanded to ${this.gridSize}×${this.gridSize}`);
  }

  _expandGridByOneRing() {
    const oldSize = this.gridSize;
    const newSize = oldSize + 2;
    const newGrid = Array.from({ length: newSize }, () => Array(newSize).fill(null));

    // Despawn all smoke puffs (visual-only) to avoid odd offsets
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      this.scene.remove(p.sprite);
      if (p.sprite.material.map) p.sprite.material.map.dispose();
      p.sprite.material.dispose();
      this.smokePuffs.splice(i, 1);
    }

    // Parks to respawn people after shifting
    const parksToRespawn = [];

    // Shift all placed meshes +1 row/col and reassign
    for (let r = 0; r < oldSize; r++) {
      for (let c = 0; c < oldSize; c++) {
        const mesh = this.grid[r][c];
        if (!mesh) continue;
        const newRow = r + 1;
        const newCol = c + 1;
        const pos = this._gridToWorld(newCol, newRow);
        mesh.position.set(pos.x, mesh.position.y, pos.z);
        mesh.userData.grid = { row: newRow, col: newCol };
        newGrid[newRow][newCol] = mesh;
        if (mesh.userData.type === 'park') {
          this._removePeopleForPark(mesh);
          parksToRespawn.push({ mesh, row: newRow, col: newCol });
        }
      }
    }

    // Reassign and resize grid
    this.grid = newGrid;
    this.gridSize = newSize;

    // Rebuild ground plane and grid helper to new size
    this._rebuildGroundAndGrid();

    // (River expansion handling removed)

    // Refresh all road textures for new neighbor masks
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (this._isRoadCell(r, c)) {
          const m = this.grid[r][c];
          if (m) this._applyRoadTexture(m, r, c);
        }
      }
    }



    // Shift cars by +1 cell and update indices
    for (const car of this.cars) {
      car.row += 1; car.col += 1;
      car.mesh.position.x += this.cellSize;
      car.mesh.position.z += this.cellSize;
    }

    // Respawn people for parks at new positions
    for (const p of parksToRespawn) this._spawnPeopleForPark(p.mesh, p.row, p.col);

    // Update camera bounds and target to new center
    const planeSize = this.gridSize * this.cellSize;
    const half = planeSize / 2;
    this.controls.setBounds({ minX: -4, maxX: planeSize + 4, minZ: -4, maxZ: planeSize + 4 });
    this.controls.setTarget(new THREE.Vector3(half, 0, half));
    this.controls.setDistance(Math.max(planeSize * 0.9, 26));

    this._recomputeCityStats();
  }

  _rebuildGroundAndGrid() {
    // Dispose old
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper.geometry.dispose(); this.gridHelper.material.dispose(); this.gridHelper = null; }
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.dispose(); this.ground = null; }

    const planeSize = this.gridSize * this.cellSize;
    const half = planeSize / 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      new THREE.MeshStandardMaterial({ color: 0x1e1f25, roughness: 0.9, metalness: 0.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(half, 0, half);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, 0x3a3e4a, 0x2a2e38);
    gridHelper.position.set(half, 0.01, half);
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }

  _animate() {
  this._raf = requestAnimationFrame(() => this._animate());
  const t = performance.now() * 0.001;
  const dt = Math.min(0.05, Math.max(0.001, t - this._lastTime));
  this._lastTime = t;
  // Apply time scaling to simulation; visuals (shaders) continue real-time
  const sdt = dt * (this.timeScale || 0);

    // (River animation removed)
    if (this._waterShader) {
      this._waterShader.uniforms.uTime.value = t;
    }
    // Water animation
    this._updateWater(t);

    // Subtle emissive pulsing for life
    for (const b of this.buildings) {
      const mat = b.material;
      const pulse = 0.25 + 0.15 * Math.sin(t * 1.2 + b.position.x * 0.2 + b.position.z * 0.2);
      mat.emissiveIntensity = pulse;
    }

  // Smoke update
  for (let i=this.smokePuffs.length-1;i>=0;i--) {
    const p = this.smokePuffs[i];
    p.t += sdt;
    const k = p.t / p.life;
    p.sprite.material.opacity = Math.min(0.9, k*1.2) * (1.0 - k);
    p.sprite.position.addScaledVector(p.drift, this.cellSize * sdt);
    const s = (1 + k*1.6) * this.cellSize*0.7; p.sprite.scale.set(s, s, 1);
    if (k >= 1) { this.scene.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose(); this.smokePuffs.splice(i,1); }
  }

  // Cars: spawn and update (slower cadence)
  this._carSpawnTimer -= sdt;
  if (this._carSpawnTimer <= 0 && this.cars.length < this._maxCars && this._countRoadTiles() >= 2) {
    const start = this._findRandomRoadStart();
    if (start) this._spawnCar(start.row, start.col, start.dir);
    this._carSpawnTimer = 3.0 + Math.random()*2.5;
  }
  this._updateCars(sdt);

  // People wander in parks
  this._updatePeople(sdt);

  this.controls.update();
    // Drive world-space water shader
    if (this._waterWorldUniforms) {
      this._waterWorldUniforms.uTime.value = t;
    }
    if (this._realWaterUniforms) {
      this._realWaterUniforms.uTime.value = t;
    }
    if (this._waterTexSide) {
      this._waterTexSide.offset.x = (this._waterTexSide.offset.x + dt * 0.03) % 1;
      this._waterTexSide.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  _isWaterCell(row, col) {
    if (row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) return false;
    const m = this.grid[row][col];
    return !!(m && m.userData && m.userData.type === 'water');
  }

  _computeWaterMask(row, col) {
    const N=1,E=2,S=4,W=8; let mask=0;
    if (this._isWaterCell(row-1, col)) mask |= N;
    if (this._isWaterCell(row, col+1)) mask |= E;
    if (this._isWaterCell(row+1, col)) mask |= S;
    if (this._isWaterCell(row, col-1)) mask |= W;
    return mask;
  }

  _getWaterTexture(mask=0) {
    if (!this.textureCache.water) this.textureCache.water = {};
    if (this.textureCache.water[mask]) return this.textureCache.water[mask];
    const size = 32;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const dark = '#1b3c73', mid='#215b9a', light='#2fa4e7';
    // Base pattern
    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        const v = ((x + y) % 8);
        const col = v<2 ? light : v<5 ? mid : dark;
        ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
      }
    }
    // Edges if neighbor missing: draw darker 2px border to suggest continuity across tiles
    ctx.fillStyle = '#102945';
    const bw = 2;
    const N=1,E=2,S=4,W=8;
    if (!(mask & N)) ctx.fillRect(0, 0, size, bw);
    if (!(mask & S)) ctx.fillRect(0, size-bw, size, bw);
    if (!(mask & W)) ctx.fillRect(0, 0, bw, size);
    if (!(mask & E)) ctx.fillRect(size-bw, 0, bw, size);
    // Rounded corners (simple pixels) when both adjacent edges are missing
    ctx.fillStyle = '#0b1f39';
    if (!(mask & N) && !(mask & W)) ctx.fillRect(0,0,3,3);
    if (!(mask & N) && !(mask & E)) ctx.fillRect(size-3,0,3,3);
    if (!(mask & S) && !(mask & W)) ctx.fillRect(0,size-3,3,3);
    if (!(mask & S) && !(mask & E)) ctx.fillRect(size-3,size-3,3,3);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1,1);
    tex.needsUpdate = true;
    this.textureCache.water[mask] = tex;
    return tex;
  }

  _applyWaterTexture(mesh, row, col) {
    const mask = this._computeWaterMask(row, col);
    const tex = this._getWaterTexture(mask);
    if (Array.isArray(mesh.material)) {
      const top = mesh.material[2];
      // Only apply to non-shader materials (Minecraft pixel variant)
      if (top && top.isMeshStandardMaterial) { top.map = tex; top.needsUpdate = true; }
    }
  }

  _refreshWaterAtAndNeighbors(row, col) {
    const list = [ {r:row,c:col}, {r:row-1,c:col}, {r:row+1,c:col}, {r:row,c:col-1}, {r:row,c:col+1} ];
    for (const it of list) {
      if (!this._isWaterCell(it.r, it.c)) continue;
      const m = this.grid[it.r][it.c];
      if (m) this._applyWaterTexture(m, it.r, it.c);
    }
  }

  _placeWaterTile(row, col) {
    if (row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) return;
    if (this.grid[row][col]) return; // don't overwrite
    const m = this._createBuildingMesh('water');
    const pos = this._gridToWorld(col, row);
    m.position.set(pos.x, m.position.y, pos.z);
    m.userData = { type: 'water', grid: { col, row } };
    this.scene.add(m);
    this.buildings.push(m);
    this.grid[row][col] = m;
  }

  _refreshAllWater() {
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (this._isWaterCell(r, c)) {
          this._refreshWaterAtAndNeighbors(r, c);
        }
      }
    }
  }

  _generateDefaultPonds() {
    const size = this.gridSize;
    if (size < 3) return;

    const pondCells = new Set();
    const addCircle = (cr, cc, rad) => {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const distSq = (r - cr) * (r - cr) + (c - cc) * (c - cc);
          if (distSq <= rad * rad) {
            pondCells.add(`${r},${c}`);
          }
        }
      }
    };

    // Corner Pond 1 (Mixed circular shape - 2 overlapping circles)
    const r1 = size - 2;
    const c1 = size - 2;
    const r2 = size - 1;
    const c2 = size - 1;
    addCircle(r1, c1, 1.0);
    addCircle(r2, c2, 1.0);

    // Corner Pond 2 (Smaller pond - 1 circle)
    const r3 = 0;
    const c3 = 1;
    const rad3 = size >= 6 ? 1.0 : 0.8; // only 1 tile if grid is small
    addCircle(r3, c3, rad3);

    for (const cellStr of pondCells) {
      const [r, c] = cellStr.split(',').map(Number);
      this._placeWaterTile(r, c);
    }

    this._refreshAllWater();
  }

  _countRoadTiles() {
    let n=0; for (let r=0;r<this.gridSize;r++) for (let c=0;c<this.gridSize;c++) if (this._isRoadCell(r,c)) n++; return n;
  }

  _findRandomRoadStart() {
    // pick random road cell that has at least one neighbor; choose a random direction among neighbors
    const candidates = [];
    for (let r=0;r<this.gridSize;r++){
      for (let c=0;c<this.gridSize;c++){
        if (!this._isRoadCell(r,c)) continue;
        const opts = this._roadNeighborDirs(r,c);
        if (opts.length) candidates.push({ r, c, opts });
      }
    }
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random()*candidates.length)];
    const dir = pick.opts[Math.floor(Math.random()*pick.opts.length)];
    return { row: pick.r, col: pick.c, dir };
  }

  _roadNeighborDirs(row,col) {
    const dirs = [];
    if (this._isRoadCell(row-1,col)) dirs.push('N');
    if (this._isRoadCell(row+1,col)) dirs.push('S');
    if (this._isRoadCell(row,col+1)) dirs.push('E');
    if (this._isRoadCell(row,col-1)) dirs.push('W');
    return dirs;
  }

  _spawnCar(row,col,dir) {
    const bodyLen = this.cellSize * 0.52, bodyW = this.cellSize * 0.32, bodyH = this.cellSize * 0.18;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyLen), new THREE.MeshStandardMaterial({ color: 0x3b89ff, metalness: 0.4, roughness: 0.4, emissive: 0x0b0b10, emissiveIntensity: 0.2 }));
    body.castShadow = true; body.receiveShadow = false;
    // windshield
    const glass = new THREE.Mesh(new THREE.BoxGeometry(bodyW*0.9, bodyH*0.5, bodyLen*0.25), new THREE.MeshStandardMaterial({ color: 0xaad0ff, roughness: 0.1, metalness: 0.9, envMapIntensity: 0.5 }));
    glass.position.set(0, bodyH*0.25, dir==='N'||dir==='S' ? (dir==='S'? bodyLen*0.18 : -bodyLen*0.18) : 0);
    body.add(glass);
    // headlights (small emissive spheres at front)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffaa, emissiveIntensity: this.timeOfDay==='night'? 1.2 : 0.15 });
  const headL = new THREE.Mesh(new THREE.SphereGeometry(bodyW*0.06,8,8), headMat);
    const headR = headL.clone();
    if (dir==='N'||dir==='S') {
      const zf = dir==='S'? bodyLen*0.36 : -bodyLen*0.36; headL.position.set(bodyW*0.26, -bodyH*0.15, zf); headR.position.set(-bodyW*0.26, -bodyH*0.15, zf);
    } else {
      const xf = dir==='E'? bodyLen*0.36 : -bodyLen*0.36; headL.position.set(xf, -bodyH*0.15, bodyW*0.26); headR.position.set(xf, -bodyH*0.15, -bodyW*0.26);
    }
    body.add(headL); body.add(headR);

    const center = this._gridToWorld(col, row);
    const y = this.cellSize*0.05 + bodyH/2 + 0.02;
  // Two-way: enforce right-hand traffic lane (one lane each direction)
  const laneSign = 1; // always right side relative to heading
    const laneOffset = this.cellSize * 0.18;
    const vdir = this._dirVec(dir);
    const perp = { x: -vdir.z, z: vdir.x };
    const ox = center.x + perp.x * laneSign * laneOffset;
    const oz = center.z + perp.z * laneSign * laneOffset;
    body.position.set(ox, y, oz);
    body.rotation.y = this._yawForDir(dir);
    this.scene.add(body);
    const car = { mesh: body, row, col, dir, t: 0, speed: this.cellSize * (0.55 + Math.random()*0.35), laneSign, laneOffset };
    this.cars.push(car);
  }

  _yawForDir(dir){ return dir==='N'? Math.PI : dir==='S'? 0 : dir==='E'? -Math.PI/2 : Math.PI/2; }

  _updateCars(dt) {
    const step = (c) => {
      const v = this._dirVec(c.dir);
      c.t += (c.speed * dt) / (this.cellSize);
      const start = this._gridToWorld(c.col, c.row);
      // Apply lane offset perpendicular to travel direction
      const perp = { x: -v.z, z: v.x };
      const nx = start.x + v.x * this.cellSize * c.t + perp.x * c.laneSign * c.laneOffset;
      const nz = start.z + v.z * this.cellSize * c.t + perp.z * c.laneSign * c.laneOffset;
      c.mesh.position.x = nx; c.mesh.position.z = nz;
      if (c.t >= 1) {
        // advance to next cell
        const nextRow = c.row + v.gr;
        const nextCol = c.col + v.gc;
        if (!this._isRoadCell(nextRow, nextCol)) {
          // try to turn at intersection
          const choices = this._roadNeighborDirs(c.row, c.col).filter(d => d !== this._oppositeDir(c.dir));
          if (choices.length) {
            c.dir = choices[Math.floor(Math.random()*choices.length)];
            c.mesh.rotation.y = this._yawForDir(c.dir);
          } else {
            c.dir = this._oppositeDir(c.dir);
            c.mesh.rotation.y = this._yawForDir(c.dir);
          }
        } else {
          c.row = nextRow; c.col = nextCol;
        }
        c.t = 0;
      }
    };
    for (let i=this.cars.length-1;i>=0;i--) {
      const c = this.cars[i];
      step(c);
      // Remove if off-grid (safety)
      if (c.row<0||c.col<0||c.row>=this.gridSize||c.col>=this.gridSize) {
        this.scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); this.cars.splice(i,1);
      }
    }
  }

  _oppositeDir(d){ return d==='N'?'S': d==='S'?'N': d==='E'?'W':'E'; }
  _dirVec(d){
    switch(d){
      case 'N': return { x:0, z:-1, gr:-1, gc:0 };
      case 'S': return { x:0, z: 1, gr: 1, gc:0 };
      case 'E': return { x: 1, z:0, gr:0, gc: 1 };
      case 'W': return { x:-1, z:0, gr:0, gc:-1 };
    }
    return { x:0, z:0, gr:0, gc:0 };
  }

  _spawnPeopleForPark(parkMesh, row, col) {
    const count = 3 + Math.floor(Math.random()*3);
    const center = this._gridToWorld(col, row);
    const half = this.cellSize * 0.42;
    for (let i=0;i<count;i++){
      const bodyH = this.cellSize*0.24;
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.08, this.cellSize*0.1, bodyH, 10), new THREE.MeshStandardMaterial({ color: 0x4ba86b, roughness: 0.8 }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(this.cellSize*0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffe2c0 }));
      head.position.y = bodyH*0.6; torso.add(head);
      const startX = center.x + (Math.random()*2-1)*half*0.7;
      const startZ = center.z + (Math.random()*2-1)*half*0.7;
      const y = this.cellSize*0.05 + bodyH/2 + 0.02;
      torso.position.set(startX, y, startZ);
      torso.castShadow = true; torso.receiveShadow = true;
      this.scene.add(torso);
      const target = { x: center.x + (Math.random()*2-1)*half*0.8, z: center.z + (Math.random()*2-1)*half*0.8 };
      this.people.push({ mesh: torso, row, col, park: parkMesh, speed: this.cellSize*(0.25+Math.random()*0.15), target, bob: Math.random()*Math.PI*2 });
    }
  }

  _removePeopleForPark(parkMesh) {
    for (let i=this.people.length-1;i>=0;i--) {
      if (this.people[i].park === parkMesh) {
        const p = this.people[i];
        this.scene.remove(p.mesh); p.mesh.traverse(n=>{ if(n.isMesh){ n.geometry.dispose(); if(n.material.map) n.material.map.dispose(); n.material.dispose(); }});
        this.people.splice(i,1);
      }
    }
  }

  _updatePeople(dt) {
    for (const p of this.people) {
      // bobbing animation
      p.bob += dt*6; p.mesh.position.y += Math.sin(p.bob)*0.002;
      // move towards target
      const dx = p.target.x - p.mesh.position.x; const dz = p.target.z - p.mesh.position.z; const dist = Math.hypot(dx,dz);
      if (dist < 0.05) {
        // pick new target within the same park cell
        const center = this._gridToWorld(p.col, p.row);
        const half = this.cellSize * 0.42; p.target = { x: center.x + (Math.random()*2-1)*half*0.8, z: center.z + (Math.random()*2-1)*half*0.8 };
      } else {
        const vx = (dx/dist) * p.speed * dt; const vz = (dz/dist) * p.speed * dt;
        p.mesh.position.x += vx; p.mesh.position.z += vz;
        p.mesh.rotation.y = Math.atan2(vx, vz);
      }
    }
  }

  _bindResize() {
    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  // (River helper functions removed)

  // Water: toggleable decorative band with flowing shader
  _toggleWater() {
    if (this.water.enabled) {
      this._destroyWater();
      this.water.enabled = false;
      if (this.toggleWaterBtn) this.toggleWaterBtn.textContent = 'Toggle Water';
      this._feed('Water: Off');
    } else {
      this._createWater();
      this.water.enabled = true;
      if (this.toggleWaterBtn) this.toggleWaterBtn.textContent = 'Water: On';
      this._feed('Water: On');
    }
  }

  _createWater() {
    const planeSize = this.gridSize * this.cellSize;
    const half = planeSize / 2;
    const riverWidth = Math.max(10, planeSize * 0.38);
    const riverLength = planeSize + 30;
    const geo = new THREE.PlaneGeometry(riverLength, riverWidth, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color(0x0a2740) },
      uShallowColor: { value: new THREE.Color(0x2aa6b8) },
      uSpecularColor: { value: new THREE.Color(0xffffff) },
      uLightDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
      uFlowDir: { value: new THREE.Vector2(1.0, 0.15).normalize() },
    };
    const vert = `uniform float uTime; varying vec3 vWorldPos; varying vec2 vXZ; float waveHeight(vec2 p, float t){ float h=0.0; h += 0.22 * sin(dot(p, vec2(1.2, 0.6)) * 0.35 + t * 0.8); h += 0.12 * sin(dot(p, vec2(-0.7, 1.1)) * 0.6 + t * 1.3); h += 0.05 * sin(dot(p, vec2(0.2, -1.7)) * 1.2 + t * 1.9); return h; } void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vXZ = wp.xz; float h = waveHeight(vXZ, uTime); wp.y += h; gl_Position = projectionMatrix * viewMatrix * wp; }`;
    const frag = `precision highp float; uniform float uTime; uniform vec3 uDeepColor; uniform vec3 uShallowColor; uniform vec3 uSpecularColor; uniform vec3 uLightDir; uniform vec2 uFlowDir; varying vec3 vWorldPos; varying vec2 vXZ; float waveHeight(vec2 p, float t){ float h=0.0; h += 0.22 * sin(dot(p, vec2(1.2, 0.6)) * 0.35 + t * 0.8); h += 0.12 * sin(dot(p, vec2(-0.7, 1.1)) * 0.6 + t * 1.3); h += 0.05 * sin(dot(p, vec2(0.2, -1.7)) * 1.2 + t * 1.9); return h; } vec3 computeNormal(vec2 p, float t){ float e = 0.4; float h = waveHeight(p, t); float hx = waveHeight(p + vec2(e, 0.0), t); float hz = waveHeight(p + vec2(0.0, e), t); vec3 dx = vec3(e, hx - h, 0.0); vec3 dz = vec3(0.0, hz - h, e); return normalize(cross(dz, dx)); } void main(){ vec3 N = computeNormal(vXZ, uTime); vec3 V = normalize(cameraPosition - vWorldPos); vec3 L = normalize(uLightDir); float NoV = clamp(dot(N, V), 0.0, 1.0); float F = pow(1.0 - NoV, 5.0); vec3 base = mix(uDeepColor, uShallowColor, clamp(F*0.85 + 0.15, 0.0, 1.0)); float flow = sin(dot(vXZ, uFlowDir * 0.25) + uTime * 1.4) * 0.5 + 0.5; flow *= sin(dot(vXZ, vec2(-uFlowDir.y, uFlowDir.x) * 0.18) + uTime * 0.9) * 0.5 + 0.5; float streaks = smoothstep(0.75, 0.98, flow); base += 0.08 * streaks; vec3 H = normalize(L + V); float spec = pow(max(dot(N, H), 0.0), 90.0) * 0.8; vec3 color = base + uSpecularColor * spec * (0.35 + 0.65*F); gl_FragColor = vec4(color, 0.92); }`;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(half, 0.02, half - planeSize * 0.55);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.water.mesh = mesh;
    this.water.material = mat;
    this.water.uniforms = uniforms;
  }

  _destroyWater() {
    if (!this.water.mesh) return;
    this.scene.remove(this.water.mesh);
    this.water.mesh.geometry.dispose();
    this.water.material.dispose();
    this.water.mesh = null;
    this.water.material = null;
    this.water.uniforms = null;
  }

  _rebuildWaterGeometry() {
    if (!this.water.enabled) return;
    this._destroyWater();
    this._createWater();
  }

  _updateWater(t) {
    if (!this.water || !this.water.uniforms) return;
    this.water.uniforms.uTime.value = t;
  }

  // --- Dashboard helpers ---
  setTimeScale(scale) {
    const clamped = Math.max(0, Math.min(3, Math.floor(scale)));
    this.timeScale = clamped;
    // Update speed button active state if present
    const mark = (el, on)=>{ if (!el) return; el.classList.toggle('active', !!on); };
    if (this.speedBtns) {
      mark(this.speedBtns.pause, clamped === 0);
      mark(this.speedBtns.x1, clamped === 1);
      mark(this.speedBtns.x2, clamped === 2);
      mark(this.speedBtns.x3, clamped === 3);
    }
    this._feed(`Speed: ${clamped===0?'Paused':clamped+'x'}`);
  }

  _feed(message, level = 'info') {
    const container = document.getElementById('feed')
      || document.getElementById('feedList')
      || (document.querySelector('#rightPanel .feed'))
      || (document.querySelector('.feed'));
    if (!container) return; // quietly no-op if feed panel absent
    const item = document.createElement('div');
    item.className = `feed-item ${level}`;
    const ts = new Date();
    const hh = ts.getHours().toString().padStart(2,'0');
    const mm = ts.getMinutes().toString().padStart(2,'0');
    item.textContent = `[${hh}:${mm}] ${message}`;
    container.prepend(item);
    // Trim feed length
    const maxItems = 30;
    while (container.children.length > maxItems) container.removeChild(container.lastChild);
  }


}

// Hook up to window for easy access from HTML
window.City3DGame = City3DGame;
