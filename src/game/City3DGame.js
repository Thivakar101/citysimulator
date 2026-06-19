import * as THREE from 'three';
import { CoCCameraController } from './CoCCameraController.js';
import { ASSETS } from './assets.js';

class City3DGame {
  constructor({ containerId, gridSize = 5, cellSize = 6 }) {
    this.container = document.getElementById(containerId);
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this.baseGridSize = gridSize;
    this.gridOriginX = 0;
    this.gridOriginZ = 0;

    this.happinessPoints = 0;
    this.population = 0;
    this.happiness = 1.0;
    this.level = 1;
    this.maxLevel = 4;
    this.buildings = [];
    this.grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.ghost = null;
    this.currentPlacement = null;
    this.isRelocating = null;
    this._geoCache = {};
    this._matCache = {};
    this._textureCache = {};
    this.assetScenes = {};
    this.assetPromises = {};
    this.surfaceThemes = {};
    this.surfaceThemePromise = null;
    this.personAssetPromise = null;
    this.personAssetScene = null;
    this.placementRotation = 0;
    this.smokePuffs = [];
    this.liveBuildingParts = [];
    this._lastTime = performance.now() * 0.001;
    this.people = [];
    this.visitors = [];
    this._levelTransitionPending = false;
    this.timeScale = 1;

    // Road path system (CatmullRom, inspired by Road Network Vehicle Demo)
    this._roadPathCurve = null;
    this._roadPathLine = null;
    this._roadPathDirty = true;
    this._roadGrid = null; // Track road connectivity
    this.levelProgressThreshold = 0.75;
    this.levelViewMultipliers = [1.14, 1.24, 1.34, 1.44];
    this.maxPlacementsPerType = 10;
    this.longPressDuration = 550;
    this._longPressState = { timer: null, pointerId: null, startX: 0, startY: 0, target: null, active: false };
    this.selectedBuilding = null;

    this.buildingRegistry = {
      road: { level: 1 },
      house1: { level: 1 }, factory: { level: 1 }, tower: { level: 1 }, shop: { level: 1 },
      house2: { level: 2 }, apartment: { level: 2 }, clockTower: { level: 2 },
      skyscraper: { level: 3 }, hospital: { level: 3 }, fireStation: { level: 3 },
      school: { level: 4 }, library: { level: 4 }, bakery: { level: 4 },
    };

    this._initThree();
    this._initScene();
    this._bootstrapSurfaceThemes();
    this._bootstrapPersonAsset();
    this._loadAsset('house1').catch(() => null);
    this._animate();
    this._updateUI();
    this._bindResize();
    this._feed('Welcome to City Simulator');
  }

  introCinematic() {
    this._applyLevelView();
  }

  _initThree() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(20, 24, 24);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.ACESFilmicToneMapping) this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new CoCCameraController(this.camera, this.renderer.domElement, { interactive: true });
  }

  _initScene() {
    const planeSize = this.gridSize * this.cellSize;
    const center = this._getGridCenterWorld();
    const gridColors = this._getGridHelperColors();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      this._getThemeMaterial('concrete', false)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, 0, center.z);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, gridColors.major, gridColors.minor);
    gridHelper.position.set(center.x, 0.01, center.z);
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;

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
      fragmentShader: `uniform vec3 topColor;\nuniform vec3 bottomColor;\nuniform float offset;\nuniform float exponent;\nvarying vec3 vWorldPosition;\nvoid main(){\n vec3 shifted = vWorldPosition + vec3(0.0, offset, 0.0);\n float h = normalize(shifted).y;\n float f = clamp(pow(max(h, 0.0), exponent), 0.0, 1.0);\n gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);\n}`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    this._applyLevelView();

    this.levelTextEl = document.getElementById('levelText') || null;
    this.progressTextEl = document.getElementById('progressText') || null;
    this.happyPointsTextEl = document.getElementById('happinessPointsText') || null;
    this.happyTextEl = document.getElementById('happyText') || null;

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
      cancelPlacement: document.getElementById('cancelPlacement'),
      zoomIn: document.getElementById('zoomIn'),
      zoomOut: document.getElementById('zoomOut'),
      buildingActionMenu: document.getElementById('buildingActionMenu'),
      moveBuildingBtn: document.getElementById('moveBuildingBtn'),
      removeBuildingBtn: document.getElementById('removeBuildingBtn'),
      cancelBuildingActionBtn: document.getElementById('cancelBuildingActionBtn')
    };

    const getHappyBtn = document.getElementById('getHappinessBtn');
    if (getHappyBtn) {
      getHappyBtn.addEventListener('click', () => {
        this.happinessPoints += 10;
        this._updateUI();
        this._feed('Earned 10 Happiness Points!');
      });
    }

    this._hookStore('buyRoad', { type: 'road', cost: 0 });
    this._hookStore('buyHouse1', { type: 'house1', cost: 0 });
    this._hookStore('buyFactory', { type: 'factory', cost: 0 });
    this._hookStore('buyTower', { type: 'tower', cost: 0 });
    this._hookStore('buyShop', { type: 'shop', cost: 0 });
    this._hookStore('buyHouse2', { type: 'house2', cost: 0 });
    this._hookStore('buyApartment', { type: 'apartment', cost: 0 });
    this._hookStore('buyClockTower', { type: 'clockTower', cost: 0 });
    this._hookStore('buySkyscraper', { type: 'skyscraper', cost: 0 });
    this._hookStore('buyHospital', { type: 'hospital', cost: 0 });
    this._hookStore('buyFireStation', { type: 'fireStation', cost: 0 });
    this._hookStore('buySchool', { type: 'school', cost: 0 });
    this._hookStore('buyLibrary', { type: 'library', cost: 0 });
    this._hookStore('buyBakery', { type: 'bakery', cost: 0 });
    this._hookStore('buyTreeA', { type: 'treeA', cost: 10, isDecoration: true });
    this._hookStore('buyTreeB', { type: 'treeB', cost: 15, isDecoration: true });
    this._hookStore('buyFlowerGarden', { type: 'flowerGarden', cost: 25, isDecoration: true });
    this._hookStore('buyPark', { type: 'park', cost: 50, isDecoration: true });

    if (this.ui.cancelPlacement) this.ui.cancelPlacement.addEventListener('click', () => this._cancelPlacement());
    if (this.ui.zoomIn) this.ui.zoomIn.addEventListener('click', () => this.zoomIn());
    if (this.ui.zoomOut) this.ui.zoomOut.addEventListener('click', () => this.zoomOut());
    if (this.ui.moveBuildingBtn) this.ui.moveBuildingBtn.addEventListener('click', () => this._beginMoveSelectedBuilding());
    if (this.ui.removeBuildingBtn) this.ui.removeBuildingBtn.addEventListener('click', () => this._removeSelectedBuilding());
    if (this.ui.cancelBuildingActionBtn) this.ui.cancelBuildingActionBtn.addEventListener('click', () => this._hideBuildingActionMenu());

    this.renderer.domElement.addEventListener('mousemove', (e) => this._onPointerMove(e));
    this.renderer.domElement.addEventListener('click', (e) => this._onClick(e));
    this.renderer.domElement.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    this.renderer.domElement.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.renderer.domElement.addEventListener('pointermove', (e) => this._onPointerDragMove(e));
    this.renderer.domElement.addEventListener('pointerup', () => this._clearLongPress());
    this.renderer.domElement.addEventListener('pointercancel', () => this._clearLongPress());
    this.renderer.domElement.addEventListener('pointerleave', () => this._clearLongPress());
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  // ─────────────────────────────────────────────
  // ROAD PATH SYSTEM  (CatmullRom, from demo)
  // ─────────────────────────────────────────────

  _rebuildRoadPath() {
    if (this._roadPathLine) {
      this.scene.remove(this._roadPathLine);
      this._roadPathLine.geometry.dispose();
      this._roadPathLine.material.dispose();
      this._roadPathLine = null;
    }
    this._roadPathCurve = null;

    const pts = [];
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (this._isRoadCell(r, c)) {
          const { x, z } = this._gridToWorld(c, r);
          pts.push(new THREE.Vector3(x, 0.8, z));
        }
      }
    }

    if (pts.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(pts, pts.length > 2, 'centripetal');
    this._roadPathCurve = curve;

  }

  _markRoadPathDirty() {
    this._roadPathDirty = true;
  }

  // ─────────────────────────────────────────────
  // Grid / World helpers
  // ─────────────────────────────────────────────

  _gridToWorld(col, row) {
    const x = this.gridOriginX + (col + 0.5) * this.cellSize;
    const z = this.gridOriginZ + (row + 0.5) * this.cellSize;
    return { x, z };
  }

  _getGridCenterWorld() {
    const planeSize = this.gridSize * this.cellSize;
    return new THREE.Vector3(this.gridOriginX + planeSize / 2, 0, this.gridOriginZ + planeSize / 2);
  }

  _getLevelGridSize(level = this.level) {
    return this.baseGridSize + Math.max(0, level - 1) * 2;
  }

  _getLevelProgressTarget() {
    return Math.max(1, Math.ceil(this.gridSize * this.gridSize * this.levelProgressThreshold));
  }

  _countFilledCells() {
    let filled = 0;
    for (let r = 0; r < this.gridSize; r++)
      for (let c = 0; c < this.gridSize; c++)
        if (this.grid[r][c]) filled++;
    return filled;
  }

  _hasReachedLevelThreshold() {
    return this._countFilledCells() >= this._getLevelProgressTarget();
  }

  _checkLevelProgression() {
    if (this._levelTransitionPending || this.level >= this.maxLevel || !this._hasReachedLevelThreshold()) return false;
    this.level++;
    this.happinessPoints += 25;
    this._feed(`Level up! ${this.level}`);
    this._toastAtCell(Math.floor(this.gridSize / 2), Math.floor(this.gridSize / 2), `🎉 Level Up! Now Level ${this.level}`);
    this._levelTransitionPending = true;
    try { this._expandGridByOneRing(); } finally { this._levelTransitionPending = false; }
    this._updateUI();
    return true;
  }

  _getLevelViewDistance(level = this.level) {
    const planeSize = this.gridSize * this.cellSize;
    const baseDistance = Math.max(planeSize * 0.9, 26);
    const multiplier = this.levelViewMultipliers[Math.max(0, Math.min(this.levelViewMultipliers.length - 1, level - 1))] ?? 1;
    const mobileBoost = this._isMobileViewport() ? 2.5 : 1;
    return baseDistance * multiplier * mobileBoost;
  }

  _isMobileViewport() {
    return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  }

  _applyLevelView(animate = false) {
    if (!this.controls) return;
    const planeSize = this.gridSize * this.cellSize;
    const center = this._getGridCenterWorld();
    const targetDistance = this._getLevelViewDistance();

    this.controls.setBounds({
      minX: this.gridOriginX - 4,
      maxX: this.gridOriginX + planeSize + 4,
      minZ: this.gridOriginZ - 4,
      maxZ: this.gridOriginZ + planeSize + 4
    });
    this.controls.setTarget(center);
    if (!animate) {
      this.controls.setDistance(targetDistance);
      return;
    }

    const startDistance = this.controls.distance;
    const delta = targetDistance - startDistance;
    if (Math.abs(delta) < 0.01) {
      this.controls.setDistance(targetDistance);
      return;
    }

    const duration = 700;
    const startedAt = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      this.controls.setDistance(startDistance + delta * easeOut(t));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _getGridHelperColors() { return { major: 0x64707d, minor: 0x92a0ac }; }

  _worldToGrid(x, z) {
    const col = Math.floor((x - this.gridOriginX) / this.cellSize);
    const row = Math.floor((z - this.gridOriginZ) / this.cellSize);
    if (col < 0 || row < 0 || col >= this.gridSize || row >= this.gridSize) return null;
    return { col, row };
  }

  // ─────────────────────────────────────────────
  // Store / Placement hooks
  // ─────────────────────────────────────────────

  _hookStore(id, placement) {
    const el = this.ui[id];
    if (!el) return;
    el.addEventListener('click', () => {
      if (!this._canPlaceType(placement.type)) {
        this._toastAtCell(Math.floor(this.gridSize / 2), Math.floor(this.gridSize / 2), `${this._getLabelForType(placement.type)} is full`);
        return;
      }
      const reg = this.buildingRegistry[placement.type];
      if (reg && reg.level > this.level) {
        this._toastAtCell(Math.floor(this.gridSize / 2), Math.floor(this.gridSize / 2), `🔒 Unlock at Level ${reg.level}!`);
        return;
      }
      this._hideBuildingActionMenu();
      this.currentPlacement = placement;
      this.isRelocating = null;
      this._ensureGhost(placement.type);
      this.placementRotation = 0;
      this._updateUI();
    });
  }

  _ensureGhost(type) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    const mesh = this._createBuildingMesh(type, { ghost: true });
    mesh.visible = false;
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

  // ─────────────────────────────────────────────
  // Pointer / Click
  // ─────────────────────────────────────────────

  _onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this.ghost && !this.isRelocating) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
      this._setGhostColor(this.ghost, (free && unlocked) ? 0x66ff99 : 0xff6666);
    }
  }

  _onClick(event) {
    if (this._longPressState.active) {
      this._longPressState.active = false;
      return;
    }
    if (this.controls && this.controls._didDragLastGesture) {
      this.controls._didDragLastGesture = false;
      return;
    }
    if (this.selectedBuilding) {
      this._hideBuildingActionMenu();
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return;
    const cell = this._worldToGrid(point.x, point.z);
    if (!cell) return;
    const { col, row } = cell;

    if (this.isRelocating) {
      if (this.grid[row][col]) return;
      const mesh = this.isRelocating;
      const prev = mesh.userData.grid;
      if (prev) this.grid[prev.row][prev.col] = null;
      const pos = this._gridToWorld(col, row);
      mesh.position.set(pos.x, mesh.position.y, pos.z);
      if (mesh.userData.type === 'road') {
        mesh.userData.roadRotation = this._snapRoadRotation(this.placementRotation);
        mesh.rotation.y = 0;
      } else {
        mesh.rotation.y = this.placementRotation;
      }
      mesh.userData.grid = { col, row };
      this.grid[row][col] = mesh;
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
      if (mesh.userData.type === 'road') {
        if (prev) this._refreshRoadNetworkAround(prev.row, prev.col);
        this._refreshRoadNetworkAround(row, col);
      }
      return;
    }

    if (!this.currentPlacement) return;
    const reg = this.buildingRegistry[this.currentPlacement.type];
    if (reg && reg.level > this.level) { this._toastAtCell(row, col, `Unlock at Level ${reg.level}!`); return; }
    if (!this._canPlaceType(this.currentPlacement.type)) {
      this._toastAtCell(row, col, `${this._getLabelForType(this.currentPlacement.type)} limit reached`);
      return;
    }
    if (this.grid[row][col]) return;
    if (this.currentPlacement.isDecoration && this.happinessPoints < this.currentPlacement.cost) {
      this._toastAtCell(row, col, "Not enough Happiness Points!");
      return;
    }

    const mesh = this._createBuildingMesh(this.currentPlacement.type);
    const pos = this._gridToWorld(col, row);
    mesh.position.set(pos.x, mesh.position.y, pos.z);
    mesh.rotation.y = this.currentPlacement.type === 'road' ? 0 : this.placementRotation;
    mesh.userData = {
      ...mesh.userData,
      type: this.currentPlacement.type,
      grid: { col, row },
      isDecoration: this.currentPlacement.isDecoration,
      roadRotation: this.currentPlacement.type === 'road' ? this._snapRoadRotation(this.placementRotation) : undefined,
    };
    this.scene.add(mesh);
    this.buildings.push(mesh);
    this.grid[row][col] = mesh;
    this._spawnVisitorsForBuilding(mesh, row, col);

    if (this.currentPlacement.isDecoration) {
      this.happinessPoints -= this.currentPlacement.cost;
    } else if (this.currentPlacement.type !== 'road') {
      this.happinessPoints += 2;
    }

    if (mesh.userData.type === 'park') this._spawnPeopleForPark(mesh, row, col);
    if (mesh.userData.type === 'road') this._refreshRoadNetworkAround(row, col);

    this._recomputeCityStats();
    this._updateUI();
    this._feed(`Placed ${mesh.userData.type}`);
  }

  _onDoubleClick(event) {
    this._openBuildingActionMenu(this._getBuildingFromEvent(event));
  }

  _cancelPlacement() {
    this.currentPlacement = null;
    this.isRelocating = null;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this._hideBuildingActionMenu();
  }

  _onPointerDown(event) {
    if (this.currentPlacement || this.isRelocating || this.selectedBuilding) return;
    const target = this._getBuildingFromEvent(event);
    if (!target) return;
    this._clearLongPress();
    this._longPressState.pointerId = event.pointerId;
    this._longPressState.startX = event.clientX;
    this._longPressState.startY = event.clientY;
    this._longPressState.target = target;
    this._longPressState.timer = setTimeout(() => {
      this._longPressState.active = true;
      this._openBuildingActionMenu(target);
    }, this.longPressDuration);
  }

  _onPointerDragMove(event) {
    const state = this._longPressState;
    if (!state.timer || state.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) {
      this._clearLongPress();
    }
  }

  _clearLongPress() {
    const state = this._longPressState;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.pointerId = null;
    state.target = null;
    state.active = false;
  }

  _getBuildingFromEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.buildings, true);
    if (!intersects.length) return null;
    let obj = intersects[0].object;
    while (obj && !this.buildings.includes(obj)) obj = obj.parent;
    return obj || null;
  }

  _openBuildingActionMenu(mesh) {
    this._clearLongPress();
    if (!mesh) return;
    this.selectedBuilding = mesh;
    if (this.ui.buildingActionMenu) this.ui.buildingActionMenu.classList.add('visible');
  }

  _hideBuildingActionMenu() {
    this.selectedBuilding = null;
    if (this.ui.buildingActionMenu) this.ui.buildingActionMenu.classList.remove('visible');
  }

  _beginMoveSelectedBuilding() {
    if (!this.selectedBuilding) return;
    this.isRelocating = this.selectedBuilding;
    this.currentPlacement = null;
    this._ensureGhost(this.isRelocating.userData.type);
    this.placementRotation = this.isRelocating.userData.type === 'road'
      ? (this.isRelocating.userData.roadRotation ?? 0)
      : this.isRelocating.rotation.y;
    if (this.ghost) this.ghost.rotation.y = this.placementRotation;
    this._hideBuildingActionMenu();
  }

  _removeSelectedBuilding() {
    if (!this.selectedBuilding) return;
    const mesh = this.selectedBuilding;
    const pos = mesh.userData?.grid;
    if (pos) this.grid[pos.row][pos.col] = null;
    this._removePeopleForPark(mesh);
    this._removeVisitorsForBuilding(mesh);
    this.scene.remove(mesh);
    this.buildings = this.buildings.filter((b) => b !== mesh);
    this.liveBuildingParts = this.liveBuildingParts.filter((entry) => entry.root !== mesh);
    if (mesh.userData?.type === 'road' && pos) this._refreshRoadNetworkAround(pos.row, pos.col);
    this._hideBuildingActionMenu();
    this._recomputeCityStats();
    this._updateUI();
    this._feed(`Removed ${mesh.userData?.type || 'building'}`);
  }

  _getPlacedCount(type) {
    return this.buildings.filter((mesh) => mesh?.userData?.type === type).length;
  }

  _getRemainingStock(type) {
    if (type === 'road') return Infinity;
    return Math.max(0, this.maxPlacementsPerType - this._getPlacedCount(type));
  }

  _canPlaceType(type) {
    return this._getRemainingStock(type) > 0;
  }

  _getLabelForType(type) {
    const map = {
      road: 'Road',
      house1: 'House 1',
      factory: 'Factory',
      tower: 'Tower',
      shop: 'Shop',
      house2: 'House 2',
      apartment: 'Apartment',
      clockTower: 'Clock Tower',
      skyscraper: 'Skyscraper',
      hospital: 'Hospital',
      fireStation: 'Fire Station',
      school: 'School',
      library: 'Library',
      bakery: 'Bakery',
      treeA: 'Tree A',
      treeB: 'Tree B',
      flowerGarden: 'Garden',
      park: 'Park'
    };
    return map[type] || type;
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

  // ─────────────────────────────────────────────
  // Building Mesh Dispatch
  // ─────────────────────────────────────────────

  _createBuildingMesh(type, opts = {}) {
    const ghost = !!opts.ghost;
    const mesh = new THREE.Group();
    mesh.userData.assetType = type;

    const procedural = type === 'house1' ? null : this._buildProceduralFallback(type, ghost, opts);
    mesh.userData.proceduralRoot = procedural;
    if (procedural) mesh.add(procedural);

    if (type !== 'factory' && type !== 'park' && type !== 'road') {
      this._loadAsset(type)
        .then((assetScene) => {
          if (!assetScene) return;
          const model = assetScene.clone(true);
          model.name = `${type} asset`;
          this._prepareAssetModel(model, ghost, type);
          if (procedural) mesh.remove(procedural);
          mesh.add(model);
        })
        .catch((err) => {
          console.warn(`Could not load asset for ${type}${procedural ? ', keeping procedural fallback.' : '.'}`, err.message);
        });
    }

    if (!ghost) {
      mesh.scale.y = 0.01;
      const targetScale = 1; const start = performance.now(); const duration = 450;
      const animateIn = (t) => {
        const e = Math.min((t - start) / duration, 1);
        mesh.scale.y = 0.01 + e * (targetScale - 0.01);
        if (e < 1) requestAnimationFrame(animateIn);
      };
      requestAnimationFrame(animateIn);
      this._addLiveBuildingDetails(mesh, type);
    }
    return mesh;
  }

  zoomIn(step = 0.88) {
    if (!this.controls) return;
    this.controls.setDistance(this.controls.distance * step);
  }

  zoomOut(step = 1.12) {
    if (!this.controls) return;
    this.controls.setDistance(this.controls.distance * step);
  }

  // ─────────────────────────────────────────────
  // Material / Geometry caches
  // ─────────────────────────────────────────────

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
      new THREE.TextureLoader().load(url, (tex) => {
        tex.anisotropy = Math.min(8, this.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
        if (colorSpace !== null && 'colorSpace' in tex) tex.colorSpace = colorSpace;
        resolve(tex);
      }, undefined, reject);
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
    const urls = { color: params.get('color_url'), normal: params.get('normal_url'), roughness: params.get('roughness_url'), ao: params.get('ambientocclusion_url') };
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
    const repeats = { wall: [2, 2], wood: [2, 2], metal: [2, 2], asphalt: [6, 6], grass: [6, 6], concrete: [4, 4] }[theme] || [2, 2];
    const applyRepeat = (tex) => {
      if (!tex) return;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeats[0], repeats[1]);
      tex.needsUpdate = true;
    };
    [set.color, set.normal, set.roughness, set.ao].forEach(applyRepeat);
    if (set.color) mat.map = set.color;
    if (set.normal) mat.normalMap = set.normal;
    if (set.roughness) mat.roughnessMap = set.roughness;
    if (set.ao) mat.aoMap = set.ao;
    mat.needsUpdate = true;
  }

  _bootstrapSurfaceThemes() {
    if (this.surfaceThemePromise) return this.surfaceThemePromise;
    const sources = { wall: 'Bricks038', wood: 'Wood063', metal: 'PaintedMetal006', asphalt: 'Asphalt031', grass: 'Grass004', concrete: 'Ground037' };
    this.surfaceThemePromise = Promise.all(Object.entries(sources).map(async ([theme, assetId]) => {
      try {
        const textures = await this._loadAmbientMaterialSet(assetId);
        this.surfaceThemes[theme] = textures;
        this._applyTextureSetToTheme(theme, textures);
      } catch (err) { console.warn(`Texture set ${assetId} failed`, err.message); }
    }));
    return this.surfaceThemePromise;
  }

  _bootstrapPersonAsset() {
    if (this.personAssetPromise) return this.personAssetPromise;
    this.personAssetPromise = import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/utils/SkeletonUtils.js')
        .then((SkeletonUtils) => new Promise((resolve) => {
          new GLTFLoader().load(
            'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb',
            (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations, SkeletonUtils }),
            undefined,
            () => resolve(null)
          );
        })))
      .then((bundle) => { this.personAssetScene = bundle; return bundle; })
      .catch(() => null);
    return this.personAssetPromise;
  }

  _makeWindowMesh(w, h, d, x, y, z, color = 0xcfe8ff, emissive = 0xffd36b, ghost = false) {
    const mat = this._getCachedMaterial(`win:${color.toString(16)}:${emissive.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xd7e3ee : color, emissive: ghost ? 0x000000 : emissive, emissiveIntensity: ghost ? 0.0 : 0.22,
      roughness: 0.2, metalness: 0.65, transparent: !!ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost,
    }));
    const mesh = new THREE.Mesh(this._getCachedGeometry(`win:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  _makeTrimMesh(w, h, d, x, y, z, color, ghost = false) {
    const mat = this._getCachedMaterial(`trim:${color.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xd3dce6 : color, roughness: 0.55, metalness: 0.08, transparent: !!ghost, opacity: ghost ? 0.28 : 1, depthWrite: !ghost,
    }));
    const mesh = new THREE.Mesh(this._getCachedGeometry(`trim:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  _makeCylinderDetail(rt, rb, h, seg, x, y, z, color, ghost = false) {
    const mat = this._getCachedMaterial(`cyl:${color.toString(16)}:${ghost}`, () => new THREE.MeshStandardMaterial({
      color: ghost ? 0xdbe3ec : color, roughness: 0.45, metalness: 0.18, transparent: !!ghost, opacity: ghost ? 0.28 : 1, depthWrite: !ghost,
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
    this.assetPromises[type] = import('https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new Promise((resolve) => {
        new GLTFLoader().load(url, (gltf) => { this.assetScenes[type] = gltf.scene; resolve(gltf.scene); }, undefined, () => resolve(null));
      })).catch(() => null);
    return this.assetPromises[type];
  }

  // ─────────────────────────────────────────────
  // PROCEDURAL FALLBACK BUILDER
  // ─────────────────────────────────────────────

  _buildProceduralFallback(type, ghost, opts = {}) {
    const group = new THREE.Group();
    group.rotation.y = Math.PI;

    const cs = this.cellSize;
    const baseSize = cs * 0.85;

    const getMat = (colorHex) => {
      const themeMap = new Map([
        [0x28313d, 'asphalt'], [0xffe2b3, 'wall'], [0xa3e4d7, 'wall'],
        [0xe67e22, 'wall'], [0x3498db, 'concrete'], [0x2ecc71, 'grass'],
        [0xe74c3c, 'wall'], [0xecf0f1, 'concrete'], [0x1abc9c, 'plaster'],
        [0xd35400, 'wood'], [0xffffff, 'concrete'], [0xc0392b, 'roof'],
        [0x34495e, 'metal'], [0xf1c40f, 'roof'], [0x27ae60, 'grass'],
        [0x9b59b6, 'wall'], [0xbdc3c7, 'metal'], [0xf39c12, 'roof'],
        [0x2ecc71, 'grass'], [0x95a5a6, 'concrete'], [0x8e44ad, 'wood'],
        [0x8fc9f0, 'water'],
      ]);
      const theme = themeMap.get(colorHex);
      if (theme) return this._getThemeMaterial(theme, ghost);
      return new THREE.MeshStandardMaterial({
        color: ghost ? 0xcfd8e3 : colorHex, roughness: 0.6, metalness: 0.1,
        opacity: ghost ? 0.35 : 1.0, transparent: !!ghost, depthWrite: !ghost,
      });
    };

    const winMat = this._getThemeMaterial('glass', ghost);
    const createWin = (w, h, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), winMat);
      mesh.position.set(x, y, z);
      return mesh;
    };

    const bodyH = {
      house1: cs * 0.8, house2: cs * 1.0, factory: cs * 0.7, tower: cs * 1.8,
      shop: cs * 0.6, apartment: cs * 1.5, clockTower: cs * 2.0, skyscraper: cs * 3.0,
      hospital: cs * 1.2, fireStation: cs * 0.8, school: cs * 0.9, library: cs * 1.1, bakery: cs * 0.7,
    }[type] || cs;

    let meshes = [];

    const stdMat = (color, roughness = 0.65, metalness = 0.08) => new THREE.MeshStandardMaterial({
      color: ghost ? 0xcfd8e3 : color, roughness, metalness,
      transparent: !!ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost,
    });

    switch (type) {
      // ── ROAD (enhanced: two-lane markings + kerb strips) ──────────────
      case 'road': {
        group.rotation.y = 0;
        const roadVisual = this._buildRoadProcedural({
          ghost,
          connections: opts.roadConnections || null,
          roadRotation: opts.roadRotation || 0,
        });
        group.add(roadVisual);
        break;
      }

      // ── HOSPITAL (iconic red cross, white facade) ──
      case 'hospital': {
        const foundation = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.08, cs * 0.16, baseSize * 0.88), stdMat(0xd7dde5, 0.82, 0.04));
        foundation.position.y = cs * 0.08;
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.98, cs * 1.1, baseSize * 0.76), stdMat(0xf7f8f8, 0.78, 0.02));
        body.position.y = cs * 0.71;

        const roofBar = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.02, cs * 0.1, baseSize * 0.8), stdMat(0xd9413b, 0.65, 0.05));
        roofBar.position.y = cs * 1.31;
        const redBand = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.0, cs * 0.08, baseSize * 0.78), stdMat(0xe74c3c, 0.66, 0.05));
        redBand.position.y = cs * 0.98;

        const crossBack = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.62, cs * 0.62, cs * 0.035), stdMat(0xffffff, 0.62, 0.04));
        crossBack.position.set(0, cs * 1.14, baseSize * 0.392);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.44, cs * 0.1, cs * 0.045), stdMat(0xe6322d, 0.6, 0.08));
        crossH.position.set(0, cs * 1.14, baseSize * 0.42);
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.1, cs * 0.44, cs * 0.045), stdMat(0xe6322d, 0.6, 0.08));
        crossV.position.set(0, cs * 1.14, baseSize * 0.425);

        for (const y of [cs * 0.48, cs * 0.75]) {
          for (const x of [-baseSize * 0.3, -baseSize * 0.12, baseSize * 0.12, baseSize * 0.3]) {
            meshes.push(createWin(cs * 0.13, cs * 0.16, x, y, baseSize * 0.385));
          }
        }

        const entryFrame = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.34, cs * 0.52, cs * 0.045), stdMat(0xdfe7ef, 0.72, 0.05));
        entryFrame.position.set(0, cs * 0.36, baseSize * 0.405);
        const door = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.22, cs * 0.42, cs * 0.052), this._getThemeMaterial('glass', ghost));
        door.position.set(0, cs * 0.31, baseSize * 0.43);

        meshes.push(foundation, body, roofBar, redBand, crossBack, crossH, crossV, entryFrame, door);
        break;
      }

      // ── FIRE STATION (red facade with bay doors) ──
      case 'fireStation': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.0, cs * 0.92, baseSize * 0.82), stdMat(0xc0392b, 0.8, 0.06));
        body.position.y = cs * 0.46;

        const band = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.02, cs * 0.07, baseSize * 0.84), stdMat(0xffffff, 0.8, 0.02));
        band.position.y = cs * 0.72;

        const parapet = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.06, cs * 0.07, baseSize * 0.88), stdMat(0x922b21, 0.8, 0.05));
        parapet.position.y = cs * 0.96;

        // Three garage bay doors
        const doorMat = stdMat(0x7f8c8d, 0.6, 0.2);
        for (const dx of [-baseSize * 0.3, 0, baseSize * 0.3]) {
          const doorOuter = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.28, cs * 0.5, cs * 0.04), doorMat);
          doorOuter.position.set(dx, cs * 0.27, baseSize * 0.42);
          meshes.push(doorOuter);
        }

        // Siren beacon on roof
        const sirenPost = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.025, cs * 0.025, cs * 0.25, 8), stdMat(0x2c3e50, 0.5, 0.3));
        sirenPost.position.set(0, cs * 1.08, 0);
        const sirenDome = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat(0xff0000, 0.3, 0.3));
        sirenDome.position.set(0, cs * 1.22, 0);
        sirenDome.userData.isSiren = true;

        meshes.push(body, band, parapet, sirenPost, sirenDome);
        break;
      }

      // ── SCHOOL (orange/yellow with flagpole and educational look) ──
      case 'school': {
        const mainBlock = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.62, cs * 1.05, baseSize * 0.62), stdMat(0xf39c12, 0.85, 0.03));
        mainBlock.position.y = cs * 0.525;

        const wingL = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.36, cs * 0.82, baseSize * 0.54), stdMat(0xe67e22, 0.85, 0.03));
        wingL.position.set(-baseSize * 0.49, cs * 0.41, 0);

        const wingR = wingL.clone();
        wingR.position.set(baseSize * 0.49, cs * 0.41, 0);

        const mainCornice = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.66, cs * 0.06, baseSize * 0.66), stdMat(0xd68910, 0.8, 0.04));
        mainCornice.position.y = cs * 1.08;

        // Flagpole
        const flagpole = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.02, cs * 0.02, cs * 1.1, 8), stdMat(0xbdc3c7, 0.5, 0.4));
        flagpole.position.set(baseSize * 0.44, cs * 0.97, baseSize * 0.44);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.28, cs * 0.18, cs * 0.02), stdMat(0xe74c3c, 0.6, 0));
        flag.position.set(baseSize * 0.44 + cs * 0.14, cs * 1.44, baseSize * 0.44);
        flag.userData.isFlag = true;

        // Clock on front face
        const clockBase = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.16, cs * 0.16, cs * 0.04, 20), stdMat(0xffffff, 0.5, 0.1));
        clockBase.rotation.x = Math.PI / 2;
        clockBase.position.set(0, cs * 0.82, baseSize * 0.32);
        const clockRim = new THREE.Mesh(new THREE.TorusGeometry(cs * 0.16, cs * 0.022, 8, 24), stdMat(0x2c3e50, 0.5, 0.2));
        clockRim.rotation.x = Math.PI / 2;
        clockRim.position.set(0, cs * 0.82, baseSize * 0.322);

        // Windows (symmetric arrangement)
        for (const [wx, wz] of [[-baseSize * 0.49, baseSize * 0.28], [baseSize * 0.49, baseSize * 0.28]]) {
          for (const wy of [cs * 0.3, cs * 0.62]) {
            meshes.push(createWin(cs * 0.18, cs * 0.22, wx, wy, wz));
            meshes.push(createWin(cs * 0.18, cs * 0.22, wx, wy, -baseSize * 0.28));
          }
        }

        meshes.push(mainBlock, wingL, wingR, mainCornice, flagpole, flag, clockBase, clockRim);
        break;
      }

      // ── SHOP (storefront with large display window) ──
      case 'shop': {
        const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(baseSize, cs * 0.08, baseSize * 0.86), stdMat(0xd8dde2, 0.86, 0.04));
        sidewalk.position.y = cs * 0.04;

        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.82, cs * 0.72, baseSize * 0.62), stdMat(0xe9d7be, 0.82, 0.03));
        body.position.y = cs * 0.44;

        const backWall = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.82, cs * 0.34, baseSize * 0.62), stdMat(0xc55d3b, 0.76, 0.04));
        backWall.position.y = cs * 0.92;

        const roofCap = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.92, cs * 0.1, baseSize * 0.72), stdMat(0x3f4854, 0.58, 0.16));
        roofCap.position.y = cs * 1.14;

        const sign = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.66, cs * 0.2, cs * 0.045), stdMat(0x2f80ed, 0.62, 0.08));
        sign.position.set(0, cs * 0.88, baseSize * 0.335);

        const glass = this._getThemeMaterial('glass', ghost);
        const windowFrame = stdMat(0x25313d, 0.5, 0.18);
        for (const sx of [-baseSize * 0.18, baseSize * 0.18]) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.26, cs * 0.42, cs * 0.045), windowFrame);
          frame.position.set(sx, cs * 0.4, baseSize * 0.335);
          const pane = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.21, cs * 0.34, cs * 0.052), glass);
          pane.position.set(sx, cs * 0.4, baseSize * 0.36);
          meshes.push(frame, pane);
        }

        const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.22, cs * 0.48, cs * 0.05), windowFrame);
        doorFrame.position.set(0, cs * 0.3, baseSize * 0.36);
        const door = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.17, cs * 0.42, cs * 0.058), glass);
        door.position.set(0, cs * 0.28, baseSize * 0.385);
        const handle = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.018, 8, 8), stdMat(0xe3c05b, 0.35, 0.65));
        handle.position.set(cs * 0.055, cs * 0.3, baseSize * 0.425);

        const awningTop = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.76, cs * 0.06, cs * 0.24), stdMat(0xf4d35e, 0.62, 0.05));
        awningTop.position.set(0, cs * 0.68, baseSize * 0.43);
        const awningLip = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.78, cs * 0.08, cs * 0.05), stdMat(0x2f80ed, 0.62, 0.08));
        awningLip.position.set(0, cs * 0.61, baseSize * 0.54);
        for (const sx of [-baseSize * 0.33, baseSize * 0.33]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.018, cs * 0.018, cs * 0.5, 8), stdMat(0xdce4ec, 0.52, 0.25));
          post.position.set(sx, cs * 0.33, baseSize * 0.52);
          meshes.push(post);
        }

        meshes.push(sidewalk, body, backWall, roofCap, sign, doorFrame, door, handle, awningTop, awningLip);
        break;
      }

      // ── All other types (unchanged from original) ──────────────────────

      case 'house1': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.8, cs * 0.8, baseSize * 0.8), getMat(0xffe2b3));
        body.position.y = cs * 0.4;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(baseSize * 0.6, cs * 0.5, 4), getMat(0xff6b6b));
        roof.position.y = cs * 0.8 + cs * 0.25; roof.rotation.y = Math.PI / 4;
        meshes.push(body, roof, createWin(cs * 0.3, cs * 0.3, 0, cs * 0.4, baseSize * 0.4));
        break;
      }
      case 'house2': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.9, cs * 1.0, baseSize * 0.7), getMat(0xa3e4d7));
        body.position.y = cs * 0.5;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 1.0, cs * 0.2, baseSize * 0.8), getMat(0xf1c40f));
        roof.position.y = cs * 1.1;
        meshes.push(body, roof,
          createWin(cs * 0.25, cs * 0.3, baseSize * 0.25, cs * 0.5, baseSize * 0.35),
          createWin(cs * 0.25, cs * 0.3, -baseSize * 0.25, cs * 0.5, baseSize * 0.35));
        break;
      }
      case 'factory': {
        const fMat = (c, r = 0.6, m = 0.08) => new THREE.MeshStandardMaterial({ color: ghost ? 0xcfd8e3 : c, roughness: r, metalness: m, transparent: !!ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost });
        const factoryBase = new THREE.Mesh(new THREE.BoxGeometry(baseSize, cs * 0.12, baseSize), fMat(0xdde6ea, 0.78, 0.04));
        factoryBase.position.y = cs * 0.06;
        const fbody = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.62, cs * 0.62, baseSize * 0.5), fMat(0xf2efe8, 0.74, 0.04));
        fbody.position.y = cs * 0.43;
        const wing = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.32, cs * 0.5, baseSize * 0.38), fMat(0xe8d7ba, 0.76, 0.04));
        wing.position.set(-baseSize * 0.35, cs * 0.37, 0);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(baseSize * 0.16, baseSize * 0.16, baseSize * 0.62, 20, 1, false, 0, Math.PI), fMat(0x4f86d9, 0.42, 0.18));
        roof.rotation.z = Math.PI / 2; roof.position.set(0, cs * 0.75, 0);
        const chimneyMat = fMat(0xf4f4f4, 0.52, 0.12);
        const stripeMat2 = fMat(0xff5f5f, 0.48, 0.12);
        const chimneyGeo = new THREE.CylinderGeometry(cs * 0.075, cs * 0.075, cs * 0.84, 20);
        const stripeGeo = new THREE.CylinderGeometry(cs * 0.078, cs * 0.078, cs * 0.08, 20);
        for (const x of [-baseSize * 0.12, baseSize * 0.12]) {
          const ch = new THREE.Mesh(chimneyGeo, chimneyMat); ch.position.set(x, cs * 1.08, -baseSize * 0.08); meshes.push(ch);
          for (const o of [-cs * 0.17, cs * 0.17]) { const st = new THREE.Mesh(stripeGeo, stripeMat2); st.position.set(x, cs * 1.08 + o, -baseSize * 0.08); meshes.push(st); }
        }
        for (let x = -baseSize * 0.18; x <= baseSize * 0.18 + 0.001; x += baseSize * 0.18)
          for (const y of [cs * 0.34, cs * 0.54]) meshes.push(createWin(cs * 0.16, cs * 0.16, x, y, baseSize * 0.255));
        const makeTree = (x, z) => {
          const trunk = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.05, cs * 0.16, cs * 0.05), fMat(0x8b5a2b, 0.72, 0.02));
          trunk.position.set(x, cs * 0.2, z);
          const top = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.12, 12, 12), fMat(0x63c05b, 0.78, 0.02));
          top.position.set(x, cs * 0.36, z);
          meshes.push(trunk, top);
        };
        makeTree(-baseSize * 0.36, baseSize * 0.36); makeTree(baseSize * 0.36, baseSize * 0.36);
        makeTree(-baseSize * 0.36, -baseSize * 0.36); makeTree(baseSize * 0.36, -baseSize * 0.36);
        meshes.push(factoryBase, fbody, wing, roof);
        break;
      }
      case 'tower': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.74, cs * 0.22, baseSize * 0.74), stdMat(0x3a4654, 0.58, 0.16));
        base.position.y = cs * 0.11;
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.52, cs * 1.62, baseSize * 0.52), stdMat(0x6f879b, 0.56, 0.18));
        shaft.position.y = cs * 0.92;
        const crown = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.6, cs * 0.16, baseSize * 0.6), stdMat(0x263342, 0.5, 0.22));
        crown.position.y = cs * 1.81;
        const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.42, cs * 0.1, baseSize * 0.42), stdMat(0xb8c5d1, 0.64, 0.08));
        roofDeck.position.y = cs * 1.94;
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.018, cs * 0.018, cs * 0.38, 8), stdMat(0xd9e7f3, 0.45, 0.35));
        antenna.position.y = cs * 2.18;

        const glass = this._getThemeMaterial('glass', ghost);
        for (const y of [cs * 0.48, cs * 0.78, cs * 1.08, cs * 1.38]) {
          for (const x of [-baseSize * 0.14, baseSize * 0.14]) {
            meshes.push(createWin(cs * 0.13, cs * 0.18, x, y, baseSize * 0.265));
            const back = createWin(cs * 0.13, cs * 0.18, x, y, -baseSize * 0.265);
            back.rotation.y = Math.PI;
            meshes.push(back);
          }
          for (const z of [-baseSize * 0.14, baseSize * 0.14]) {
            const sideL = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.025, cs * 0.18, cs * 0.13), glass);
            sideL.position.set(-baseSize * 0.265, y, z);
            const sideR = sideL.clone();
            sideR.position.set(baseSize * 0.265, y, z);
            meshes.push(sideL, sideR);
          }
        }

        meshes.push(base, shaft, crown, roofDeck, antenna);
        break;
      }
      case 'apartment': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.86, cs * 0.16, baseSize * 0.78), stdMat(0x4b5563, 0.62, 0.12));
        base.position.y = cs * 0.08;
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.76, cs * 1.34, baseSize * 0.66), stdMat(0xc95f4b, 0.82, 0.035));
        body.position.y = cs * 0.83;
        const sideCore = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.22, cs * 1.34, baseSize * 0.68), stdMat(0xe2c6a5, 0.86, 0.025));
        sideCore.position.set(-baseSize * 0.27, cs * 0.83, 0);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.82, cs * 0.1, baseSize * 0.72), stdMat(0x384454, 0.58, 0.16));
        roof.position.y = cs * 1.55;

        const balconyMat = stdMat(0xdce4ec, 0.62, 0.14);
        const railMat = stdMat(0x263342, 0.5, 0.22);
        for (let floor = 0; floor < 3; floor++) {
          const y = cs * (0.45 + floor * 0.34);
          for (const x of [-baseSize * 0.12, baseSize * 0.2]) {
            const pane = createWin(cs * 0.16, cs * 0.18, x, y + cs * 0.07, baseSize * 0.335);
            const slab = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.25, cs * 0.035, cs * 0.12), balconyMat);
            slab.position.set(x, y - cs * 0.07, baseSize * 0.39);
            const railFront = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.25, cs * 0.11, cs * 0.022), railMat);
            railFront.position.set(x, y, baseSize * 0.45);
            const railL = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.022, cs * 0.1, cs * 0.1), railMat);
            railL.position.set(x - cs * 0.125, y, baseSize * 0.405);
            const railR = railL.clone();
            railR.position.x = x + cs * 0.125;
            const supportL = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.022, cs * 0.12, cs * 0.022), balconyMat);
            supportL.position.set(x - cs * 0.105, y - cs * 0.14, baseSize * 0.39);
            const supportR = supportL.clone();
            supportR.position.x = x + cs * 0.105;
            meshes.push(pane, slab, railFront, railL, railR, supportL, supportR);
          }
          const stairWin = createWin(cs * 0.12, cs * 0.2, -baseSize * 0.27, y + cs * 0.05, baseSize * 0.345);
          meshes.push(stairWin);
        }

        const entry = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.22, cs * 0.42, cs * 0.045), stdMat(0x2f3a48, 0.55, 0.18));
        entry.position.set(baseSize * 0.31, cs * 0.29, baseSize * 0.355);
        meshes.push(base, body, sideCore, roof, entry);
        break;
      }
      case 'clockTower': {
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.68, cs * 0.22, baseSize * 0.68), stdMat(0x8d99a6, 0.78, 0.05));
        plinth.position.y = cs * 0.11;
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.48, cs * 1.46, baseSize * 0.48), stdMat(0xe5e1d3, 0.84, 0.025));
        shaft.position.y = cs * 0.95;
        const clockStage = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.58, cs * 0.42, baseSize * 0.58), stdMat(0xc8bda8, 0.82, 0.035));
        clockStage.position.y = cs * 1.68;
        const cornice = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.66, cs * 0.1, baseSize * 0.66), stdMat(0x7c8792, 0.68, 0.08));
        cornice.position.y = cs * 1.94;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(baseSize * 0.44, cs * 0.48, 4), stdMat(0x9f3d35, 0.62, 0.08));
        roof.position.y = cs * 2.23;
        roof.rotation.y = Math.PI / 4;

        const clockMat = stdMat(0xf7f1dc, 0.52, 0.08);
        const rimMat = stdMat(0x2c3440, 0.48, 0.24);
        for (const [z, faceSide] of [[baseSize * 0.295, 1], [-baseSize * 0.295, -1]]) {
          const face = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.16, cs * 0.16, cs * 0.035, 24), clockMat);
          face.rotation.x = Math.PI / 2;
          face.position.set(0, cs * 1.68, z);
          const hour = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.035, cs * 0.12, cs * 0.02), rimMat);
          hour.position.set(0, cs * 1.7, z + faceSide * cs * 0.03);
          const minute = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.025, cs * 0.19, cs * 0.02), rimMat);
          minute.position.copy(hour.position);
          minute.rotation.z = -0.85;
          if (faceSide < 0) {
            face.rotation.y = Math.PI;
            hour.rotation.y = Math.PI;
            minute.rotation.y = Math.PI;
          }
          meshes.push(face, hour, minute);
        }

        const doorway = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.2, cs * 0.42, cs * 0.045), stdMat(0x4c3b32, 0.72, 0.08));
        doorway.position.set(0, cs * 0.34, baseSize * 0.255);
        meshes.push(plinth, shaft, clockStage, cornice, roof, doorway);
        break;
      }
      case 'skyscraper': {
        const darkGlass = stdMat(0x163d4d, 0.38, 0.26);
        const blueGlass = stdMat(0x35b7d8, 0.32, 0.2);
        const steel = stdMat(0xd7e4ec, 0.42, 0.32);
        const neon = new THREE.MeshStandardMaterial({
          color: ghost ? 0xcfd8e3 : 0x7ff7ff,
          emissive: ghost ? 0x000000 : 0x35e8ff,
          emissiveIntensity: ghost ? 0 : 1.6,
          roughness: 0.22,
          metalness: 0.2,
          transparent: !!ghost,
          opacity: ghost ? 0.35 : 1,
          depthWrite: !ghost,
        });
        const warmLight = new THREE.MeshStandardMaterial({
          color: ghost ? 0xcfd8e3 : 0xfff3a6,
          emissive: ghost ? 0x000000 : 0xffd85c,
          emissiveIntensity: ghost ? 0 : 0.95,
          roughness: 0.35,
          metalness: 0.08,
          transparent: !!ghost,
          opacity: ghost ? 0.35 : 1,
          depthWrite: !ghost,
        });

        const plaza = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.95, cs * 0.18, baseSize * 0.9), stdMat(0x2b3440, 0.56, 0.16));
        plaza.position.y = cs * 0.09;
        const podium = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.78, cs * 0.48, baseSize * 0.72), stdMat(0x263342, 0.5, 0.22));
        podium.position.y = cs * 0.34;

        const mainTower = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.48, cs * 4.1, baseSize * 0.48), darkGlass);
        mainTower.position.y = cs * 2.48;
        const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.34, cs * 3.85, cs * 0.035), blueGlass);
        frontGlass.position.set(0, cs * 2.55, baseSize * 0.255);
        const backGlass = frontGlass.clone();
        backGlass.position.z = -baseSize * 0.255;
        const leftFin = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.045, cs * 4.15, baseSize * 0.54), steel);
        leftFin.position.set(-baseSize * 0.27, cs * 2.5, 0);
        const rightFin = leftFin.clone();
        rightFin.position.x = baseSize * 0.27;

        const upperSetback = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.38, cs * 1.1, baseSize * 0.38), stdMat(0x20576b, 0.36, 0.22));
        upperSetback.position.y = cs * 4.95;
        const crownRing = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.56, cs * 0.12, baseSize * 0.56), neon);
        crownRing.position.y = cs * 5.55;
        crownRing.userData.isSkyscraperPulse = true;

        const spireBase = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.08, cs * 0.11, cs * 0.46, 12), steel);
        spireBase.position.y = cs * 5.84;
        const spire = new THREE.Mesh(new THREE.ConeGeometry(cs * 0.1, cs * 0.88, 12), neon);
        spire.position.y = cs * 6.5;
        spire.userData.isSkyscraperPulse = true;

        const halo = new THREE.Mesh(new THREE.TorusGeometry(cs * 0.34, cs * 0.018, 8, 36), neon);
        halo.position.y = cs * 5.72;
        halo.rotation.x = Math.PI / 2;
        halo.userData.isSkyscraperRotor = true;
        halo.userData.isSkyscraperPulse = true;

        for (let floor = 0; floor < 13; floor++) {
          const y = cs * (0.78 + floor * 0.29);
          const lit = floor % 3 !== 1;
          for (const x of [-baseSize * 0.14, 0, baseSize * 0.14]) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.08, cs * 0.13, cs * 0.025), lit ? warmLight : this._getThemeMaterial('glass', ghost));
            win.position.set(x, y, baseSize * 0.282);
            if (lit) win.userData.isSkyscraperPulse = true;
            meshes.push(win);
          }
          for (const z of [-baseSize * 0.12, baseSize * 0.12]) {
            const sideWin = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.025, cs * 0.12, cs * 0.08), lit ? warmLight : this._getThemeMaterial('glass', ghost));
            sideWin.position.set(baseSize * 0.295, y, z);
            if (lit) sideWin.userData.isSkyscraperPulse = true;
            meshes.push(sideWin);
          }
        }

        for (const [x, z] of [[-baseSize * 0.32, baseSize * 0.3], [baseSize * 0.32, baseSize * 0.3], [-baseSize * 0.32, -baseSize * 0.3], [baseSize * 0.32, -baseSize * 0.3]]) {
          const lobbyLight = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.035, cs * 0.035, cs * 0.08, 10), warmLight);
          lobbyLight.position.set(x, cs * 0.25, z);
          lobbyLight.userData.isSkyscraperPulse = true;
          meshes.push(lobbyLight);
        }

        meshes.push(plaza, podium, mainTower, frontGlass, backGlass, leftFin, rightFin, upperSetback, crownRing, spireBase, spire, halo);
        break;
      }
      case 'library': {
        const stone = stdMat(0xd8d0bd, 0.84, 0.04);
        const warmStone = stdMat(0xbfae8a, 0.82, 0.05);
        const darkRoof = stdMat(0x34495e, 0.55, 0.18);
        const bookBlue = stdMat(0x2f80ed, 0.58, 0.08);
        const bookRed = stdMat(0xc94c4c, 0.64, 0.06);

        const plinth = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.98, cs * 0.18, baseSize * 0.88), warmStone);
        plinth.position.y = cs * 0.09;
        const steps1 = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.72, cs * 0.08, cs * 0.28), stdMat(0xc8c0ad, 0.86, 0.04));
        steps1.position.set(0, cs * 0.17, baseSize * 0.49);
        const steps2 = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.58, cs * 0.08, cs * 0.2), stdMat(0xddd6c6, 0.86, 0.04));
        steps2.position.set(0, cs * 0.25, baseSize * 0.4);

        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.84, cs * 1.05, baseSize * 0.68), stone);
        body.position.y = cs * 0.78;
        const sideWingL = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.2, cs * 0.88, baseSize * 0.7), stdMat(0xcbbf9f, 0.84, 0.04));
        sideWingL.position.set(-baseSize * 0.45, cs * 0.7, 0);
        const sideWingR = sideWingL.clone();
        sideWingR.position.x = baseSize * 0.45;

        const roof = new THREE.Mesh(new THREE.ConeGeometry(baseSize * 0.64, cs * 0.42, 4), darkRoof);
        roof.position.y = cs * 1.5;
        roof.rotation.y = Math.PI / 4;
        const cornice = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.98, cs * 0.08, baseSize * 0.82), stdMat(0x8a7b62, 0.76, 0.08));
        cornice.position.y = cs * 1.31;

        for (const x of [-baseSize * 0.3, -baseSize * 0.1, baseSize * 0.1, baseSize * 0.3]) {
          const column = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.045, cs * 0.052, cs * 0.7, 10), stdMat(0xf1ead8, 0.82, 0.04));
          column.position.set(x, cs * 0.62, baseSize * 0.38);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.16, cs * 0.04, cs * 0.12), warmStone);
          cap.position.set(x, cs * 0.98, baseSize * 0.38);
          meshes.push(column, cap);
        }

        const entrance = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.24, cs * 0.5, cs * 0.05), this._getThemeMaterial('glass', ghost));
        entrance.position.set(0, cs * 0.44, baseSize * 0.41);
        const arch = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.34, cs * 0.12, cs * 0.06), darkRoof);
        arch.position.set(0, cs * 0.72, baseSize * 0.43);

        const glass = this._getThemeMaterial('glass', ghost);
        for (const y of [cs * 0.62, cs * 0.95]) {
          for (const x of [-baseSize * 0.28, baseSize * 0.28]) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.16, cs * 0.18, cs * 0.045), glass);
            win.position.set(x, y, baseSize * 0.36);
            meshes.push(win);
          }
        }

        const bookA = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.28, cs * 0.09, cs * 0.42), bookBlue);
        bookA.position.set(-cs * 0.11, cs * 1.73, 0);
        bookA.rotation.z = -0.18;
        const bookB = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.28, cs * 0.09, cs * 0.42), bookRed);
        bookB.position.set(cs * 0.11, cs * 1.73, 0);
        bookB.rotation.z = 0.18;
        const bookPage = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.04, cs * 0.1, cs * 0.44), stdMat(0xf8f3df, 0.72, 0.02));
        bookPage.position.set(0, cs * 1.76, 0);

        meshes.push(plinth, steps1, steps2, body, sideWingL, sideWingR, roof, cornice, entrance, arch, bookA, bookB, bookPage);
        break;
      }
      case 'bakery': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.7, cs * 0.7, baseSize * 0.7), getMat(0xd35400));
        body.position.y = cs * 0.35;
        const roof = new THREE.Mesh(new THREE.SphereGeometry(baseSize * 0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), getMat(0xf1c40f));
        roof.position.y = cs * 0.7;
        meshes.push(body, roof, createWin(cs * 0.4, cs * 0.3, 0, cs * 0.35, baseSize * 0.35));
        break;
      }
      case 'treeA': {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.08, cs * 0.1, cs * 0.5, 6), getMat(0x8e44ad));
        trunk.position.y = cs * 0.25;
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.35, 8, 8), getMat(0x2ecc71));
        leaves.position.y = cs * 0.6;
        meshes.push(trunk, leaves);
        break;
      }
      case 'treeB': {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.06, cs * 0.06, cs * 0.6, 6), getMat(0xd35400));
        trunk.position.y = cs * 0.3;
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(cs * 0.3, cs * 0.8, 6), getMat(0x27ae60));
        leaves.position.y = cs * 0.8;
        meshes.push(trunk, leaves);
        break;
      }
      case 'flowerGarden': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.84, cs * 0.1, baseSize * 0.84), getMat(0x2ecc71));
        base.position.y = cs * 0.05;

        const soil = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.68, cs * 0.04, baseSize * 0.68), stdMat(0x6f4e37, 0.9, 0.02));
        soil.position.y = cs * 0.12;
        const edgeMat = stdMat(0xd6c7a5, 0.78, 0.03);
        const borderW = cs * 0.06;
        for (const [x, z, w, d] of [
          [0, baseSize * 0.36, baseSize * 0.76, borderW],
          [0, -baseSize * 0.36, baseSize * 0.76, borderW],
          [baseSize * 0.36, 0, borderW, baseSize * 0.76],
          [-baseSize * 0.36, 0, borderW, baseSize * 0.76],
        ]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(w, cs * 0.08, d), edgeMat);
          edge.position.set(x, cs * 0.15, z);
          meshes.push(edge);
        }

        const flowerColors = [0xe74c3c, 0xf1c40f, 0x9b59b6, 0xff7eb6, 0xff8a3d, 0x48c9b0, 0x5dade2, 0xffffff];
        const positions = [
          [-0.24, -0.24], [0, -0.27], [0.24, -0.24],
          [-0.28, 0], [-0.08, -0.03], [0.12, 0.03], [0.3, 0],
          [-0.22, 0.24], [0.02, 0.28], [0.25, 0.22],
          [-0.34, 0.16], [0.35, -0.16],
        ];
        positions.forEach(([px, pz], i) => {
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.012, cs * 0.014, cs * 0.14, 5), stdMat(0x1f8f45, 0.78, 0.02));
          stem.position.set(baseSize * px, cs * 0.23, baseSize * pz);
          const head = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.075, 8, 8), stdMat(flowerColors[i % flowerColors.length], 0.58, 0.02));
          head.position.set(baseSize * px, cs * 0.33, baseSize * pz);
          meshes.push(stem, head);
        });

        meshes.push(base, soil);
        break;
      }
      case 'park': {
        const parkGroup = new THREE.Group();
        const M = (geo, color, opacity = 1, transparent = false) => {
          const mat = new THREE.MeshLambertMaterial({
            color: ghost ? 0xcfd8e3 : color,
            transparent: ghost || transparent,
            opacity: ghost ? 0.35 : opacity,
            depthWrite: !ghost,
          });
          const m = new THREE.Mesh(geo, mat); m.castShadow = !ghost; m.receiveShadow = !ghost; return m;
        };
        const box2 = (w, h, d, c) => M(new THREE.BoxGeometry(w, h, d), c);
        const cyl2 = (rt, rb, h, s, c) => M(new THREE.CylinderGeometry(rt, rb, h, s), c);
        const sph2 = (r, c, seg = 8) => M(new THREE.SphereGeometry(r, seg, seg), c);
        const place = (mesh, x, y, z) => { mesh.position.set(x, y, z); parkGroup.add(mesh); return mesh; };

        place(box2(12, 0.32, 12, 0x5aaa44), 0, 0.12, 0);
        const patchMat = new THREE.MeshLambertMaterial({ color: ghost ? 0xcfd8e3 : 0x4a9a38, transparent: !!ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost });
        for (const [x, z, r] of [[-4, -2.8, 0.55], [-2.3, 4, 0.44], [2.9, -3.7, 0.52], [4, 2.8, 0.48], [-4.2, 3.2, 0.36], [1.8, 3.8, 0.4]]) {
          const patch = new THREE.Mesh(new THREE.CircleGeometry(r, 7), patchMat);
          patch.rotation.x = -Math.PI / 2;
          patch.position.set(x, 0.042, z);
          patch.receiveShadow = !ghost;
          parkGroup.add(patch);
        }

        const pathMat = new THREE.MeshLambertMaterial({ color: ghost ? 0xcfd8e3 : 0xd4c5a9, transparent: !!ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost });
        const pathH = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.7), pathMat); pathH.rotation.x = -Math.PI / 2; pathH.position.y = 0.042; parkGroup.add(pathH);
        const pathV = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 12), pathMat); pathV.rotation.x = -Math.PI / 2; pathV.position.y = 0.042; parkGroup.add(pathV);
        const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), pathMat);
        plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.043; parkGroup.add(plaza);

        place(cyl2(0.9, 1.0, 0.18, 24, 0xb0bec5), 0, 0.13, 0);
        place(cyl2(0.08, 0.08, 0.55, 10, 0x9e9e9e), 0, 0.58, 0);
        place(cyl2(0.18, 0.18, 0.08, 12, 0xbdbdbd), 0, 0.88, 0);
        const waterMat = new THREE.MeshLambertMaterial({ color: ghost ? 0xcfd8e3 : 0x29b6f6, transparent: true, opacity: ghost ? 0.35 : 0.85, depthWrite: !ghost });
        const water = new THREE.Mesh(new THREE.CircleGeometry(0.72, 32), waterMat);
        water.rotation.x = -Math.PI / 2; water.position.set(0, 0.22, 0); parkGroup.add(water);

        function treeP(x, z, s = 1) {
          const t = cyl2(0.06 * s, 0.09 * s, 0.55 * s, 6, 0x6d4c41);
          t.position.set(x, 0.32 * s, z); parkGroup.add(t);
          const b = sph2(0.32 * s, 0x2e7d32);
          b.position.set(x, 0.75 * s, z); parkGroup.add(b);
          const b2 = sph2(0.22 * s, 0x388e3c);
          b2.position.set(x + 0.08 * s, 1.0 * s, z - 0.06 * s); parkGroup.add(b2);
        }
        treeP(-3.5, -3.5, 1.1); treeP(3.5, -3.5, 1.0); treeP(-3.5, 3.5, 1.2); treeP(3.5, 3.5, 0.9);
        treeP(-4.8, 0, 0.9); treeP(4.8, 0, 1.0); treeP(0, -4.8, 1.1); treeP(0, 4.8, 0.95);
        treeP(-2.5, -4.5, 0.8); treeP(2.5, -4.5, 0.85); treeP(-2.5, 4.5, 0.8); treeP(2.5, 4.5, 0.9);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          treeP(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.65);
        }

        function bench(x, z, ry = 0) {
          const g = new THREE.Group();
          const seat = box2(0.7, 0.04, 0.22, 0x8d6e63); seat.position.y = 0.2; g.add(seat);
          const back = box2(0.7, 0.18, 0.04, 0x795548); back.position.set(0, 0.3, -0.1); g.add(back);
          for (const ox of [-0.28, 0.28]) {
            const leg = box2(0.04, 0.2, 0.22, 0x6d4c41); leg.position.set(ox, 0.1, 0); g.add(leg);
          }
          g.position.set(x, 0.04, z); g.rotation.y = ry; parkGroup.add(g);
        }
        bench(-1.5, 0.6, 0); bench(1.5, -0.6, Math.PI);
        bench(0.6, -1.5, Math.PI / 2); bench(-0.6, 1.5, -Math.PI / 2);
        bench(-3.5, 0.5, 0); bench(3.5, -0.5, Math.PI);
        bench(0.5, -3.5, Math.PI / 2); bench(-0.5, 3.5, -Math.PI / 2);

        function lamp(x, z) {
          const post = cyl2(0.03, 0.04, 1.1, 6, 0x37474f);
          post.position.set(x, 0.6, z); parkGroup.add(post);
          const globe = sph2(0.07, 0xfffde7, 6);
          globe.position.set(x, 1.18, z); parkGroup.add(globe);
          if (!ghost) {
            const light = new THREE.PointLight(0xfffde7, 0.45, 3.5);
            light.position.set(x, 1.18, z); parkGroup.add(light);
          }
        }
        lamp(-1.2, -1.2); lamp(1.2, -1.2); lamp(-1.2, 1.2); lamp(1.2, 1.2);
        lamp(-3.8, -3.8); lamp(3.8, -3.8); lamp(-3.8, 3.8); lamp(3.8, 3.8);

        const parkFlowerColors = [0xf06292, 0xffb74d, 0xce93d8, 0xff8a65, 0xfff176, 0xef9a9a];
        function parkFlower(x, z, colorIndex) {
          const stem = cyl2(0.012, 0.012, 0.14, 4, 0x66bb6a);
          stem.position.set(x, 0.11, z); parkGroup.add(stem);
          const head = sph2(0.055, parkFlowerColors[colorIndex % parkFlowerColors.length], 5);
          head.position.set(x, 0.2, z); parkGroup.add(head);
        }
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const r = 1.4 + (i % 4) * 0.045;
          parkFlower(Math.cos(a) * r, Math.sin(a) * r, i);
        }
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(([cx, cz], clusterIndex) => {
          for (let i = 0; i < 7; i++) {
            const ox = ((i % 3) - 1) * 0.22;
            const oz = (Math.floor(i / 3) - 1) * 0.22;
            parkFlower(cx + ox, cz + oz, i + clusterIndex);
          }
        });

        const sprayMat = new THREE.MeshLambertMaterial({ color: ghost ? 0xcfd8e3 : 0x90caf9, transparent: true, opacity: ghost ? 0.35 : 0.75, depthWrite: !ghost });
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const r = 0.1 + (i % 4) * 0.06;
          const h = 0.52 + (i % 5) * 0.055;
          const drop = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 4), sprayMat);
          drop.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
          parkGroup.add(drop);
        }

        const skinColors = [0xffcc99, 0xc68642, 0xf1c27d, 0x8d5524, 0xffe0bd];
        const shirtColors = [0xef5350, 0x42a5f5, 0xffca28, 0x66bb6a, 0xab47bc, 0xff7043, 0x26c6da, 0xec407a];
        const pantsColors = [0x1565c0, 0x37474f, 0x4e342e, 0x1b5e20, 0x263238];
        function person(x, z, ry, i, path) {
          const g = new THREE.Group();
          const sc = 0.052;
          const skin = skinColors[i % skinColors.length];
          const shirt = shirtColors[i % shirtColors.length];
          const pants = pantsColors[i % pantsColors.length];
          for (const s of [-1, 1]) {
            const leg = box2(sc * 1.8, sc * 4, sc * 1.8, pants);
            leg.position.set(s * sc, sc * 2.2, 0);
            g.add(leg);
          }
          const body = box2(sc * 4, sc * 4.5, sc * 2.2, shirt);
          body.position.y = sc * 6.8; g.add(body);
          const head = box2(sc * 3.2, sc * 3.2, sc * 3.2, skin);
          head.position.y = sc * 10.5; g.add(head);
          for (const s of [-1, 1]) {
            const arm = box2(sc * 1.6, sc * 3.8, sc * 1.6, shirt);
            arm.position.set(s * sc * 3.2, sc * 6.5, 0);
            g.add(arm);
          }
          g.position.set(x, 0.04, z);
          g.rotation.y = ry;
          g.userData.isParkPerson = true;
          g.userData.path = path;
          g.userData.phase = i * 0.7;
          parkGroup.add(g);
        }
        [
          [-1.8, 0.05, Math.PI / 2, { type: 'line', x1: -5.2, z1: 0.05, x2: 5.2, z2: 0.05, speed: 0.05, t: 0.12 }],
          [1.8, -0.05, -Math.PI / 2, { type: 'line', x1: 5.2, z1: -0.05, x2: -5.2, z2: -0.05, speed: 0.045, t: 0.32 }],
          [0.05, -2.4, 0, { type: 'line', x1: 0.05, z1: -5.2, x2: 0.05, z2: 5.2, speed: 0.048, t: 0.58 }],
          [-0.05, 2.4, Math.PI, { type: 'line', x1: -0.05, z1: 5.2, x2: -0.05, z2: -5.2, speed: 0.042, t: 0.76 }],
          [-2.5, -2.5, 0.6, { type: 'oval', cx: -2.5, cz: -2.5, rx: 1.15, rz: 0.9, speed: 0.52 }],
          [2.5, 2.5, -2.4, { type: 'oval', cx: 2.5, cz: 2.5, rx: 1.05, rz: 1.1, speed: 0.58 }],
          [-2.5, 2.5, 2.3, { type: 'oval', cx: -2.5, cz: 2.5, rx: 1.0, rz: 1.15, speed: 0.48 }],
          [2.5, -2.5, -0.7, { type: 'oval', cx: 2.5, cz: -2.5, rx: 1.15, rz: 0.95, speed: 0.62 }],
        ].forEach(([x, z, ry, path], i) => person(x, z, ry, i, path));

        const parkScale = (cs * 1.18) / 12;
        parkGroup.scale.set(parkScale, parkScale, parkScale);
        parkGroup.position.y = cs * 0.015;
        meshes.push(parkGroup);
        break;
      }
      default: {
        const defMesh = new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.8, cs * 0.8, baseSize * 0.8), getMat(0x95a5a6));
        defMesh.position.y = cs * 0.4;
        meshes.push(defMesh);
        break;
      }
    }

    // Facade dressing (trim bands, corner pilasters) - but not for decorative items and roads
    if (!['road', 'factory', 'treeA', 'treeB', 'flowerGarden', 'park', 'tower', 'shop', 'apartment', 'clockTower', 'hospital', 'skyscraper', 'library'].includes(type)) {
      meshes.push(this._makeTrimMesh(baseSize * 0.92, cs * 0.05, baseSize * 0.92, 0, bodyH * 0.48, 0, 0x708090, ghost));
      meshes.push(this._makeTrimMesh(baseSize * 0.92, cs * 0.05, baseSize * 0.92, 0, bodyH * 0.72, 0, 0x8a96a6, ghost));
      meshes.push(this._makeTrimMesh(cs * 0.06, bodyH * 0.86, cs * 0.05, baseSize * 0.39, bodyH * 0.52, baseSize * 0.39, 0x8591a3, ghost));
      meshes.push(this._makeTrimMesh(cs * 0.06, bodyH * 0.86, cs * 0.05, -baseSize * 0.39, bodyH * 0.52, baseSize * 0.39, 0x8591a3, ghost));
      meshes.push(this._makeTrimMesh(cs * 0.06, bodyH * 0.86, cs * 0.05, baseSize * 0.39, bodyH * 0.52, -baseSize * 0.39, 0x8591a3, ghost));
      meshes.push(this._makeTrimMesh(cs * 0.06, bodyH * 0.86, cs * 0.05, -baseSize * 0.39, bodyH * 0.52, -baseSize * 0.39, 0x8591a3, ghost));
    }
    if (['house1', 'house2', 'bakery'].includes(type)) {
      meshes.push(this._makeTrimMesh(baseSize * 0.5, cs * 0.08, baseSize * 0.28, 0, cs * 0.11, baseSize * 0.34, 0x63463a, ghost));
      meshes.push(this._makeCylinderDetail(cs * 0.08, cs * 0.09, cs * 0.28, 8, -baseSize * 0.18, cs * 0.86, -baseSize * 0.12, 0x8a6a52, ghost));
    }
    meshes.forEach(m => {
      if (m) { m.castShadow = !ghost; m.receiveShadow = !ghost; group.add(m); }
    });

    return group;
  }

  _prepareAssetModel(model, ghost, type) {
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (ghost && child.material) {
        const clone = (m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.55; return c; };
        child.material = Array.isArray(child.material) ? child.material.map(clone) : clone(child.material);
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const footprint = this.cellSize * 0.86, maxHeight = this.cellSize * 1.45;
    const scale = Math.min(size.x ? footprint / size.x : 1, size.z ? footprint / size.z : 1, size.y ? maxHeight / size.y : 1);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(model);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    model.position.x -= scaledCenter.x;
    model.position.z -= scaledCenter.z;
    model.position.y -= scaledBox.min.y;
  }

  _isRoadCell(row, col) {
    if (row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) return false;
    const m = this.grid[row][col];
    return !!(m && m.userData && m.userData.type === 'road');
  }

  _snapRoadRotation(angle = 0) {
    const quarterTurn = Math.PI / 2;
    return Math.round(angle / quarterTurn) * quarterTurn;
  }

  _getRoadConnections(row, col) {
    return {
      N: this._isRoadCell(row - 1, col),
      S: this._isRoadCell(row + 1, col),
      E: this._isRoadCell(row, col + 1),
      W: this._isRoadCell(row, col - 1),
    };
  }

  _getRoadRenderConnections(row, col, mesh) {
    const connections = this._getRoadConnections(row, col);
    const count = Object.values(connections).filter(Boolean).length;
    if (count >= 2) return connections;

    if (count === 1) {
      if (connections.N || connections.S) return { ...connections, N: true, S: true };
      return { ...connections, E: true, W: true };
    }

    const preferredRotation = this._snapRoadRotation(mesh?.userData?.roadRotation ?? mesh?.rotation?.y ?? 0);
    const horizontal = Math.abs(Math.sin(preferredRotation)) > 0.5;
    return horizontal
      ? { N: false, S: false, E: true, W: true }
      : { N: true, S: true, E: false, W: false };
  }

  _refreshRoadTile(row, col) {
    if (!this._isRoadCell(row, col)) return;
    const mesh = this.grid[row][col];
    const roadConnections = this._getRoadRenderConnections(row, col, mesh);
    mesh.rotation.y = 0;

    const previousProcedural = mesh.userData?.proceduralRoot;
    if (previousProcedural) mesh.remove(previousProcedural);

    const procedural = this._buildProceduralFallback('road', false, {
      roadConnections,
      roadRotation: mesh.userData?.roadRotation ?? 0,
    });
    mesh.userData.proceduralRoot = procedural;
    mesh.add(procedural);
  }

  _refreshRoadNetworkAround(row, col) {
    for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      this._refreshRoadTile(row + dr, col + dc);
    }
    this._markRoadPathDirty();
  }

  _buildRoadProcedural({ ghost, connections = null, roadRotation = 0 }) {
    const group = new THREE.Group();
    const cs = this.cellSize;
    const baseSize = cs * 0.85;
    const slabInset = cs * 0.05;
    const slabSize = baseSize + slabInset;
    const roadWidth = baseSize * 0.5;
    const centerPad = roadWidth;
    const armLength = (baseSize - centerPad) / 2;
    const roadHeight = cs * 0.035;
    const roadY = cs * 0.018;
    const curbHeight = cs * 0.03;
    const curbY = curbHeight / 2;
    const quarterTurn = Math.PI / 2;

    const active = connections || (() => {
      const horizontal = Math.abs(Math.sin(this._snapRoadRotation(roadRotation))) > 0.5;
      return horizontal
        ? { N: false, S: false, E: true, W: true }
        : { N: true, S: true, E: false, W: false };
    })();

    const makeMat = (color, roughness = 0.55, metalness = 0.06) => new THREE.MeshStandardMaterial({
      color: ghost ? 0xcfd8e3 : color,
      roughness,
      metalness,
      transparent: !!ghost,
      opacity: ghost ? 0.35 : 1,
      depthWrite: !ghost,
    });
    const plazaMat = makeMat(0xd9dde2, 0.9, 0.02);
    const curbMat = makeMat(0xb4bcc6, 0.82, 0.04);
    const asphaltMat = this._getThemeMaterial('asphalt', ghost);
    const laneDashMat = makeMat(0xf9f9f2, 0.5, 0.0);
    const laneEdgeMat = makeMat(0xf3dc78, 0.45, 0.0);
    const poleMat = makeMat(0xe6ebf2, 0.5, 0.35);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff6cf,
      emissive: 0xffefb0,
      emissiveIntensity: ghost ? 0 : 2.2,
      transparent: !!ghost,
      opacity: ghost ? 0.35 : 1,
    });

    const addBox = (w, h, d, x, y, z, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    const addCenterDash = (x, z, w, d, rotY = 0) => {
      const dash = addBox(w, cs * 0.012, d, x, roadY + cs * 0.03, z, laneDashMat);
      dash.rotation.y = rotY;
    };
    const addLaneEdges = (dir) => {
      const edgeOffset = roadWidth * 0.32;
      const edgeThickness = cs * 0.05;
      const lineHeight = cs * 0.01;
      const lineLength = armLength + centerPad * 0.5 - cs * 0.06;
      if (dir === 'N') {
        addBox(edgeThickness, lineHeight, lineLength, -edgeOffset, roadY + cs * 0.028, -(centerPad * 0.25 + armLength * 0.5), laneEdgeMat);
        addBox(edgeThickness, lineHeight, lineLength, edgeOffset, roadY + cs * 0.028, -(centerPad * 0.25 + armLength * 0.5), laneEdgeMat);
        addCenterDash(0, -(centerPad * 0.5 + armLength * 0.42), cs * 0.05, cs * 0.24);
      } else if (dir === 'S') {
        addBox(edgeThickness, lineHeight, lineLength, -edgeOffset, roadY + cs * 0.028, centerPad * 0.25 + armLength * 0.5, laneEdgeMat);
        addBox(edgeThickness, lineHeight, lineLength, edgeOffset, roadY + cs * 0.028, centerPad * 0.25 + armLength * 0.5, laneEdgeMat);
        addCenterDash(0, centerPad * 0.5 + armLength * 0.42, cs * 0.05, cs * 0.24);
      } else if (dir === 'E') {
        addBox(lineLength, lineHeight, edgeThickness, centerPad * 0.25 + armLength * 0.5, roadY + cs * 0.028, -edgeOffset, laneEdgeMat);
        addBox(lineLength, lineHeight, edgeThickness, centerPad * 0.25 + armLength * 0.5, roadY + cs * 0.028, edgeOffset, laneEdgeMat);
        addCenterDash(centerPad * 0.5 + armLength * 0.42, 0, cs * 0.24, cs * 0.05);
      } else if (dir === 'W') {
        addBox(lineLength, lineHeight, edgeThickness, -(centerPad * 0.25 + armLength * 0.5), roadY + cs * 0.028, -edgeOffset, laneEdgeMat);
        addBox(lineLength, lineHeight, edgeThickness, -(centerPad * 0.25 + armLength * 0.5), roadY + cs * 0.028, edgeOffset, laneEdgeMat);
        addCenterDash(-(centerPad * 0.5 + armLength * 0.42), 0, cs * 0.24, cs * 0.05);
      }
    };
    const addStreetLight = (corner) => {
      const offset = slabSize * 0.34;
      const x = corner.includes('E') ? offset : -offset;
      const z = corner.includes('S') ? offset : -offset;
      const facingX = corner.includes('E') ? -1 : 1;
      const facingZ = corner.includes('S') ? -1 : 1;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.022, cs * 0.028, cs * 0.82, 10), poleMat);
      pole.position.set(x, cs * 0.42, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.16, cs * 0.022, cs * 0.022), poleMat);
      arm.position.set(x + facingX * cs * 0.07, cs * 0.81, z + facingZ * cs * 0.03);
      arm.rotation.y = Math.atan2(facingX, facingZ);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.05, 10, 10), bulbMat);
      bulb.position.set(x + facingX * cs * 0.14, cs * 0.79, z + facingZ * cs * 0.06);

      group.add(pole, arm, bulb);
      if (!ghost) {
        const light = new THREE.PointLight(0xfff4c1, 0.45, cs * 2.4);
        light.position.copy(bulb.position);
        group.add(light);
      }
    };
    addBox(slabSize, cs * 0.02, slabSize, 0, cs * 0.01, 0, plazaMat);
    addBox(slabSize, curbHeight, cs * 0.025, 0, curbY, slabSize * 0.5, curbMat);
    addBox(slabSize, curbHeight, cs * 0.025, 0, curbY, -slabSize * 0.5, curbMat);
    addBox(cs * 0.025, curbHeight, slabSize, slabSize * 0.5, curbY, 0, curbMat);
    addBox(cs * 0.025, curbHeight, slabSize, -slabSize * 0.5, curbY, 0, curbMat);

    addBox(centerPad, roadHeight, centerPad, 0, roadY, 0, asphaltMat);
    if (active.N) addBox(roadWidth, roadHeight, armLength + cs * 0.02, 0, roadY, -(centerPad + armLength) * 0.5, asphaltMat);
    if (active.S) addBox(roadWidth, roadHeight, armLength + cs * 0.02, 0, roadY, (centerPad + armLength) * 0.5, asphaltMat);
    if (active.E) addBox(armLength + cs * 0.02, roadHeight, roadWidth, (centerPad + armLength) * 0.5, roadY, 0, asphaltMat);
    if (active.W) addBox(armLength + cs * 0.02, roadHeight, roadWidth, -(centerPad + armLength) * 0.5, roadY, 0, asphaltMat);

    for (const dir of ['N', 'S', 'E', 'W']) {
      if (active[dir]) addLaneEdges(dir);
    }

    const corners = [
      { key: 'NW', allowed: !active.N && !active.W },
      { key: 'NE', allowed: !active.N && !active.E },
      { key: 'SE', allowed: !active.S && !active.E },
      { key: 'SW', allowed: !active.S && !active.W },
    ];
    const selectedCorners = corners.filter(c => c.allowed).slice(0, 2);
    const fallbackCorners = selectedCorners.length ? selectedCorners : [{ key: 'NW' }, { key: 'SE' }];
    for (const corner of fallbackCorners) addStreetLight(corner.key);

    if ((active.N && active.S) || (active.E && active.W)) {
      addCenterDash(0, 0, cs * 0.05, cs * 0.22, 0);
    } else {
      addCenterDash(0, 0, cs * 0.16, cs * 0.16, quarterTurn * 0.125);
    }

    return group;
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────

  _updateUI() {
    if (this.levelTextEl) this.levelTextEl.textContent = `Level ${this.level}`;
    const filled = this._countFilledCells(), target = this._getLevelProgressTarget();
    if (this.progressTextEl) this.progressTextEl.textContent = `${filled}/${target}`;
    if (this.happyPointsTextEl) this.happyPointsTextEl.textContent = `${this.happinessPoints}`;
    if (this.happyTextEl) this.happyTextEl.textContent = `${Math.round(this.happiness * 100)}%`;

    document.querySelectorAll('[data-stock-for]').forEach((stockEl) => {
      const type = stockEl.getAttribute('data-stock-for');
      if (!type) return;
      stockEl.textContent = `${this._getRemainingStock(type)} left`;
    });

    for (let lvl = 1; lvl <= this.maxLevel; lvl++) {
      const group = document.getElementById(`lvl${lvl}Group`);
      if (!group) continue;
      group.style.display = 'flex';
      group.querySelectorAll('.build-btn').forEach(btn => {
        const buildType = Object.entries(this.ui).find(([, el]) => el === btn)?.[0];
        const typeMap = {
          buyHouse1: 'house1', buyFactory: 'factory', buyTower: 'tower', buyShop: 'shop',
          buyHouse2: 'house2', buyApartment: 'apartment', buyClockTower: 'clockTower',
          buySkyscraper: 'skyscraper', buyHospital: 'hospital', buyFireStation: 'fireStation',
          buySchool: 'school', buyLibrary: 'library', buyBakery: 'bakery'
        };
        const type = typeMap[buildType];
        const outOfStock = type ? !this._canPlaceType(type) : false;
        const overlayText = lvl > this.level ? `🔒 Lvl ${lvl}` : (outOfStock ? 'Full' : null);

        if (lvl > this.level || outOfStock) {
          btn.disabled = true; btn.classList.add('locked');
          const lock = btn.querySelector('.lock-overlay') || document.createElement('span');
          lock.className = 'lock-overlay';
          lock.textContent = overlayText;
          if (!lock.parentElement) btn.appendChild(lock);
        } else {
          btn.disabled = false; btn.classList.remove('locked');
          const lock = btn.querySelector('.lock-overlay'); if (lock) lock.remove();
        }
      });
    }

    const miscButtons = {
      buyTreeA: 'treeA',
      buyTreeB: 'treeB',
      buyFlowerGarden: 'flowerGarden',
      buyPark: 'park'
    };
    for (const [id, type] of Object.entries(miscButtons)) {
      const btn = this.ui[id];
      if (!btn) continue;
      const outOfStock = !this._canPlaceType(type);
      btn.disabled = outOfStock;
      btn.classList.toggle('locked', outOfStock);
      const existing = btn.querySelector('.lock-overlay');
      if (outOfStock) {
        const lock = existing || document.createElement('span');
        lock.className = 'lock-overlay';
        lock.textContent = 'Full';
        if (!lock.parentElement) btn.appendChild(lock);
      } else if (existing) {
        existing.remove();
      }
    }
  }

  _recomputeCityStats() {
    let pop = 0, happinessSum = 0, housesCount = 0;
    const hasNeighborType = (row, col, types, dist = 1) => {
      for (let dr = -dist; dr <= dist; dr++) for (let dc = -dist; dc <= dist; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= this.gridSize || nc >= this.gridSize) continue;
        const m = this.grid[nr][nc];
        if (m && m.userData && types.includes(m.userData.type)) return true;
      }
      return false;
    };
    const countNeighborType = (row, col, type, maxDist = 2) => {
      let count = 0;
      for (let dr = -maxDist; dr <= maxDist; dr++) for (let dc = -maxDist; dc <= maxDist; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (dr * dr + dc * dc > maxDist * maxDist) continue;
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= this.gridSize || nc >= this.gridSize) continue;
        const m = this.grid[nr][nc];
        if (m && m.userData && m.userData.type === type) count++;
      }
      return count;
    };
    for (let r = 0; r < this.gridSize; r++) for (let c = 0; c < this.gridSize; c++) {
      const m = this.grid[r][c];
      if (!m || !m.userData || m.userData.type !== 'house1' && m.userData.type !== 'house2') continue;
      housesCount++;
      const nearRoad = hasNeighborType(r, c, ['road'], 1);
      const factories = countNeighborType(r, c, 'factory', 2);
      const parks = countNeighborType(r, c, 'park', 2);
      pop += Math.round(5 * (nearRoad ? 1.0 : 0.5));
      let h = 1.0;
      for (let i = 0; i < factories; i++) h *= 0.85;
      for (let i = 0; i < parks; i++) h *= 1.10;
      happinessSum += Math.max(0.2, Math.min(1.2, h));
      if (!nearRoad) this._toastAtCell(r, c, 'House needs roads');
    }
    this.population = pop;
    this.happiness = Math.max(0, Math.min(1, housesCount ? happinessSum / housesCount : 1.0));
    this._checkLevelProgression();
    this._updateUI();
  }

  _toastAtCell(row, col, msg) {
    const status = document.getElementById('status'); if (!status) return;
    status.textContent = msg; status.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { status.style.display = 'none'; }, 1400);
  }

  _expandGridByOneRing() {
    const oldSize = this.gridSize;
    const newSize = this._getLevelGridSize(this.level);
    if (newSize <= oldSize) return;
    const newGrid = Array.from({ length: newSize }, () => Array(newSize).fill(null));
    const offset = Math.floor((newSize - oldSize) / 2);
    this.gridOriginX -= offset * this.cellSize;
    this.gridOriginZ -= offset * this.cellSize;

    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      const mesh = p.mesh || p.sprite;
      this.scene.remove(mesh);
      mesh.geometry?.dispose?.();
      if (mesh.material?.map) mesh.material.map.dispose();
      mesh.material?.dispose?.();
      this.smokePuffs.splice(i, 1);
    }

    const parksToRespawn = [];
    for (let r = 0; r < oldSize; r++) for (let c = 0; c < oldSize; c++) {
      const mesh = this.grid[r][c];
      if (!mesh) continue;
      const row = r + offset;
      const col = c + offset;
      const pos = this._gridToWorld(col, row);
      mesh.position.set(pos.x, mesh.position.y, pos.z);
      mesh.userData.grid = { row, col };
      newGrid[row][col] = mesh;
      if (!mesh.parent) this.scene.add(mesh);
      if (mesh.userData.type === 'park') { this._removePeopleForPark(mesh); parksToRespawn.push({ mesh, row, col }); }
    }
    this.grid = newGrid;
    this.gridSize = newSize;
    this._rebuildGroundAndGrid();
    for (const p of parksToRespawn) this._spawnPeopleForPark(p.mesh, p.row, p.col);
    this._applyLevelView(true);
    this._recomputeCityStats();
    this._markRoadPathDirty();
  }

  _rebuildGroundAndGrid() {
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper.geometry.dispose(); this.gridHelper.material.dispose(); this.gridHelper = null; }
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.dispose(); this.ground = null; }

    const planeSize = this.gridSize * this.cellSize;
    const center = this._getGridCenterWorld();
    const gridColors = this._getGridHelperColors();

    const groundMat = new THREE.MeshStandardMaterial({ color: 0xaeb4bb, roughness: 0.95, metalness: 0.02 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, 0, center.z);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const gridHelper = new THREE.GridHelper(planeSize, this.gridSize, gridColors.major, gridColors.minor);
    gridHelper.position.set(center.x, 0.01, center.z);
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }

  // ─────────────────────────────────────────────
  // Live Building Details & Animation
  // ─────────────────────────────────────────────

  _addLiveBuildingDetails(root, type) {
    const animatedTypes = new Set(['house1', 'house2', 'skyscraper', 'fireStation', 'school', 'library', 'bakery', 'factory', 'treeA', 'treeB', 'park', 'flowerGarden', 'road']);
    if (!animatedTypes.has(type)) return;

    const cs = this.cellSize;
    const base = cs * 0.85;
    const proceduralChild = root.children[0] || root;

    const entry = {
      root, type,
      phase: Math.random() * Math.PI * 2,
      windows: [], rotors: [], pulsers: [], swayers: [], clockHands: [],
      smokeTimer: Math.random() * 0.8,
      sirenMesh: null, flagMesh: null,
      parkAnimData: null,
    };

    root.traverse(child => {
      if (child.userData.isSiren) entry.sirenMesh = child;
      if (child.userData.isFlag) entry.flagMesh = child;
      if (child.userData.isSkyscraperPulse) entry.pulsers.push(child);
      if (child.userData.isSkyscraperRotor) entry.rotors.push(child);
      if (type === 'park' && child.userData.isParkPerson) {
        if (!entry.parkAnimData) entry.parkAnimData = { people: [] };
        entry.parkAnimData.people.push(child);
      }
    });

    const addWindow = (x, y, z, w = cs * 0.18, h = cs * 0.16) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xfff2a8, emissive: 0xffcc55, emissiveIntensity: 0.25 + Math.random() * 0.35, roughness: 0.28, metalness: 0.1,
      });
      const win = new THREE.Mesh(new THREE.BoxGeometry(w, h, cs * 0.025), mat);
      win.position.set(x, y, z);
      win.userData.baseIntensity = mat.emissiveIntensity;
      proceduralChild.add(win);
      entry.windows.push(win);
      return win;
    };

    const windowRowsByType = {
      house1: 1, house2: 1, shop: 2, factory: 1, bakery: 1, school: 2,
      library: 2, hospital: 2, fireStation: 1, tower: 3, apartment: 4,
      clockTower: 2,
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

    if (['hospital', 'shop', 'bakery'].includes(type)) {
      const color = type === 'hospital' ? 0x49b8ff : 0xffdd55;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(cs * 0.09, 12, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.2 }));
      beacon.position.set(base * 0.34, cs * 1.03, base * 0.34);
      proceduralChild.add(beacon);
      entry.pulsers.push(beacon);
    }

    if (type === 'clockTower') {
      const handMat = new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.4 });
      const minute = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.035, cs * 0.34, cs * 0.035), handMat);
      const hour = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.045, cs * 0.23, cs * 0.035), handMat);
      minute.position.set(0, cs * 1.72, base * 0.295);
      hour.position.set(0, cs * 1.72, base * 0.305);
      proceduralChild.add(minute, hour);
      entry.clockHands.push({ minute, hour });
    }

    if (['treeA', 'treeB', 'flowerGarden'].includes(type)) entry.swayers.push(root);

    this.liveBuildingParts.push(entry);
  }

  _updateLiveBuildings(dt, elapsed) {
    for (const entry of this.liveBuildingParts) {
      if (!entry.root.parent) continue;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + entry.phase);

      for (let i = 0; i < entry.windows.length; i++) {
        const win = entry.windows[i];
        if (!win.material) continue;
        win.material.emissiveIntensity = win.userData.baseIntensity * (0.55 + 0.45 * Math.sin(elapsed * (1.3 + i * 0.07) + entry.phase + i));
      }
      for (const rotor of entry.rotors) {
        if (rotor.userData.isSkyscraperRotor) rotor.rotation.z += dt * 0.8;
        else rotor.rotation.z += dt * 6.5;
      }
      for (const pulser of entry.pulsers) { pulser.material.emissiveIntensity = 0.4 + pulse * 1.6; pulser.scale.setScalar(0.85 + pulse * 0.3); }
      for (const hands of entry.clockHands) { hands.minute.rotation.z -= dt * 1.8; hands.hour.rotation.z -= dt * 0.16; }
      for (const swayer of entry.swayers) { swayer.rotation.x = Math.sin(elapsed * 1.8 + entry.phase) * 0.025; swayer.rotation.z = Math.cos(elapsed * 1.4 + entry.phase) * 0.025; }
      if (entry.parkAnimData?.people?.length) {
        for (const person of entry.parkAnimData.people) {
          const path = person.userData.path;
          if (!path) continue;
          let x = person.position.x, z = person.position.z, nx = x, nz = z;
          if (path.type === 'oval') {
            const a = elapsed * path.speed + person.userData.phase;
            x = path.cx + Math.cos(a) * path.rx;
            z = path.cz + Math.sin(a) * path.rz;
            nx = path.cx + Math.cos(a + 0.03) * path.rx;
            nz = path.cz + Math.sin(a + 0.03) * path.rz;
          } else {
            path.t = (path.t + dt * path.speed) % 1;
            const nt = (path.t + 0.02) % 1;
            x = path.x1 + (path.x2 - path.x1) * path.t;
            z = path.z1 + (path.z2 - path.z1) * path.t;
            nx = path.x1 + (path.x2 - path.x1) * nt;
            nz = path.z1 + (path.z2 - path.z1) * nt;
          }
          person.position.set(x, 0.04 + Math.abs(Math.sin(elapsed * 6 + person.userData.phase)) * 0.025, z);
          const dx = nx - x, dz = nz - z;
          if (Math.abs(dx) + Math.abs(dz) > 0.00001) person.rotation.y = Math.atan2(dx, dz);
          const swing = Math.sin(elapsed * 6 + person.userData.phase) * 0.28;
          person.children.forEach((part) => {
            if (part.position.x < 0 && part.position.y < 0.25) part.rotation.x = swing;
            if (part.position.x > 0 && part.position.y < 0.25) part.rotation.x = -swing;
            if (part.position.x < 0 && part.position.y > 0.25 && part.position.y < 0.45) part.rotation.x = -swing * 0.5;
            if (part.position.x > 0 && part.position.y > 0.25 && part.position.y < 0.45) part.rotation.x = swing * 0.5;
          });
        }
      }

      if (entry.type === 'fireStation' && entry.sirenMesh) {
        entry.sirenMesh.material.emissiveIntensity = 0.4 + pulse * 2.2;
        entry.sirenMesh.material.emissive.setHSL(0.0, 1, 0.35 + pulse * 0.15);
      }

      if (entry.flagMesh) {
        entry.flagMesh.rotation.z = Math.sin(elapsed * 3.2 + entry.phase) * 0.12;
        entry.flagMesh.rotation.y = Math.sin(elapsed * 2.0 + entry.phase * 0.5) * 0.06;
      }

      if (entry.type === 'shop') {
        for (const w of entry.windows) {
          if (w.material) w.material.emissiveIntensity = 0.18 + 0.08 * Math.sin(elapsed * 0.9 + entry.phase);
        }
      }

      if (entry.type === 'factory') {
        entry.smokeTimer -= dt;
        if (entry.smokeTimer <= 0) {
          const chimneyX = (Math.random() < 0.5 ? -1 : 1) * this.cellSize * 0.1;
          const world = entry.root.localToWorld(new THREE.Vector3(chimneyX, this.cellSize * 1.5, -this.cellSize * 0.07));
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
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 1, depthWrite: false });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(this.cellSize * 0.09, 10, 10), mat);
    puff.position.copy(position);
    puff.castShadow = false;
    this.scene.add(puff);
    this.smokePuffs.push({ mesh: puff, life: 1, driftX: (Math.random() - 0.5) * this.cellSize * 0.18, driftZ: (Math.random() - 0.5) * this.cellSize * 0.18 });
  }

  _updateSmoke(dt) {
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      const mesh = p.mesh || p.sprite;
      p.life -= dt * 0.55;
      if (p.life <= 0) {
        this.scene.remove(mesh); mesh.geometry?.dispose?.();
        if (mesh.material?.map) mesh.material.map.dispose();
        mesh.material?.dispose?.(); this.smokePuffs.splice(i, 1); continue;
      }
      mesh.position.y += dt * this.cellSize * 0.35;
      mesh.position.x += p.driftX * dt;
      mesh.position.z += p.driftZ * dt;
      mesh.scale.setScalar(1 + (1 - p.life) * 2.2);
      if (mesh.material) mesh.material.opacity = Math.max(0, p.life * 0.36);
    }
  }

  // ─────────────────────────────────────────────
  // ENHANCED CAR SYSTEM WITH COLLISION AVOIDANCE
  // ─────────────────────────────────────────────

  _spawnCarOnPath() {
    if (!this._roadPathCurve) return;
    const g = this._buildCarMesh();
    const t0 = Math.random();
    const pos = this._roadPathCurve.getPointAt(t0);
    g.position.copy(pos);
    this.scene.add(g);
    this.cars.push({ 
      mesh: g, 
      pathT: t0, 
      speed: 0.018 + Math.random() * 0.014, 
      isPathCar: true,
      targetSpeed: null
    });
  }

  _buildCarMesh(color = null) {
    const cs = this.cellSize;
    const carColor = color ?? [0x3b89ff, 0xe74c3c, 0x2ecc71, 0xf39c12, 0x9b59b6][Math.floor(Math.random() * 5)];
    const body = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.32, cs * 0.18, cs * 0.52), new THREE.MeshStandardMaterial({ color: carColor, metalness: 0.4, roughness: 0.4 }));
    body.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.28, cs * 0.1, cs * 0.26), new THREE.MeshStandardMaterial({ color: 0xaad0ff, roughness: 0.1, metalness: 0.9 }));
    roof.position.y = cs * 0.14;
    body.add(roof);
    for (const [wx, wz] of [[-cs * 0.14, cs * 0.18], [cs * 0.14, cs * 0.18], [-cs * 0.14, -cs * 0.18], [cs * 0.14, -cs * 0.18]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.055, cs * 0.055, cs * 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      w.rotation.z = Math.PI / 2; w.position.set(wx, -cs * 0.07, wz); body.add(w);
    }
    const g = new THREE.Group();
    body.position.y = cs * 0.05 + cs * 0.09;
    g.add(body);
    return g;
  }

  _findRandomRoadStart() {
    const candidates = [];
    for (let r = 0; r < this.gridSize; r++) for (let c = 0; c < this.gridSize; c++) {
      if (!this._isRoadCell(r, c)) continue;
      const opts = this._roadNeighborDirs(r, c);
      if (opts.length) candidates.push({ r, c, opts });
    }
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const dir = pick.opts[Math.floor(Math.random() * pick.opts.length)];
    return { row: pick.r, col: pick.c, dir };
  }

  _roadNeighborDirs(row, col) {
    const dirs = [];
    if (this._isRoadCell(row - 1, col)) dirs.push('N');
    if (this._isRoadCell(row + 1, col)) dirs.push('S');
    if (this._isRoadCell(row, col + 1)) dirs.push('E');
    if (this._isRoadCell(row, col - 1)) dirs.push('W');
    return dirs;
  }

  _spawnCar(row, col, dir) {
    const g = this._buildCarMesh();
    const center = this._gridToWorld(col, row);
    const laneOffset = this.cellSize * 0.18;
    const vdir = this._dirVec(dir);
    const perp = { x: -vdir.z, z: vdir.x };
    g.position.set(center.x + perp.x * laneOffset, 0, center.z + perp.z * laneOffset);
    g.rotation.y = this._yawForDir(dir);
    this.scene.add(g);
    this.cars.push({ 
      mesh: g, 
      row, col, dir, 
      t: 0, 
      speed: this.cellSize * (0.55 + Math.random() * 0.35), 
      laneOffset, 
      laneSign: 1, 
      isPathCar: false,
      targetSpeed: null
    });
  }

  _yawForDir(dir) { return dir === 'N' ? Math.PI : dir === 'S' ? 0 : dir === 'E' ? -Math.PI / 2 : Math.PI / 2; }

  _updateCars(dt) {
    // Update path-based cars first
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];

      if (c.isPathCar) {
        if (!this._roadPathCurve) { 
          this.scene.remove(c.mesh); 
          this.cars.splice(i, 1); 
          continue; 
        }

        c.pathT += c.speed * dt;
        if (c.pathT > 1) {
          this.scene.remove(c.mesh);
          this.cars.splice(i, 1);
          continue;
        }

        const pos = this._roadPathCurve.getPointAt(c.pathT);
        const tangent = this._roadPathCurve.getTangentAt(c.pathT);
        c.mesh.position.copy(pos);
        const lookTarget = pos.clone().add(tangent);
        c.mesh.lookAt(lookTarget);
      }
    }

    // Update grid-based cars with collision avoidance
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.isPathCar) continue;

      const v = this._dirVec(c.dir);
      
      // Check for cars ahead
      let carAhead = false;
      let checkRow = c.row + v.gr;
      let checkCol = c.col + v.gc;
      
      if (this._isRoadCell(checkRow, checkCol)) {
        for (const other of this.cars) {
          if (other === c || other.isPathCar) continue;
          if (other.row === checkRow && other.col === checkCol) {
            carAhead = true;
            break;
          }
        }
      }

      // Adjust speed based on collision avoidance
      if (carAhead) {
        c.speed *= 0.7; // Slow down
        if (c.speed < this.cellSize * 0.05) c.speed = 0; // Stop if too slow
      } else {
        c.speed = Math.min(c.speed + dt * this.cellSize * 0.1, this.cellSize * 0.9); // Accelerate back to normal
      }

      c.t += (c.speed * dt) / this.cellSize;
      const start = this._gridToWorld(c.col, c.row);
      const perp = { x: -v.z, z: v.x };
      c.mesh.position.x = start.x + v.x * this.cellSize * c.t + perp.x * c.laneSign * c.laneOffset;
      c.mesh.position.z = start.z + v.z * this.cellSize * c.t + perp.z * c.laneSign * c.laneOffset;

      if (c.t >= 1) {
        const nextRow = c.row + v.gr, nextCol = c.col + v.gc;
        if (!this._isRoadCell(nextRow, nextCol)) {
          const choices = this._roadNeighborDirs(c.row, c.col).filter(d => d !== this._oppositeDir(c.dir));
          if (choices.length) {
            c.dir = choices[Math.floor(Math.random() * choices.length)];
            c.mesh.rotation.y = this._yawForDir(c.dir);
          } else {
            // No valid direction, despawn
            this.scene.remove(c.mesh);
            this.cars.splice(i, 1);
            continue;
          }
        } else {
          c.row = nextRow;
          c.col = nextCol;
        }
        c.t = 0;
      }

      if (c.row < 0 || c.col < 0 || c.row >= this.gridSize || c.col >= this.gridSize) {
        this.scene.remove(c.mesh);
        this.cars.splice(i, 1);
      }
    }
  }

  _oppositeDir(d) { return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'E' ? 'W' : 'E'; }
  _dirVec(d) {
    switch (d) {
      case 'N': return { x: 0, z: -1, gr: -1, gc: 0 };
      case 'S': return { x: 0, z: 1, gr: 1, gc: 0 };
      case 'E': return { x: 1, z: 0, gr: 0, gc: 1 };
      case 'W': return { x: -1, z: 0, gr: 0, gc: -1 };
    }
    return { x: 0, z: 0, gr: 0, gc: 0 };
  }

  // ─────────────────────────────────────────────
  // People / Visitors stubs
  // ─────────────────────────────────────────────

  _spawnPeopleForPark(parkMesh, row, col) {}
  _removePeopleForPark(parkMesh) {}
  _updatePeople(dt) {}
  _spawnVisitorsForBuilding(mesh, row, col) {}
  _removeVisitorsForBuilding(mesh) {}
  _updateVisitors(dt) {}

  // ─────────────────────────────────────────────
  // Main Animation Loop
  // ─────────────────────────────────────────────

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    const t = performance.now() * 0.001;
    const dt = Math.min(0.05, Math.max(0.001, t - this._lastTime));
    this._lastTime = t;
    const sdt = dt * (this.timeScale || 0);

    // Rebuild road path if dirty
    if (this._roadPathDirty) {
      this._rebuildRoadPath();
      this._roadPathDirty = false;
    }

    this._updateLiveBuildings(dt, t);
    this._updateSmoke(dt);
    this._updatePeople(sdt);
    this._updateVisitors?.(sdt);

    this.controls.update?.();
    this.renderer.render(this.scene, this.camera);
  }

  // ─────────────────────────────────────────────
  // Resize / Dashboard
  // ─────────────────────────────────────────────

  _bindResize() { window.addEventListener('resize', () => this._onResize()); }
  _onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setTimeScale(scale) {
    const clamped = Math.max(0, Math.min(3, Math.floor(scale)));
    this.timeScale = clamped;
    const mark = (el, on) => { if (!el) return; el.classList.toggle('active', !!on); };
    if (this.speedBtns) {
      mark(this.speedBtns.pause, clamped === 0);
      mark(this.speedBtns.x1, clamped === 1);
      mark(this.speedBtns.x2, clamped === 2);
      mark(this.speedBtns.x3, clamped === 3);
    }
    this._feed(`Speed: ${clamped === 0 ? 'Paused' : clamped + 'x'}`);
  }

  _feed(message, level = 'info') {
    const container = document.getElementById('feed') || document.getElementById('feedList') || document.querySelector('#rightPanel .feed') || document.querySelector('.feed');
    if (!container) return;
    const item = document.createElement('div');
    item.className = `feed-item ${level}`;
    const ts = new Date();
    item.textContent = `[${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}] ${message}`;
    container.prepend(item);
    while (container.children.length > 30) container.removeChild(container.lastChild);
  }
}

export { City3DGame };
