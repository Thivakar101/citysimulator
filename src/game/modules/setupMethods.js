import * as THREE from 'three';
import { CoCCameraController } from '../CoCCameraController.js';
import {
  HUD_ELEMENT_IDS,
  STORE_ITEMS,
  UI_ELEMENT_IDS,
} from '../gameConfig.js';

export function installSetupMethods(City3DGame) {
  Object.assign(City3DGame.prototype, {
    introCinematic() {
      this._applyLevelView();
    },

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
      if (THREE.ACESFilmicToneMapping) {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      }
      this.renderer.toneMappingExposure = 1.15;
      this.container.appendChild(this.renderer.domElement);

      this.controls = new CoCCameraController(this.camera, this.renderer.domElement, {
        interactive: true,
      });
    },

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

      const gridHelper = new THREE.GridHelper(
        planeSize,
        this.gridSize,
        gridColors.major,
        gridColors.minor
      );
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

      this.scene.add(new THREE.HemisphereLight(0x88aaff, 0x222233, 0.6));
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(400, 32, 32),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            topColor: { value: new THREE.Color(0x151826) },
            bottomColor: { value: new THREE.Color(0x0e0f14) },
            offset: { value: 400 },
            exponent: { value: 0.6 },
          },
          vertexShader:
            'varying vec3 vWorldPosition;\n' +
            'void main(){\n' +
            ' vec4 worldPosition = modelMatrix * vec4(position, 1.0);\n' +
            ' vWorldPosition = worldPosition.xyz;\n' +
            ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n' +
            '}',
          fragmentShader:
            'uniform vec3 topColor;\n' +
            'uniform vec3 bottomColor;\n' +
            'uniform float offset;\n' +
            'uniform float exponent;\n' +
            'varying vec3 vWorldPosition;\n' +
            'void main(){\n' +
            ' vec3 shifted = vWorldPosition + vec3(0.0, offset, 0.0);\n' +
            ' float h = normalize(shifted).y;\n' +
            ' float f = clamp(pow(max(h, 0.0), exponent), 0.0, 1.0);\n' +
            ' gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);\n' +
            '}',
        })
      );
      this.scene.add(sky);

      Object.entries(HUD_ELEMENT_IDS).forEach(([prop, id]) => {
        this[prop] = document.getElementById(id) || null;
      });

      this.ui = Object.fromEntries(
        Object.entries(UI_ELEMENT_IDS).map(([key, id]) => [key, document.getElementById(id)])
      );

      this._applyLevelView();
      this._bindUiEvents();
    },

    _bindUiEvents() {
      const getHappyBtn = document.getElementById('getHappinessBtn');
      if (getHappyBtn) {
        getHappyBtn.addEventListener('click', () => {
          this.happinessPoints += 10;
          this._updateUI();
          this._feed('Earned 10 Happiness Points!');
        });
      }

      STORE_ITEMS.forEach(({ id, placement }) => this._hookStore(id, placement));

      if (this.ui.cancelPlacement) {
        this.ui.cancelPlacement.addEventListener('click', () => this._cancelPlacement());
      }
      if (this.ui.rotatePlacement) {
        this.ui.rotatePlacement.addEventListener('click', () => this._rotatePlacementClockwise());
      }
      if (this.ui.rotateViewLeft) {
        this.ui.rotateViewLeft.addEventListener('click', () => this.controls?.rotateYaw(Math.PI / 4));
      }
      if (this.ui.rotateViewRight) {
        this.ui.rotateViewRight.addEventListener('click', () => this.controls?.rotateYaw(-Math.PI / 4));
      }
      if (this.ui.zoomIn) {
        this.ui.zoomIn.addEventListener('click', () => this.zoomIn());
      }
      if (this.ui.zoomOut) {
        this.ui.zoomOut.addEventListener('click', () => this.zoomOut());
      }
      if (this.ui.moveBuildingBtn) {
        this.ui.moveBuildingBtn.addEventListener('click', () => this._beginMoveSelectedBuilding());
      }
      if (this.ui.removeBuildingBtn) {
        this.ui.removeBuildingBtn.addEventListener('click', () => this._removeSelectedBuilding());
      }
      if (this.ui.cancelBuildingActionBtn) {
        this.ui.cancelBuildingActionBtn.addEventListener('click', () => this._hideBuildingActionMenu());
      }

      this.renderer.domElement.addEventListener('mousemove', (event) => this._onPointerMove(event));
      this.renderer.domElement.addEventListener('click', (event) => this._onClick(event));
      this.renderer.domElement.addEventListener('dblclick', (event) => this._onDoubleClick(event));
      this.renderer.domElement.addEventListener('pointerdown', (event) => this._onPointerDown(event));
      this.renderer.domElement.addEventListener('pointermove', (event) => this._onPointerDragMove(event));
      this.renderer.domElement.addEventListener('pointerup', () => this._clearLongPress());
      this.renderer.domElement.addEventListener('pointercancel', () => this._clearLongPress());
      this.renderer.domElement.addEventListener('pointerleave', () => this._clearLongPress());
      window.addEventListener('keydown', (event) => this._onKeyDown(event));
    },

    _rebuildRoadPath() {
      if (this._roadPathLine) {
        this.scene.remove(this._roadPathLine);
        this._roadPathLine.geometry.dispose();
        this._roadPathLine.material.dispose();
        this._roadPathLine = null;
      }
      this._roadPathCurve = null;

      const points = [];
      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          if (!this._isRoadCell(row, col)) {
            continue;
          }
          const { x, z } = this._gridToWorld(col, row);
          points.push(new THREE.Vector3(x, 0.8, z));
        }
      }

      if (points.length < 2) {
        return;
      }

      this._roadPathCurve = new THREE.CatmullRomCurve3(
        points,
        points.length > 2,
        'centripetal'
      );
    },

    _markRoadPathDirty() {
      this._roadPathDirty = true;
    },

    _gridToWorld(col, row) {
      return {
        x: this.gridOriginX + (col + 0.5) * this.cellSize,
        z: this.gridOriginZ + (row + 0.5) * this.cellSize,
      };
    },

    _getGridCenterWorld() {
      const planeSize = this.gridSize * this.cellSize;
      return new THREE.Vector3(
        this.gridOriginX + planeSize / 2,
        0,
        this.gridOriginZ + planeSize / 2
      );
    },

    _getLevelGridSize(level = this.level) {
      return this.baseGridSize + Math.max(0, level - 1) * 2;
    },

    _getLevelProgressTarget() {
      return Math.max(1, Math.ceil(this.gridSize * this.gridSize * this.levelProgressThreshold));
    },

    _countFilledCells() {
      let filled = 0;
      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          if (this.grid[row][col]) {
            filled++;
          }
        }
      }
      return filled;
    },

    _hasReachedLevelThreshold() {
      return this._countFilledCells() >= this._getLevelProgressTarget();
    },

    _checkLevelProgression() {
      if (this._levelTransitionPending || this.level >= this.maxLevel || !this._hasReachedLevelThreshold()) {
        return false;
      }

      this.level++;
      this.happinessPoints += 25;
      this._feed(`Level up! ${this.level}`);
      this._toastAtCell(
        Math.floor(this.gridSize / 2),
        Math.floor(this.gridSize / 2),
        `🎉 Level Up! Now Level ${this.level}`
      );
      this._levelTransitionPending = true;
      try {
        this._expandGridByOneRing();
      } finally {
        this._levelTransitionPending = false;
      }
      this._updateUI();
      return true;
    },

    _getLevelViewDistance(level = this.level) {
      const planeSize = this.gridSize * this.cellSize;
      const baseDistance = Math.max(planeSize * 0.9, 26);
      const index = Math.max(0, Math.min(this.levelViewMultipliers.length - 1, level - 1));
      const mobileBoost = this._isMobileViewport() ? 2.5 : 1;
      return baseDistance * (this.levelViewMultipliers[index] ?? 1) * mobileBoost;
    },

    _isMobileViewport() {
      return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    },

    _applyLevelView(animate = false) {
      if (!this.controls) {
        return;
      }

      const planeSize = this.gridSize * this.cellSize;
      const center = this._getGridCenterWorld();
      const targetDistance = this._getLevelViewDistance();
      const maxDistance = Math.max(targetDistance * 1.8, planeSize * 4.5, 160);

      this.controls.setDistanceLimits({ maxDistance });
      this.controls.setBounds({
        minX: this.gridOriginX - 4,
        maxX: this.gridOriginX + planeSize + 4,
        minZ: this.gridOriginZ - 4,
        maxZ: this.gridOriginZ + planeSize + 4,
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
      const easeOut = (value) => 1 - Math.pow(1 - value, 3);
      const tick = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        this.controls.setDistance(startDistance + delta * easeOut(progress));
        if (progress < 1) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    },

    _getGridHelperColors() {
      return { major: 0x64707d, minor: 0x92a0ac };
    },

    _worldToGrid(x, z) {
      const col = Math.floor((x - this.gridOriginX) / this.cellSize);
      const row = Math.floor((z - this.gridOriginZ) / this.cellSize);
      if (col < 0 || row < 0 || col >= this.gridSize || row >= this.gridSize) {
        return null;
      }
      return { col, row };
    },

    _hookStore(id, placement) {
      const element = this.ui[id];
      if (!element) {
        return;
      }

      element.addEventListener('click', () => {
        if (!this._canPlaceType(placement.type)) {
          this._toastAtCell(
            Math.floor(this.gridSize / 2),
            Math.floor(this.gridSize / 2),
            `${this._getLabelForType(placement.type)} is full`
          );
          return;
        }

        const registryEntry = this.buildingRegistry[placement.type];
        if (registryEntry && registryEntry.level > this.level) {
          this._toastAtCell(
            Math.floor(this.gridSize / 2),
            Math.floor(this.gridSize / 2),
            `🔒 Unlock at Level ${registryEntry.level}!`
          );
          return;
        }

        this._hideBuildingActionMenu();
        this.currentPlacement = placement;
        this.isRelocating = null;
        this._ensureGhost(placement.type);
        this.placementRotation = 0;
        this._setPlacementUiActive(true);
        this._updateUI();
      });
    },

    _ensureGhost(type) {
      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost = null;
      }

      const mesh = this._createBuildingMesh(type, { ghost: true });
      mesh.visible = false;
      this.scene.add(mesh);
      this.ghost = mesh;
    },

    _setGhostColor(mesh, hex) {
      const applyColor = (material) => {
        if (material?.color) {
          material.color.setHex(hex);
        }
      };

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(applyColor);
      } else {
        applyColor(mesh.material);
      }

      mesh.traverse?.((child) => {
        if (child === mesh || !child.material) {
          return;
        }
        if (Array.isArray(child.material)) {
          child.material.forEach(applyColor);
        } else {
          applyColor(child.material);
        }
      });
    },

    _setPlacementUiActive(isActive) {
      if (this.ui.placementControls) {
        this.ui.placementControls.classList.toggle('visible', !!isActive);
      }
    },

    _bindResize() {
      window.addEventListener('resize', () => this._onResize());
    },

    _onResize() {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    },

    _feed(message, level = 'info') {
      const container =
        document.getElementById('feed') ||
        document.getElementById('feedList') ||
        document.querySelector('#rightPanel .feed') ||
        document.querySelector('.feed');
      if (!container) {
        return;
      }

      const item = document.createElement('div');
      item.className = `feed-item ${level}`;
      const timestamp = new Date();
      item.textContent = `[${timestamp.getHours().toString().padStart(2, '0')}:${timestamp
        .getMinutes()
        .toString()
        .padStart(2, '0')}] ${message}`;
      container.prepend(item);
      while (container.children.length > 30) {
        container.removeChild(container.lastChild);
      }
    },
  });
}
