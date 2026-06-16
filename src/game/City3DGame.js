import * as THREE from 'three';
import { CoCCameraController } from './CoCCameraController.js';
import { ASSETS } from './assets.js';

class City3DGame {
  constructor({ containerId, gridSize = 5, cellSize = 6 }) {
    this.container = document.getElementById(containerId);
    this.gridSize = gridSize;
    this.cellSize = cellSize; // world units per cell (meters)
    this.baseGridSize = gridSize;

  this.happinessPoints = 0;
  this.population = 0;
  this.happiness = 1.0; // 0..1
  this.level = 1;
  this.maxLevel = 4;
  this.buildings = []; // store meshes
  this.grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  this.raycaster = new THREE.Raycaster();
  this.mouse = new THREE.Vector2();
  this.ghost = null; // preview mesh
  this.currentPlacement = null; // { type, cost }
  this.isRelocating = null; // building being moved
  this._geoCache = {};
  this._matCache = {};
  this._textureCache = {};
  this.assetScenes = {};
  this.assetPromises = {};
  this.surfaceThemes = {};
  this.surfaceThemePromise = null;
  this.personAssetPromise = null;
  this.personAssetScene = null;
  this.placementRotation = 0; // radians; used during placement
  this.smokePuffs = [];
  this.liveBuildingParts = [];
  this._lastTime = performance.now() * 0.001;
  this.cars = [];
  this.people = [];
  this.visitors = [];
  this._carSpawnTimer = 0;
  this._maxCars = 6;
  this._levelTransitionPending = false;
  // Simulation speed control (0 = paused, 1/2/3 = normal/2x/3x)
  this.timeScale = 1;

  // Building registry: maps building type to its unlock level
  this.buildingRegistry = {
    // Level 1
    house1: { level: 1 }, factory: { level: 1 }, tower: { level: 1 }, shop: { level: 1 },
    // Level 2
    house2: { level: 2 }, apartment: { level: 2 }, clockTower: { level: 2 },
    // Level 3
    skyscraper: { level: 3 }, hospital: { level: 3 }, fireStation: { level: 3 },
    // Level 4
    school: { level: 4 }, library: { level: 4 }, bakery: { level: 4 },
  };

    this._initThree();
    this._initScene();
    this._bootstrapSurfaceThemes();
    this._bootstrapPersonAsset();
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
  const gridColors = this._getGridHelperColors();

  const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      this._getThemeMaterial('concrete', false)
    );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(half, 0, half);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

  // Grid helper lines
  const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, gridColors.major, gridColors.minor);
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
  this.levelTextEl = document.getElementById('levelText') || null;
  this.progressTextEl = document.getElementById('progressText') || null;
  this.happyPointsTextEl = document.getElementById('happinessPointsText') || null;
  this.happyTextEl = document.getElementById('happyText') || null;
    // Store buttons
    this.ui = {
      buyRoad: document.getElementById('buyRoad'),
      buyHouse1: document.getElementById('buyHouse1'),
      buyFactory: document.getElementById('buyFactory'),
      buyTower: document.getElementById('buyTower'),
      buyShop: document.getElementById('buyShop'),
      buyHouse2: document.getElementById('buyHouse2'),
      buyApartment: document.getElementById('buyApartment'),
      buyClockTower: document.getElementById('buyClockTower'),
      buySkyscraper: document.getElementById('buySkyscraper'),
      buyHospital: document.getElementById('buyHospital'),
      buyFireStation: document.getElementById('buyFireStation'),
      buySchool: document.getElementById('buySchool'),
      buyLibrary: document.getElementById('buyLibrary'),
      buyBakery: document.getElementById('buyBakery'),
      buyTreeA: document.getElementById('buyTreeA'),
      buyTreeB: document.getElementById('buyTreeB'),
      buyFlowerGarden: document.getElementById('buyFlowerGarden'),
      buyPark: document.getElementById('buyPark'),
      cancelPlacement: document.getElementById('cancelPlacement')
    };

  // Hook getHappinessBtn
  const getHappyBtn = document.getElementById('getHappinessBtn');
  if (getHappyBtn) {
    getHappyBtn.addEventListener('click', () => {
      this.happinessPoints += 10;
      this._updateUI();
      this._feed('Earned 10 Happiness Points!');
    });
  }
  
  // Level 1
  this._hookStore('buyHouse1', { type: 'house1', cost: 0 });
  this._hookStore('buyFactory', { type: 'factory', cost: 0 });
  this._hookStore('buyTower', { type: 'tower', cost: 0 });
  this._hookStore('buyShop', { type: 'shop', cost: 0 });
  
  // Level 2
  this._hookStore('buyHouse2', { type: 'house2', cost: 0 });
  this._hookStore('buyApartment', { type: 'apartment', cost: 0 });
  this._hookStore('buyClockTower', { type: 'clockTower', cost: 0 });
  
  // Level 3
  this._hookStore('buySkyscraper', { type: 'skyscraper', cost: 0 });
  this._hookStore('buyHospital', { type: 'hospital', cost: 0 });
  this._hookStore('buyFireStation', { type: 'fireStation', cost: 0 });

  // Level 4
  this._hookStore('buySchool', { type: 'school', cost: 0 });
  this._hookStore('buyLibrary', { type: 'library', cost: 0 });
  this._hookStore('buyBakery', { type: 'bakery', cost: 0 });

  // Happiness Shop (Costs happiness points)
  this._hookStore('buyTreeA', { type: 'treeA', cost: 10, isDecoration: true });
  this._hookStore('buyTreeB', { type: 'treeB', cost: 15, isDecoration: true });
  this._hookStore('buyFlowerGarden', { type: 'flowerGarden', cost: 25, isDecoration: true });
  this._hookStore('buyPark', { type: 'park', cost: 50, isDecoration: true });

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

  _getLevelGridSize(level = this.level) {
    return this.baseGridSize + Math.max(0, level - 1) * 2;
  }

  _getLevelProgressTarget() {
    return this.gridSize * this.gridSize;
  }

  _countFilledCells() {
    let filled = 0;
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (this.grid[r][c]) filled++;
      }
    }
    return filled;
  }

  _isGridFull() {
    return this._countFilledCells() >= this._getLevelProgressTarget();
  }

  _checkLevelProgression() {
    if (this._levelTransitionPending || this.level >= this.maxLevel || !this._isGridFull()) return false;

    this.level++;
    this.happinessPoints += 25;
    this._feed(`Level up! ${this.level}`);
    this._toastAtCell(Math.floor(this.gridSize / 2), Math.floor(this.gridSize / 2), `🎉 Level Up! Now Level ${this.level}`);

    this._levelTransitionPending = true;
    try {
      this._expandGridByOneRing();
    } finally {
      this._levelTransitionPending = false;
    }

    this._updateUI();
    return true;
  }

  _getGridHelperColors() {
    return {
      major: 0x64707d,
      minor: 0x92a0ac,
    };
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
      // Check if building is locked
      const reg = this.buildingRegistry[placement.type];
      if (reg && reg.level > this.level) {
        this._toastAtCell(Math.floor(this.gridSize/2), Math.floor(this.gridSize/2), `🔒 Unlock at Level ${reg.level}!`);
        return;
      }
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
    mesh.traverse?.((child) => {
      if (child === mesh || !child.material) return;
      if (Array.isArray(child.material)) child.material.forEach(apply);
      else apply(child.material);
    });
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
      const placementType = this.currentPlacement ? this.currentPlacement.type : (this.isRelocating ? this.isRelocating.userData.type : null);
      const reg = placementType ? this.buildingRegistry[placementType] : null;
      const unlocked = !reg || reg.level <= this.level;
      const canPlace = free && unlocked;
      this._setGhostColor(this.ghost, canPlace ? 0x66ff99 : 0xff6666);
    }
  }

  _onClick(event) {
    // Place selected type or confirm relocation
    if (this.controls && this.controls._didDragLastGesture) {
      this.controls._didDragLastGesture = false;
      return; // avoid accidental placement after a pan gesture
    }
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
      // If moving a park, move its people (respawn at new location)
      if (mesh.userData.type === 'park') {
        this._removePeopleForPark(mesh);
        this._spawnPeopleForPark(mesh, row, col);
      }
      this._removeVisitorsForBuilding(mesh);
      this._spawnVisitorsForBuilding(mesh, row, col);

      this.isRelocating = null;
      this._recomputeCityStats();
      this._feed('Building moved');
      if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
      return;
    }

    if (!this.currentPlacement) return;
    // Check unlock level
    const reg = this.buildingRegistry[this.currentPlacement.type];
    if (reg && reg.level > this.level) {
      this._toastAtCell(row, col, `Unlock at Level ${reg.level}!`);
      return;
    }
    if (this.grid[row][col]) return; // occupied
    if (this.currentPlacement.isDecoration && this.happinessPoints < this.currentPlacement.cost) {
      this._toastAtCell(row, col, "Not enough Happiness Points!");
      return; // not enough points
    }

    const mesh = this._createBuildingMesh(this.currentPlacement.type);
    const pos = this._gridToWorld(col, row);
    mesh.position.set(pos.x, mesh.position.y, pos.z);
    mesh.rotation.y = this.currentPlacement.type === 'road' ? 0 : this.placementRotation;
    mesh.userData = { type: this.currentPlacement.type, grid: { col, row }, isDecoration: this.currentPlacement.isDecoration };
    this.scene.add(mesh);
    this.buildings.push(mesh);
    this.grid[row][col] = mesh;
    this._spawnVisitorsForBuilding(mesh, row, col);
    
    if (this.currentPlacement.isDecoration) {
      this.happinessPoints -= this.currentPlacement.cost;
    } else if (this.currentPlacement.type !== 'road') {
      // Building things gives small amount of happiness points
      this.happinessPoints += 2;
    }

    // If park, spawn people
    if (mesh.userData.type === 'park') {
      this._spawnPeopleForPark(mesh, row, col);
    }

    this._recomputeCityStats();
    this._updateUI();
    this._feed(`Placed ${mesh.userData.type}`);
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

  _onKeyDown(e) {
    if (e.key === 'r' || e.key === 'R') {
      this.placementRotation += Math.PI / 2;
      if (this.ghost) this.ghost.rotation.y = this.placementRotation;
    }
    if (e.key === 'Escape') {
      this._cancelPlacement();
      const cancelBtn = document.getElementById('cancelPlacement');
      if (cancelBtn) cancelBtn.classList.remove('visible');
    }
  }

  _createBuildingMesh(type, opts = {}) {
    const ghost = !!opts.ghost;
    const heightBy = {
      road: 0.1,
      house1: 1.2, house2: 1.2,
      tower: 2.0, apartment: 1.5, clockTower: 2.2, skyscraper: 3.0,
      factory: 1.0,
      shop: 0.8,
      hospital: 1.2, fireStation: 0.8,
      school: 0.9, library: 1.1, bakery: 0.7,
      park: 0.2, treeA: 0.8, treeB: 0.9, flowerGarden: 0.2,
    };
    const h = (this.cellSize) * (heightBy[type] || 1.0);
    return this._createAssetMesh(type, ghost, h);
  }

  _createAssetMesh(type, ghost) {
    const mesh = new THREE.Group();
    mesh.userData.assetType = type;

    // Build the procedural kid-friendly fallback first
    const procedural = this._buildProceduralFallback(type, ghost);
    mesh.add(procedural);

    this._loadAsset(type)
      .then((assetScene) => {
        if (!assetScene) return; // stick with procedural
        const model = assetScene.clone(true);
        model.name = `${type} asset`;
        this._prepareAssetModel(model, ghost, type);
        // Replace procedural with loaded model
        mesh.remove(procedural);
        mesh.add(model);
      })
      .catch((err) => {
        console.warn(`Could not load asset for ${type}, keeping procedural fallback.`, err.message);
      });

    if (!ghost) {
      // pop-in animation
      mesh.scale.y = 0.01;
      const targetScale = 1; const start = performance.now(); const duration = 450;
      const animateIn = (t) => { const e = Math.min((t - start) / duration, 1); mesh.scale.y = 0.01 + e * (targetScale - 0.01); if (e < 1) requestAnimationFrame(animateIn); };
      requestAnimationFrame(animateIn);
      this._addLiveBuildingDetails(mesh, type);
    }
    return mesh;
  }

  _getCachedGeometry(key, factory) {
    if (!this._geoCache[key]) this._geoCache[key] = factory();
    return this._geoCache[key];
  }

  _getCachedMaterial(key, factory) {
    if (!this._matCache[key]) this._matCache[key] = factory();
    return this._matCache[key];
  }

  _getTexture(url, colorSpace = null) {
    if (!url) return Promise.resolve(null);
    if (this._textureCache[url]) return this._textureCache[url];
    this._textureCache[url] = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.anisotropy = Math.min(8, this.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
          if (colorSpace !== null && 'colorSpace' in tex) tex.colorSpace = colorSpace;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
    return this._textureCache[url];
  }

  async _loadAmbientMaterialSet(assetId) {
    const response = await fetch(`https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(assetId)}&limit=1`);
    const data = await response.json();
    const asset = data?.foundAssets?.[0];
    const previewUrl = asset?.previewLinks?.[0]?.url;
    if (!previewUrl) throw new Error(`No preview URL for ${assetId}`);
    const params = new URLSearchParams(new URL(previewUrl).hash.slice(1));
    const urls = {
      color: params.get('color_url'),
      normal: params.get('normal_url'),
      roughness: params.get('roughness_url'),
      ao: params.get('ambientocclusion_url'),
    };
    const [color, normal, roughness, ao] = await Promise.all([
      this._getTexture(urls.color, THREE.SRGBColorSpace),
      this._getTexture(urls.normal, THREE.NoColorSpace),
      this._getTexture(urls.roughness, THREE.NoColorSpace),
      this._getTexture(urls.ao, THREE.NoColorSpace),
    ]);
    if (normal) normal.normalScale = new THREE.Vector2(1, -1);
    return { color, normal, roughness, ao };
  }

  _getThemeMaterial(theme, ghost = false) {
    const key = `theme:${theme}:${ghost ? 'ghost' : 'live'}`;
    return this._getCachedMaterial(key, () => {
      const palette = {
        wall: { color: 0xddd7cc, roughness: 0.95, metalness: 0.02 },
        roof: { color: 0x73584d, roughness: 0.85, metalness: 0.05 },
        wood: { color: 0x8d6547, roughness: 0.9, metalness: 0.02 },
        metal: { color: 0x9ea8b1, roughness: 0.45, metalness: 0.55 },
        glass: { color: 0xa9d8ff, roughness: 0.05, metalness: 0.08, transparent: true, opacity: 0.68 },
        asphalt: { color: 0x22272f, roughness: 1.0, metalness: 0.0 },
        grass: { color: 0x638a44, roughness: 1.0, metalness: 0.0 },
        concrete: { color: 0xa6a9ad, roughness: 0.98, metalness: 0.01 },
        plaster: { color: 0xd7d0c5, roughness: 0.92, metalness: 0.01 },
        water: { color: 0x4aa6d9, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.8 },
      };
      const base = palette[theme] || palette.wall;
      return new THREE.MeshStandardMaterial({
        color: ghost ? 0xdbe3ec : base.color,
        roughness: base.roughness,
        metalness: base.metalness,
        transparent: ghost ? true : !!base.transparent,
        opacity: ghost ? 0.35 : (base.opacity ?? 1),
        depthWrite: !ghost,
      });
    });
  }

  _applyTextureSetToTheme(theme, set) {
    const mat = this._getThemeMaterial(theme, false);
    const repeats = {
      wall: [2, 2],
      wood: [2, 2],
      metal: [2, 2],
      asphalt: [6, 6],
      grass: [6, 6],
      concrete: [4, 4],
    }[theme] || [2, 2];
    const applyRepeat = (tex) => {
      if (!tex) return;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeats[0], repeats[1]);
      tex.needsUpdate = true;
    };
    applyRepeat(set.color);
    applyRepeat(set.normal);
    applyRepeat(set.roughness);
    applyRepeat(set.ao);
    if (set.color) mat.map = set.color;
    if (set.normal) mat.normalMap = set.normal;
    if (set.roughness) mat.roughnessMap = set.roughness;
    if (set.ao) mat.aoMap = set.ao;
    mat.needsUpdate = true;
  }

  _bootstrapSurfaceThemes() {
    if (this.surfaceThemePromise) return this.surfaceThemePromise;
    const sources = {
      wall: 'Bricks038',
      wood: 'Wood063',
      metal: 'PaintedMetal006',
      asphalt: 'Asphalt031',
      grass: 'Grass004',
      concrete: 'Ground037',
    };
    this.surfaceThemePromise = Promise.all(
      Object.entries(sources).map(async ([theme, assetId]) => {
        try {
          const textures = await this._loadAmbientMaterialSet(assetId);
          this.surfaceThemes[theme] = textures;
          this._applyTextureSetToTheme(theme, textures);
        } catch (err) {
          console.warn(`Texture set ${assetId} failed to load`, err.message);
        }
      })
    );
    return this.surfaceThemePromise;
  }

  _bootstrapPersonAsset() {
    if (this.personAssetPromise) return this.personAssetPromise;
    this.personAssetPromise = import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/utils/SkeletonUtils.js')
        .then((SkeletonUtils) => new Promise((resolve, reject) => {
          const loader = new GLTFLoader();
          loader.load(
            'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb',
            (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations, SkeletonUtils }),
            undefined,
            () => resolve(null)
          );
        })))
      .then((bundle) => {
        this.personAssetScene = bundle;
        return bundle;
      })
      .catch((err) => {
        console.warn('Person asset load failed, using fallback people.', err.message);
        return null;
      });
    return this.personAssetPromise;
  }

  _makePersonModel() {
    if (!this.personAssetScene) return null;
    const { scene, animations, SkeletonUtils } = this.personAssetScene;
    if (!scene) return null;
    const clone = SkeletonUtils?.clone ? SkeletonUtils.clone(scene) : scene.clone(true);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (mat.color) {
            const tint = new THREE.Color().setHSL(THREE.MathUtils.randFloat(0.02, 0.12), 0.45, THREE.MathUtils.randFloat(0.45, 0.72));
            mat.color.multiply(tint);
          }
        }
      }
    });
    const mixer = animations?.length ? new THREE.AnimationMixer(clone) : null;
    if (mixer && animations.length) {
      const action = mixer.clipAction(animations[0]);
      action.play();
    }
    clone.scale.setScalar(this.cellSize * 0.035);
    clone.rotation.y = Math.PI;
    return { model: clone, mixer };
  }

  _makeWindowMesh(w, h, d, x, y, z, color = 0xcfe8ff, emissive = 0xffd36b, ghost = false) {
    const mat = this._getCachedMaterial(`win:${color.toString(16)}:${emissive.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xd7e3ee : color,
      emissive: ghost ? 0x000000 : emissive,
      emissiveIntensity: ghost ? 0.0 : 0.22,
      roughness: 0.2,
      metalness: 0.65,
      transparent: !!ghost,
      opacity: ghost ? 0.35 : 1,
      depthWrite: !ghost,
    }));
    const mesh = new THREE.Mesh(this._getCachedGeometry(`win:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  _makeTrimMesh(w, h, d, x, y, z, color, ghost = false) {
    const mat = this._getCachedMaterial(`trim:${color.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xd3dce6 : color,
      roughness: 0.55,
      metalness: 0.08,
      transparent: !!ghost,
      opacity: ghost ? 0.28 : 1,
      depthWrite: !ghost,
    }));
    const mesh = new THREE.Mesh(this._getCachedGeometry(`trim:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  _makeCylinderDetail(rt, rb, h, seg, x, y, z, color, ghost = false) {
    const mat = this._getCachedMaterial(`cyl:${color.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xdbe3ec : color,
      roughness: 0.45,
      metalness: 0.18,
      transparent: !!ghost,
      opacity: ghost ? 0.28 : 1,
      depthWrite: !ghost,
    }));
    const mesh = new THREE.Mesh(this._getCachedGeometry(`cyl:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  async _loadAsset(type) {
    if (!this.assetScenes) this.assetScenes = {};
    if (!this.assetPromises) this.assetPromises = {};
    
    if (this.assetScenes[type]) return Promise.resolve(this.assetScenes[type]);
    if (this.assetPromises[type]) return this.assetPromises[type];

    const url = ASSETS[type];
    if (!url) return Promise.reject(new Error(`No asset mapping for ${type}`));

    // Asset loading: the GLTFLoader's error handler already falls back to
    // procedural meshes gracefully, so no pre-filtering is needed.

    this.assetPromises[type] = import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            this.assetScenes[type] = gltf.scene;
            resolve(gltf.scene);
          },
          undefined,
          (err) => {
            console.warn(`Error loading GLB for ${type} at ${url}. Using fallback.`);
            resolve(null); // Resolve to null to use procedural fallback instead of rejecting entirely
          }
        );
      })).catch(err => {
         console.warn(`Fallback to procedural for ${type}.`, err.message);
         return null;
      });
    return this.assetPromises[type];
  }

  _buildProceduralFallback(type, ghost) {
    const group = new THREE.Group();
    // Rotate to face camera
    group.rotation.y = Math.PI;
    
    const cellSize = this.cellSize;
    const baseSize = cellSize * 0.85;
    
    // Kid-friendly material helper with real textured theme materials when possible.
    const getMat = (colorHex) => {
      const themeMap = new Map([
        [0x28313d, 'asphalt'],
        [0xffe2b3, 'wall'],
        [0xa3e4d7, 'wall'],
        [0xe67e22, 'wall'],
        [0x3498db, 'concrete'],
        [0x2ecc71, 'grass'],
        [0xe74c3c, 'wall'],
        [0xecf0f1, 'concrete'],
        [0x1abc9c, 'plaster'],
        [0xd35400, 'wood'],
        [0xffffff, 'concrete'],
        [0xc0392b, 'roof'],
        [0x34495e, 'metal'],
        [0xf1c40f, 'roof'],
        [0x27ae60, 'grass'],
        [0x9b59b6, 'wall'],
        [0xbdc3c7, 'metal'],
        [0xf39c12, 'roof'],
        [0x2ecc71, 'grass'],
        [0x95a5a6, 'concrete'],
        [0x8e44ad, 'wood'],
        [0x8fc9f0, 'water'],
      ]);
      const theme = themeMap.get(colorHex);
      if (theme) return this._getThemeMaterial(theme, ghost);
      return new THREE.MeshStandardMaterial({
        color: ghost ? 0xcfd8e3 : colorHex,
        roughness: 0.6,
        metalness: 0.1,
        opacity: ghost ? 0.35 : 1.0,
        transparent: !!ghost,
        depthWrite: !ghost,
      });
    };
    
    const winMat = this._getThemeMaterial('glass', ghost);
    const createWin = (w, h, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), winMat);
      mesh.position.set(x, y, z);
      return mesh;
    };

    const bodyH = {
      house1: cellSize * 0.8,
      house2: cellSize * 1.0,
      factory: cellSize * 0.7,
      tower: cellSize * 1.8,
      shop: cellSize * 0.6,
      apartment: cellSize * 1.5,
      clockTower: cellSize * 2.0,
      skyscraper: cellSize * 3.0,
      hospital: cellSize * 1.2,
      fireStation: cellSize * 0.8,
      school: cellSize * 0.9,
      library: cellSize * 1.1,
      bakery: cellSize * 0.7,
    }[type] || cellSize;

    let meshes = [];

    switch (type) {
      case 'road': {
        const roadGeo = new THREE.BoxGeometry(baseSize, cellSize * 0.04, baseSize);
        const road = new THREE.Mesh(roadGeo, getMat(0x28313d));
        road.position.y = cellSize * 0.02;
        const stripeMat = new THREE.MeshStandardMaterial({
          color: ghost ? 0xcfd8e3 : 0xf7e36a,
          emissive: ghost ? 0x000000 : 0x3a3000,
          emissiveIntensity: ghost ? 0 : 0.18,
          roughness: 0.45,
          opacity: ghost ? 0.35 : 1,
          transparent: !!ghost,
          depthWrite: !ghost,
        });
        for (let i = -1; i <= 1; i++) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(cellSize * 0.08, cellSize * 0.012, cellSize * 0.36), stripeMat);
          stripe.position.set(i * cellSize * 0.24, cellSize * 0.055, 0);
          meshes.push(stripe);
        }
        meshes.push(road);
        break;
      }
      case 'house1': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.8, cellSize * 0.8, baseSize * 0.8);
        const body = new THREE.Mesh(bodyGeo, getMat(0xffe2b3));
        body.position.y = cellSize * 0.4;
        
        const roofGeo = new THREE.ConeGeometry(baseSize * 0.6, cellSize * 0.5, 4);
        const roof = new THREE.Mesh(roofGeo, getMat(0xff6b6b));
        roof.position.y = cellSize * 0.8 + cellSize * 0.25;
        roof.rotation.y = Math.PI / 4;
        
        // Window
        meshes.push(body, roof, createWin(cellSize*0.3, cellSize*0.3, 0, cellSize*0.4, baseSize*0.4));
        break;
      }
      case 'house2': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.9, cellSize * 1.0, baseSize * 0.7);
        const body = new THREE.Mesh(bodyGeo, getMat(0xa3e4d7));
        body.position.y = cellSize * 0.5;
        const roofGeo = new THREE.BoxGeometry(baseSize * 1.0, cellSize * 0.2, baseSize * 0.8);
        const roof = new THREE.Mesh(roofGeo, getMat(0xf1c40f));
        roof.position.y = cellSize * 1.1;
        
        // Windows
        meshes.push(body, roof, createWin(cellSize*0.25, cellSize*0.3, baseSize*0.25, cellSize*0.5, baseSize*0.35), createWin(cellSize*0.25, cellSize*0.3, -baseSize*0.25, cellSize*0.5, baseSize*0.35));
        break;
      }
      case 'factory': {
        const bodyGeo = new THREE.BoxGeometry(baseSize, cellSize * 0.7, baseSize);
        const body = new THREE.Mesh(bodyGeo, getMat(0xe67e22));
        body.position.y = cellSize * 0.35;
        const pipeGeo = new THREE.CylinderGeometry(cellSize*0.1, cellSize*0.1, cellSize*0.8, 8);
        const pipe1 = new THREE.Mesh(pipeGeo, getMat(0xbdc3c7));
        pipe1.position.set(baseSize*0.3, cellSize*0.9, baseSize*0.2);
        const pipe2 = new THREE.Mesh(pipeGeo, getMat(0xbdc3c7));
        pipe2.position.set(-baseSize*0.1, cellSize*0.9, -baseSize*0.2);
        
        // Windows
        meshes.push(body, pipe1, pipe2, createWin(cellSize*0.4, cellSize*0.3, 0, cellSize*0.4, baseSize*0.5));
        break;
      }
      case 'tower': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.6, cellSize * 1.8, baseSize * 0.6);
        const body = new THREE.Mesh(bodyGeo, getMat(0x3498db));
        body.position.y = cellSize * 0.9;
        const topGeo = new THREE.SphereGeometry(baseSize * 0.35, 16, 16);
        const top = new THREE.Mesh(topGeo, getMat(0xf1c40f));
        top.position.y = cellSize * 1.8 + baseSize * 0.3;
        meshes.push(body, top);
        
        // Tower Windows
        for (let i = 0; i < 3; i++) {
            meshes.push(createWin(cellSize*0.25, cellSize*0.25, 0, cellSize*0.5 + i*cellSize*0.4, baseSize*0.3));
        }
        break;
      }
      case 'shop': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.9, cellSize * 0.6, baseSize * 0.9);
        const body = new THREE.Mesh(bodyGeo, getMat(0x9b59b6));
        body.position.y = cellSize * 0.3;
        const signGeo = new THREE.BoxGeometry(baseSize * 0.7, cellSize * 0.3, cellSize * 0.1);
        const sign = new THREE.Mesh(signGeo, getMat(0xf1c40f));
        sign.position.set(0, cellSize * 0.75, baseSize * 0.45);
        meshes.push(body, sign, createWin(cellSize*0.6, cellSize*0.3, 0, cellSize*0.25, baseSize*0.45));
        break;
      }
      case 'apartment': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.8, cellSize * 1.5, baseSize * 0.8);
        const body = new THREE.Mesh(bodyGeo, getMat(0xe74c3c));
        body.position.y = cellSize * 0.75;
        meshes.push(body);
        for (let i = 0; i < 3; i++) {
            meshes.push(createWin(cellSize*0.2, cellSize*0.2, -baseSize*0.2, cellSize*0.4 + i*cellSize*0.4, baseSize*0.4));
            meshes.push(createWin(cellSize*0.2, cellSize*0.2, baseSize*0.2, cellSize*0.4 + i*cellSize*0.4, baseSize*0.4));
        }
        break;
      }
      case 'clockTower': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.5, cellSize * 2.0, baseSize * 0.5);
        const body = new THREE.Mesh(bodyGeo, getMat(0xecf0f1));
        body.position.y = cellSize * 1.0;
        const clockGeo = new THREE.CylinderGeometry(cellSize*0.2, cellSize*0.2, cellSize*0.05, 16);
        const clock = new THREE.Mesh(clockGeo, getMat(0xf39c12));
        clock.rotation.x = Math.PI / 2;
        clock.position.set(0, cellSize * 1.7, baseSize * 0.26);
        const roofGeo = new THREE.ConeGeometry(baseSize * 0.4, cellSize * 0.6, 4);
        const roof = new THREE.Mesh(roofGeo, getMat(0xc0392b));
        roof.position.y = cellSize * 2.3;
        roof.rotation.y = Math.PI / 4;
        meshes.push(body, clock, roof, createWin(cellSize*0.15, cellSize*0.5, 0, cellSize*1.0, baseSize*0.25));
        break;
      }
      case 'skyscraper': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.7, cellSize * 3.0, baseSize * 0.7);
        const body = new THREE.Mesh(bodyGeo, getMat(0x2ecc71));
        body.position.y = cellSize * 1.5;
        meshes.push(body);
        for (let i = 0; i < 6; i++) {
            meshes.push(createWin(cellSize*0.4, cellSize*0.2, 0, cellSize*0.5 + i*cellSize*0.4, baseSize*0.35));
        }
        break;
      }
      case 'hospital': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 1.0, cellSize * 1.2, baseSize * 0.8);
        const body = new THREE.Mesh(bodyGeo, getMat(0xffffff));
        body.position.y = cellSize * 0.6;
        const crossGeo1 = new THREE.BoxGeometry(cellSize*0.4, cellSize*0.15, cellSize*0.05);
        const cross1 = new THREE.Mesh(crossGeo1, getMat(0xe74c3c));
        cross1.position.set(0, cellSize*1.4, baseSize*0.4);
        const crossGeo2 = new THREE.BoxGeometry(cellSize*0.15, cellSize*0.4, cellSize*0.05);
        const cross2 = new THREE.Mesh(crossGeo2, getMat(0xe74c3c));
        cross2.position.set(0, cellSize*1.4, baseSize*0.4);
        meshes.push(body, cross1, cross2);
        
        for (let i = 0; i < 2; i++) {
            meshes.push(createWin(cellSize*0.25, cellSize*0.25, -baseSize*0.25, cellSize*0.4 + i*cellSize*0.4, baseSize*0.4));
            meshes.push(createWin(cellSize*0.25, cellSize*0.25, baseSize*0.25, cellSize*0.4 + i*cellSize*0.4, baseSize*0.4));
        }
        break;
      }
      case 'fireStation': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.9, cellSize * 0.8, baseSize * 0.9);
        const body = new THREE.Mesh(bodyGeo, getMat(0xc0392b));
        body.position.y = cellSize * 0.4;
        const doorGeo = new THREE.BoxGeometry(baseSize * 0.4, cellSize * 0.5, cellSize * 0.05);
        const door = new THREE.Mesh(doorGeo, getMat(0x34495e));
        door.position.set(0, cellSize * 0.25, baseSize * 0.46);
        meshes.push(body, door, createWin(cellSize*0.2, cellSize*0.2, -baseSize*0.3, cellSize*0.5, baseSize*0.45), createWin(cellSize*0.2, cellSize*0.2, baseSize*0.3, cellSize*0.5, baseSize*0.45));
        break;
      }
      case 'school': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 1.0, cellSize * 0.9, baseSize * 0.6);
        const body = new THREE.Mesh(bodyGeo, getMat(0xf39c12));
        body.position.y = cellSize * 0.45;
        const bellGeo = new THREE.BoxGeometry(cellSize*0.3, cellSize*0.3, cellSize*0.3);
        const bell = new THREE.Mesh(bellGeo, getMat(0xd35400));
        bell.position.y = cellSize * 1.05;
        meshes.push(body, bell);
        for (let i = 0; i < 3; i++) {
            meshes.push(createWin(cellSize*0.2, cellSize*0.3, -baseSize*0.3 + i*cellSize*0.3, cellSize*0.5, baseSize*0.3));
        }
        break;
      }
      case 'library': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.8, cellSize * 1.1, baseSize * 0.8);
        const body = new THREE.Mesh(bodyGeo, getMat(0x1abc9c));
        body.position.y = cellSize * 0.55;
        const roofGeo = new THREE.CylinderGeometry(baseSize * 0.45, baseSize * 0.45, baseSize * 0.8, 16, 1, false, 0, Math.PI);
        const roof = new THREE.Mesh(roofGeo, getMat(0x34495e));
        roof.rotation.z = Math.PI / 2;
        roof.position.y = cellSize * 1.1;
        meshes.push(body, roof, createWin(cellSize*0.4, cellSize*0.5, 0, cellSize*0.6, baseSize*0.4));
        break;
      }
      case 'bakery': {
        const bodyGeo = new THREE.BoxGeometry(baseSize * 0.7, cellSize * 0.7, baseSize * 0.7);
        const body = new THREE.Mesh(bodyGeo, getMat(0xd35400));
        body.position.y = cellSize * 0.35;
        const roofGeo = new THREE.SphereGeometry(baseSize * 0.35, 16, 8, 0, Math.PI*2, 0, Math.PI/2);
        const roof = new THREE.Mesh(roofGeo, getMat(0xf1c40f));
        roof.position.y = cellSize * 0.7;
        meshes.push(body, roof, createWin(cellSize*0.4, cellSize*0.3, 0, cellSize*0.35, baseSize*0.35));
        break;
      }
      case 'treeA': {
        const trunkGeo = new THREE.CylinderGeometry(cellSize*0.08, cellSize*0.1, cellSize*0.5, 6);
        const trunk = new THREE.Mesh(trunkGeo, getMat(0x8e44ad));
        trunk.position.y = cellSize * 0.25;
        const leavesGeo = new THREE.SphereGeometry(cellSize*0.35, 8, 8);
        const leaves = new THREE.Mesh(leavesGeo, getMat(0x2ecc71));
        leaves.position.y = cellSize * 0.6;
        meshes.push(trunk, leaves);
        break;
      }
      case 'treeB': {
        const trunkGeo = new THREE.CylinderGeometry(cellSize*0.06, cellSize*0.06, cellSize*0.6, 6);
        const trunk = new THREE.Mesh(trunkGeo, getMat(0xd35400));
        trunk.position.y = cellSize * 0.3;
        const leavesGeo = new THREE.ConeGeometry(cellSize*0.3, cellSize*0.8, 6);
        const leaves = new THREE.Mesh(leavesGeo, getMat(0x27ae60));
        leaves.position.y = cellSize * 0.8;
        meshes.push(trunk, leaves);
        break;
      }
      case 'flowerGarden': {
        const baseGeo = new THREE.BoxGeometry(baseSize * 0.8, cellSize * 0.1, baseSize * 0.8);
        const base = new THREE.Mesh(baseGeo, getMat(0x2ecc71));
        base.position.y = cellSize * 0.05;
        const flowerGeo = new THREE.SphereGeometry(cellSize*0.1, 6, 6);
        const flower1 = new THREE.Mesh(flowerGeo, getMat(0xe74c3c));
        flower1.position.set(baseSize*0.2, cellSize*0.15, baseSize*0.2);
        const flower2 = new THREE.Mesh(flowerGeo, getMat(0xf1c40f));
        flower2.position.set(-baseSize*0.2, cellSize*0.15, -baseSize*0.2);
        const flower3 = new THREE.Mesh(flowerGeo, getMat(0x9b59b6));
        flower3.position.set(baseSize*0.2, cellSize*0.15, -baseSize*0.2);
        meshes.push(base, flower1, flower2, flower3);
        break;
      }
      case 'park': {
        const baseGeo = new THREE.BoxGeometry(baseSize, cellSize * 0.1, baseSize);
        const base = new THREE.Mesh(baseGeo, getMat(0x2ecc71));
        base.position.y = cellSize * 0.05;
        const fountainGeo = new THREE.CylinderGeometry(cellSize*0.2, cellSize*0.3, cellSize*0.2, 16);
        const fountain = new THREE.Mesh(fountainGeo, getMat(0xbdc3c7));
        fountain.position.y = cellSize * 0.15;
        const waterGeo = new THREE.SphereGeometry(cellSize*0.15, 8, 8);
        const water = new THREE.Mesh(waterGeo, getMat(0x3498db));
        water.position.y = cellSize * 0.3;
        meshes.push(base, fountain, water);
        break;
      }
      default: {
        // Fallback cube
        const defGeo = new THREE.BoxGeometry(baseSize * 0.8, cellSize * 0.8, baseSize * 0.8);
        const defMesh = new THREE.Mesh(defGeo, getMat(0x95a5a6));
        defMesh.position.y = cellSize * 0.4;
        meshes.push(defMesh);
        break;
      }
    }

    // Extra facade dressing makes the primitives read more like real buildings.
    if (!['road', 'treeA', 'treeB', 'flowerGarden', 'park'].includes(type)) {
      const addCorner = (x, y, z, h, color = 0x8591a3) => {
        meshes.push(this._makeTrimMesh(cellSize * 0.06, h, cellSize * 0.05, x, y, z, color, ghost));
      };
      const addBand = (y, color = 0x6f7d8f) => {
        meshes.push(this._makeTrimMesh(baseSize * 0.92, cellSize * 0.05, baseSize * 0.92, 0, y, 0, color, ghost));
      };

      addBand(bodyH * 0.48, 0x708090);
      addBand(bodyH * 0.72, 0x8a96a6);
      addCorner(baseSize * 0.39, bodyH * 0.52, baseSize * 0.39, bodyH * 0.86);
      addCorner(-baseSize * 0.39, bodyH * 0.52, baseSize * 0.39, bodyH * 0.86);
      addCorner(baseSize * 0.39, bodyH * 0.52, -baseSize * 0.39, bodyH * 0.86);
      addCorner(-baseSize * 0.39, bodyH * 0.52, -baseSize * 0.39, bodyH * 0.86);
    }

    if (type === 'house1' || type === 'house2' || type === 'bakery') {
      meshes.push(this._makeTrimMesh(baseSize * 0.5, cellSize * 0.08, baseSize * 0.28, 0, cellSize * 0.11, baseSize * 0.34, 0x63463a, ghost));
      meshes.push(this._makeCylinderDetail(cellSize * 0.08, cellSize * 0.09, cellSize * 0.28, 8, -baseSize * 0.18, cellSize * 0.86, -baseSize * 0.12, 0x8a6a52, ghost));
    }

    if (type === 'factory') {
      meshes.push(this._makeCylinderDetail(cellSize * 0.08, cellSize * 0.11, cellSize * 0.82, 10, baseSize * 0.28, cellSize * 0.86, baseSize * 0.26, 0xadb9c6, ghost));
      meshes.push(this._makeTrimMesh(baseSize * 0.88, cellSize * 0.06, baseSize * 0.15, 0, cellSize * 0.76, baseSize * 0.42, 0x374656, ghost));
    }

    if (type === 'shop' || type === 'bakery') {
      meshes.push(this._makeTrimMesh(baseSize * 0.74, cellSize * 0.12, baseSize * 0.16, 0, cellSize * 0.52, baseSize * 0.43, type === 'shop' ? 0xf9d34d : 0xffc857, ghost));
      meshes.push(this._makeTrimMesh(baseSize * 0.56, cellSize * 0.18, baseSize * 0.03, 0, cellSize * 0.24, baseSize * 0.48, 0xffffff, ghost));
    }

    if (type === 'apartment' || type === 'tower' || type === 'skyscraper' || type === 'clockTower') {
      meshes.push(this._makeTrimMesh(baseSize * 0.82, cellSize * 0.07, baseSize * 0.82, 0, bodyH * 0.94, 0, 0x617183, ghost));
      meshes.push(this._makeCylinderDetail(cellSize * 0.03, cellSize * 0.03, bodyH * 0.22, 8, 0, bodyH * 1.02, 0, 0xd9e7f3, ghost));
    }

    if (type === 'hospital' || type === 'school' || type === 'library' || type === 'fireStation') {
      meshes.push(this._makeTrimMesh(baseSize * 0.72, cellSize * 0.1, baseSize * 0.1, 0, cellSize * 0.18, baseSize * 0.45, 0xffffff, ghost));
    }

    if (type === 'park') {
      meshes.push(this._makeTrimMesh(baseSize * 0.74, cellSize * 0.03, baseSize * 0.74, 0, cellSize * 0.11, 0, 0x6cab64, ghost));
      meshes.push(this._makeCylinderDetail(cellSize * 0.24, cellSize * 0.24, cellSize * 0.07, 12, 0, cellSize * 0.22, 0, 0x8fc9f0, ghost));
    }

    meshes.forEach(m => {
      m.castShadow = !ghost;
      m.receiveShadow = !ghost;
      group.add(m);
    });

    return group;
  }

  _prepareAssetModel(model, ghost, type) {
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (ghost && child.material) {
        const cloneMaterial = (mat) => {
          const cloned = mat.clone();
          cloned.transparent = true;
          cloned.opacity = 0.55;
          return cloned;
        };
        child.material = Array.isArray(child.material)
          ? child.material.map(cloneMaterial)
          : cloneMaterial(child.material);
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const footprint = this.cellSize * 0.86;
    const maxHeight = this.cellSize * 1.45;
    const scale = Math.min(
      size.x ? footprint / size.x : 1,
      size.z ? footprint / size.z : 1,
      size.y ? maxHeight / size.y : 1
    );

    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(model);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    model.position.x -= scaledCenter.x;
    model.position.z -= scaledCenter.z;
    model.position.y -= scaledBox.min.y;
    
    if (type === 'house') {
      model.rotation.y = Math.PI / 2;
    }
  }

  _isRoadCell(row, col) {
    if (row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) return false;
    const m = this.grid[row][col];
    return !!(m && m.userData && m.userData.type === 'road');
  }

  _updateUI() {
    if (this.levelTextEl) this.levelTextEl.textContent = `Level ${this.level}`;
    
    // Count filled slots for progression
    const filled = this._countFilledCells();
    const target = this._getLevelProgressTarget();
    if (this.progressTextEl) this.progressTextEl.textContent = `${filled}/${target}`;
    
    if (this.happyPointsTextEl) this.happyPointsTextEl.textContent = `${this.happinessPoints}`;
    if (this.happyTextEl) this.happyTextEl.textContent = `${Math.round(this.happiness*100)}%`;

    // Show all level groups; disable locked building buttons
    for (let lvl = 1; lvl <= this.maxLevel; lvl++) {
      const group = document.getElementById(`lvl${lvl}Group`);
      if (!group) continue;
      group.style.display = 'flex';
      const buttons = group.querySelectorAll('.build-btn');
      buttons.forEach(btn => {
        if (lvl > this.level) {
          btn.disabled = true;
          btn.classList.add('locked');
          // Add lock overlay if not present
          if (!btn.querySelector('.lock-overlay')) {
            const lock = document.createElement('span');
            lock.className = 'lock-overlay';
            lock.textContent = '🔒 Lvl ' + lvl;
            btn.appendChild(lock);
          }
        } else {
          btn.disabled = false;
          btn.classList.remove('locked');
          const lock = btn.querySelector('.lock-overlay');
          if (lock) lock.remove();
        }
      });
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
    
    this._checkLevelProgression();
    
    this._updateUI();
  }

  _toastAtCell(row,col,msg){
    const status = document.getElementById('status'); if (!status) return;
    status.textContent = msg; status.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>{ status.style.display='none'; }, 1400);
  }

  _tryExpandCity() {
    // Left as legacy wrapper if ever manually invoked
    this._expandGridByOneRing();
    this._updateUI();
    this._feed(`City expanded to ${this.gridSize}×${this.gridSize}`);
  }

  _expandGridByOneRing() {
    const oldSize = this.gridSize;
    const newSize = this._getLevelGridSize(this.level);
    if (newSize <= oldSize) return;
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

    // Keep all placed meshes at their existing row/col
    for (let r = 0; r < oldSize; r++) {
      for (let c = 0; c < oldSize; c++) {
        const mesh = this.grid[r][c];
        if (!mesh) continue;
        const newRow = r;
        const newCol = c;
        // World position remains exactly the same, no need to update position
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

    // No need to shift cars since the logical grid coordinates didn't shift
    // their world positions and row/col are still accurate

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
    const gridColors = this._getGridHelperColors();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      this._getThemeMaterial('concrete', false)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(half, 0, half);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, gridColors.major, gridColors.minor);
    gridHelper.position.set(half, 0.01, half);
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }

  _addLiveBuildingDetails(root, type) {
    const animatedTypes = new Set([
      'house1', 'house2', 'tower', 'shop', 'apartment', 'clockTower',
      'skyscraper', 'hospital', 'fireStation', 'school', 'library', 'bakery',
      'factory', 'treeA', 'treeB', 'park', 'flowerGarden'
    ]);
    if (!animatedTypes.has(type)) return;

    const cs = this.cellSize;
    const base = cs * 0.85;
    const entry = {
      root,
      type,
      phase: Math.random() * Math.PI * 2,
      windows: [],
      rotors: [],
      pulsers: [],
      swayers: [],
      clockHands: [],
      smokeTimer: Math.random() * 0.8,
    };

    const addWindow = (x, y, z, w = cs * 0.18, h = cs * 0.16) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xfff2a8,
        emissive: 0xffcc55,
        emissiveIntensity: 0.25 + Math.random() * 0.35,
        roughness: 0.28,
        metalness: 0.1,
      });
      const win = new THREE.Mesh(new THREE.BoxGeometry(w, h, cs * 0.025), mat);
      win.position.set(x, y, z);
      win.userData.baseIntensity = mat.emissiveIntensity;
      root.add(win);
      entry.windows.push(win);
      return win;
    };

    const windowRowsByType = {
      house1: 1, house2: 1, shop: 1, factory: 1, bakery: 1,
      school: 1, library: 2, hospital: 2, fireStation: 1,
      tower: 3, apartment: 4, clockTower: 2, skyscraper: 6,
    };
    const rows = windowRowsByType[type] || 0;
    if (rows) {
      const cols = ['tower', 'clockTower'].includes(type) ? 1 : type === 'skyscraper' ? 3 : 2;
      for (let r = 0; r < rows; r++) {
        const y = cs * (0.34 + r * 0.32);
        for (let c = 0; c < cols; c++) {
          const x = (c - (cols - 1) / 2) * cs * 0.22;
          addWindow(x, y, base * 0.47);
          if (rows > 1 && c % 2 === 0) addWindow(x, y, -base * 0.47);
        }
      }
    }

    const addRotor = (x, y, z, color = 0xdde8f0) => {
      const rotor = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.035, cs * 0.035, cs * 0.05, 10), mat);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.34, cs * 0.025, cs * 0.045), mat);
        blade.rotation.z = i * Math.PI / 2;
        rotor.add(blade);
      }
      rotor.position.set(x, y, z);
      rotor.rotation.x = Math.PI / 2;
      root.add(rotor);
      entry.rotors.push(rotor);
    };

    if (type === 'factory') {
      addRotor(-base * 0.26, cs * 0.92, base * 0.5, 0xc8d2dc);
      addRotor(base * 0.24, cs * 0.72, -base * 0.5, 0xc8d2dc);
    }

    if (['hospital', 'fireStation', 'shop', 'bakery'].includes(type)) {
      const color = type === 'hospital' ? 0x49b8ff : type === 'fireStation' ? 0xff3048 : 0xffdd55;
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(cs * 0.09, 12, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.2 })
      );
      beacon.position.set(base * 0.34, cs * 1.03, base * 0.34);
      root.add(beacon);
      entry.pulsers.push(beacon);
    }

    if (type === 'clockTower') {
      const handMat = new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.4 });
      const minute = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.035, cs * 0.34, cs * 0.035), handMat);
      const hour = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.045, cs * 0.23, cs * 0.035), handMat);
      minute.position.set(0, cs * 1.72, base * 0.295);
      hour.position.set(0, cs * 1.72, base * 0.305);
      root.add(minute, hour);
      entry.clockHands.push({ minute, hour });
    }

    if (['treeA', 'treeB', 'flowerGarden'].includes(type)) {
      entry.swayers.push(root);
    }

    if (type === 'park') {
      const water = new THREE.Mesh(
        new THREE.TorusGeometry(cs * 0.2, cs * 0.018, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x58bdf5, emissive: 0x1f8fd2, emissiveIntensity: 0.35, roughness: 0.2 })
      );
      water.position.y = cs * 0.33;
      water.rotation.x = Math.PI / 2;
      root.add(water);
      entry.rotors.push(water);
    }

    this.liveBuildingParts.push(entry);
  }

  _updateLiveBuildings(dt, elapsed) {
    for (const entry of this.liveBuildingParts) {
      if (!entry.root.parent) continue;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + entry.phase);
      for (let i = 0; i < entry.windows.length; i++) {
        const win = entry.windows[i];
        if (!win.material) continue;
        const twinkle = 0.55 + 0.45 * Math.sin(elapsed * (1.3 + i * 0.07) + entry.phase + i);
        win.material.emissiveIntensity = win.userData.baseIntensity * (0.55 + twinkle);
      }
      for (const rotor of entry.rotors) rotor.rotation.z += dt * (entry.type === 'park' ? 1.2 : 6.5);
      for (const pulser of entry.pulsers) {
        pulser.material.emissiveIntensity = 0.4 + pulse * 1.6;
        pulser.scale.setScalar(0.85 + pulse * 0.3);
      }
      for (const hands of entry.clockHands) {
        hands.minute.rotation.z -= dt * 1.8;
        hands.hour.rotation.z -= dt * 0.16;
      }
      for (const swayer of entry.swayers) {
        swayer.rotation.x = Math.sin(elapsed * 1.8 + entry.phase) * 0.025;
        swayer.rotation.z = Math.cos(elapsed * 1.4 + entry.phase) * 0.025;
      }
      if (entry.type === 'factory') {
        entry.smokeTimer -= dt;
        if (entry.smokeTimer <= 0) {
          const local = new THREE.Vector3(this.cellSize * 0.24, this.cellSize * 1.28, this.cellSize * 0.16);
          const world = entry.root.localToWorld(local);
          this._emitSmokePuff(world);
          entry.smokeTimer = 0.35 + Math.random() * 0.35;
        }
      }
      if (entry.type === 'bakery') {
        entry.smokeTimer -= dt;
        if (entry.smokeTimer <= 0) {
          const world = entry.root.localToWorld(new THREE.Vector3(0, this.cellSize * 0.98, this.cellSize * 0.08));
          this._emitSmokePuff(world, 0xfff1dc, 0.45);
          entry.smokeTimer = 0.55 + Math.random() * 0.45;
        }
      }
    }
  }

  _emitSmokePuff(position, color = 0xc8c8c8, opacity = 0.36) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      roughness: 1,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(this.cellSize * 0.09, 10, 10), mat);
    puff.position.copy(position);
    puff.castShadow = false;
    this.scene.add(puff);
    this.smokePuffs.push({
      mesh: puff,
      life: 1,
      driftX: (Math.random() - 0.5) * this.cellSize * 0.18,
      driftZ: (Math.random() - 0.5) * this.cellSize * 0.18,
    });
  }

  _updateSmoke(dt) {
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      const mesh = p.mesh || p.sprite;
      p.life -= dt * 0.55;
      if (p.life <= 0) {
        this.scene.remove(mesh);
        mesh.geometry?.dispose?.();
        if (mesh.material?.map) mesh.material.map.dispose();
        mesh.material?.dispose?.();
        this.smokePuffs.splice(i, 1);
        continue;
      }
      mesh.position.y += dt * this.cellSize * 0.35;
      mesh.position.x += p.driftX * dt;
      mesh.position.z += p.driftZ * dt;
      const scale = 1 + (1 - p.life) * 2.2;
      mesh.scale.setScalar(scale);
      if (mesh.material) mesh.material.opacity = Math.max(0, p.life * 0.36);
    }
  }

  _animate() {
  this._raf = requestAnimationFrame(() => this._animate());
  const t = performance.now() * 0.001;
  const dt = Math.min(0.05, Math.max(0.001, t - this._lastTime));
  this._lastTime = t;
  // Apply time scaling to simulation; visuals (shaders) continue real-time
  const sdt = dt * (this.timeScale || 0);

  this._updateLiveBuildings(dt, t);
  this._updateSmoke(dt);
  this._updatePeople(sdt);
  this._updateVisitors?.(sdt);
  this._carSpawnTimer += sdt;
  if (this._carSpawnTimer > 1.3 && this.cars.length < this._maxCars) {
    const start = this._findRandomRoadStart();
    if (start) this._spawnCar(start.row, start.col, start.dir);
    this._carSpawnTimer = 0;
  }
  this._updateCars(sdt);

    this.renderer.render(this.scene, this.camera);
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
      const person = this._makePersonModel();
      const bodyH = this.cellSize*0.24;
      let torso;
      let mixer = null;
      if (person) {
        torso = person.model;
        mixer = person.mixer;
        torso.scale.setScalar(this.cellSize * 0.028 * THREE.MathUtils.randFloat(0.9, 1.15));
      } else {
        torso = new THREE.Mesh(new THREE.CylinderGeometry(this.cellSize*0.08, this.cellSize*0.1, bodyH, 10), new THREE.MeshStandardMaterial({ color: 0x4ba86b, roughness: 0.8 }));
        const head = new THREE.Mesh(new THREE.SphereGeometry(this.cellSize*0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffe2c0 }));
        head.position.y = bodyH*0.6; torso.add(head);
      }
      const startX = center.x + (Math.random()*2-1)*half*0.7;
      const startZ = center.z + (Math.random()*2-1)*half*0.7;
      const y = this.cellSize*0.05 + bodyH/2 + 0.02;
      torso.position.set(startX, y, startZ);
      torso.castShadow = true; torso.receiveShadow = true;
      this.scene.add(torso);
      const target = { x: center.x + (Math.random()*2-1)*half*0.8, z: center.z + (Math.random()*2-1)*half*0.8 };
      this.people.push({ mesh: torso, row, col, park: parkMesh, speed: this.cellSize*(0.22+Math.random()*0.12), target, bob: Math.random()*Math.PI*2, baseY: y, mixer });
    }
  }

  _removePeopleForPark(parkMesh) {
    for (let i=this.people.length-1;i>=0;i--) {
      if (this.people[i].park === parkMesh) {
        const p = this.people[i];
        this.scene.remove(p.mesh);
        if (!p.mixer) p.mesh.traverse(n=>{ if(n.isMesh){ n.geometry.dispose(); if(n.material.map) n.material.map.dispose(); n.material.dispose(); }});
        this.people.splice(i,1);
      }
    }
  }

  _updatePeople(dt) {
    for (const p of this.people) {
      // bobbing animation
      if (p.mixer) p.mixer.update(dt);
      p.bob += dt*6; p.mesh.position.y = p.baseY + Math.sin(p.bob)*0.04;
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

  _spawnVisitorsForBuilding(mesh, row, col) {
    if (!mesh || !mesh.userData) return;
    const type = mesh.userData.type;
    if (['road', 'treeA', 'treeB', 'flowerGarden', 'park'].includes(type)) return;

    const visitorRichTypes = new Set(['shop', 'hospital', 'fireStation', 'school', 'library', 'bakery', 'apartment', 'tower', 'clockTower']);
    const count = visitorRichTypes.has(type) ? 2 : 1;
    const center = this._gridToWorld(col, row);
    const half = this.cellSize * 0.28;
    const baseY = this.cellSize * 0.08;

    for (let i = 0; i < count; i++) {
      const person = this._makePersonModel();
      let body;
      let mixer = null;
      if (person) {
        body = person.model;
        mixer = person.mixer;
        body.scale.setScalar(this.cellSize * 0.026 * THREE.MathUtils.randFloat(0.95, 1.15));
      } else {
        body = new THREE.Mesh(
          new THREE.CylinderGeometry(this.cellSize * 0.055, this.cellSize * 0.07, this.cellSize * 0.22, 8),
          new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xf59e0b : 0x4f8cff, roughness: 0.75 })
        );
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(this.cellSize * 0.05, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.85 })
        );
        head.position.y = this.cellSize * 0.13;
        body.add(head);
      }
      body.position.set(
        center.x + (Math.random() * 2 - 1) * half,
        baseY + this.cellSize * 0.11,
        center.z + (Math.random() * 2 - 1) * half
      );
      body.castShadow = true;
      body.receiveShadow = false;
      this.scene.add(body);
      this.visitors.push({
        mesh: body,
        root: mesh,
        row,
        col,
        mixer,
        target: {
          x: center.x + (Math.random() * 2 - 1) * half,
          z: center.z + (Math.random() * 2 - 1) * half,
        },
        speed: this.cellSize * (0.12 + Math.random() * 0.08),
        bob: Math.random() * Math.PI * 2,
        baseY: body.position.y,
      });
    }
  }

  _removeVisitorsForBuilding(mesh) {
    for (let i = this.visitors.length - 1; i >= 0; i--) {
      if (this.visitors[i].root !== mesh) continue;
      const visitor = this.visitors[i];
      this.scene.remove(visitor.mesh);
      if (!visitor.mixer) {
        visitor.mesh.traverse?.((node) => {
          if (!node.isMesh) return;
          node.geometry?.dispose?.();
          if (Array.isArray(node.material)) node.material.forEach((mat) => mat.dispose?.());
          else node.material?.dispose?.();
        });
      }
      this.visitors.splice(i, 1);
    }
  }

  _updateVisitors(dt) {
    for (const visitor of this.visitors) {
      if (visitor.mixer) visitor.mixer.update(dt);
      const center = this._gridToWorld(visitor.col, visitor.row);
      const half = this.cellSize * 0.32;
      visitor.bob += dt * 6;
      visitor.mesh.position.y = visitor.baseY + Math.sin(visitor.bob) * 0.03;
      const dx = visitor.target.x - visitor.mesh.position.x;
      const dz = visitor.target.z - visitor.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.04) {
        visitor.target = {
          x: center.x + (Math.random() * 2 - 1) * half,
          z: center.z + (Math.random() * 2 - 1) * half,
        };
      } else {
        const vx = (dx / dist) * visitor.speed * dt;
        const vz = (dz / dist) * visitor.speed * dt;
        visitor.mesh.position.x += vx;
        visitor.mesh.position.z += vz;
        visitor.mesh.rotation.y = Math.atan2(vx, vz);
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

export { City3DGame };
