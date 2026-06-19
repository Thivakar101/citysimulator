import * as THREE from 'three';
import {
  DECORATION_BUTTON_TYPES,
  LEVEL_BUTTON_TYPES,
} from '../gameConfig.js';

export function installSimulationMethods(City3DGame) {
  Object.assign(City3DGame.prototype, {
    _updateUI() {
      if (this.levelTextEl) {
        this.levelTextEl.textContent = `Level ${this.level}`;
      }
      const filled = this._countFilledCells();
      const target = this._getLevelProgressTarget();
      if (this.progressTextEl) {
        this.progressTextEl.textContent = `${filled}/${target}`;
      }
      if (this.happyPointsTextEl) {
        this.happyPointsTextEl.textContent = `${this.happinessPoints}`;
      }
      if (this.happyTextEl) {
        this.happyTextEl.textContent = `${Math.round(this.happiness * 100)}%`;
      }

      document.querySelectorAll('[data-stock-for]').forEach((stockElement) => {
        const type = stockElement.getAttribute('data-stock-for');
        if (type) {
          stockElement.textContent = `${this._getRemainingStock(type)} left`;
        }
      });

      for (let level = 1; level <= this.maxLevel; level++) {
        const group = document.getElementById(`lvl${level}Group`);
        if (!group) {
          continue;
        }

        group.style.display = 'flex';
        group.querySelectorAll('.build-btn').forEach((button) => {
          const buildType = Object.entries(this.ui).find(([, element]) => element === button)?.[0];
          const type = LEVEL_BUTTON_TYPES[buildType];
          const outOfStock = type ? !this._canPlaceType(type) : false;
          const overlayText = level > this.level ? `🔒 Lvl ${level}` : outOfStock ? 'Full' : null;

          if (level > this.level || outOfStock) {
            button.disabled = true;
            button.classList.add('locked');
            const overlay = button.querySelector('.lock-overlay') || document.createElement('span');
            overlay.className = 'lock-overlay';
            overlay.textContent = overlayText;
            if (!overlay.parentElement) {
              button.appendChild(overlay);
            }
          } else {
            button.disabled = false;
            button.classList.remove('locked');
            button.querySelector('.lock-overlay')?.remove();
          }
        });
      }

      Object.entries(DECORATION_BUTTON_TYPES).forEach(([id, type]) => {
        const button = this.ui[id];
        if (!button) {
          return;
        }

        const outOfStock = !this._canPlaceType(type);
        button.disabled = outOfStock;
        button.classList.toggle('locked', outOfStock);
        const overlay = button.querySelector('.lock-overlay');
        if (outOfStock) {
          const lock = overlay || document.createElement('span');
          lock.className = 'lock-overlay';
          lock.textContent = 'Full';
          if (!lock.parentElement) {
            button.appendChild(lock);
          }
        } else {
          overlay?.remove();
        }
      });
    },

    _recomputeCityStats() {
      let population = 0;
      let happinessSum = 0;
      let houseCount = 0;

      const hasNeighborType = (row, col, types, distance = 1) => {
        for (let dRow = -distance; dRow <= distance; dRow++) {
          for (let dCol = -distance; dCol <= distance; dCol++) {
            if (dRow === 0 && dCol === 0) {
              continue;
            }
            const nextRow = row + dRow;
            const nextCol = col + dCol;
            if (nextRow < 0 || nextCol < 0 || nextRow >= this.gridSize || nextCol >= this.gridSize) {
              continue;
            }
            const neighbor = this.grid[nextRow][nextCol];
            if (neighbor?.userData && types.includes(neighbor.userData.type)) {
              return true;
            }
          }
        }
        return false;
      };

      const countNeighborType = (row, col, type, maxDistance = 2) => {
        let count = 0;
        for (let dRow = -maxDistance; dRow <= maxDistance; dRow++) {
          for (let dCol = -maxDistance; dCol <= maxDistance; dCol++) {
            if (dRow === 0 && dCol === 0) {
              continue;
            }
            if (dRow * dRow + dCol * dCol > maxDistance * maxDistance) {
              continue;
            }
            const nextRow = row + dRow;
            const nextCol = col + dCol;
            if (nextRow < 0 || nextCol < 0 || nextRow >= this.gridSize || nextCol >= this.gridSize) {
              continue;
            }
            const neighbor = this.grid[nextRow][nextCol];
            if (neighbor?.userData?.type === type) {
              count++;
            }
          }
        }
        return count;
      };

      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          const mesh = this.grid[row][col];
          if (!mesh?.userData || !['house1', 'house2'].includes(mesh.userData.type)) {
            continue;
          }

          houseCount++;
          const nearRoad = hasNeighborType(row, col, ['road'], 1);
          const factories = countNeighborType(row, col, 'factory', 2);
          const parks = countNeighborType(row, col, 'park', 2);
          population += Math.round(5 * (nearRoad ? 1 : 0.5));

          let localHappiness = 1;
          for (let i = 0; i < factories; i++) {
            localHappiness *= 0.85;
          }
          for (let i = 0; i < parks; i++) {
            localHappiness *= 1.1;
          }
          happinessSum += Math.max(0.2, Math.min(1.2, localHappiness));

          if (!nearRoad) {
            this._toastAtCell(row, col, 'House needs roads');
          }
        }
      }

      this.population = population;
      this.happiness = Math.max(0, Math.min(1, houseCount ? happinessSum / houseCount : 1));
      this._checkLevelProgression();
      this._updateUI();
    },

    _toastAtCell(row, col, message) {
      const status = document.getElementById('status');
      if (!status) {
        return;
      }
      status.textContent = message;
      status.style.display = 'block';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        status.style.display = 'none';
      }, 1400);
    },

    _expandGridByOneRing() {
      const oldSize = this.gridSize;
      const newSize = this._getLevelGridSize(this.level);
      if (newSize <= oldSize) {
        return;
      }

      const newGrid = Array.from({ length: newSize }, () => Array(newSize).fill(null));
      const offset = Math.floor((newSize - oldSize) / 2);
      this.gridOriginX -= offset * this.cellSize;
      this.gridOriginZ -= offset * this.cellSize;

      for (let index = this.smokePuffs.length - 1; index >= 0; index--) {
        const puff = this.smokePuffs[index];
        const mesh = puff.mesh || puff.sprite;
        this.scene.remove(mesh);
        mesh.geometry?.dispose?.();
        if (mesh.material?.map) {
          mesh.material.map.dispose();
        }
        mesh.material?.dispose?.();
        this.smokePuffs.splice(index, 1);
      }

      const parksToRespawn = [];
      for (let row = 0; row < oldSize; row++) {
        for (let col = 0; col < oldSize; col++) {
          const mesh = this.grid[row][col];
          if (!mesh) {
            continue;
          }

          const nextRow = row + offset;
          const nextCol = col + offset;
          const position = this._gridToWorld(nextCol, nextRow);
          mesh.position.set(position.x, mesh.position.y, position.z);
          mesh.userData.grid = { row: nextRow, col: nextCol };
          newGrid[nextRow][nextCol] = mesh;
          if (!mesh.parent) {
            this.scene.add(mesh);
          }
          if (mesh.userData.type === 'park') {
            this._removePeopleForPark(mesh);
            parksToRespawn.push({ mesh, row: nextRow, col: nextCol });
          }
        }
      }

      this.grid = newGrid;
      this.gridSize = newSize;
      this._rebuildGroundAndGrid();
      parksToRespawn.forEach((park) => this._spawnPeopleForPark(park.mesh, park.row, park.col));
      this._applyLevelView(true);
      this._recomputeCityStats();
      this._markRoadPathDirty();
    },

    _rebuildGroundAndGrid() {
      if (this.gridHelper) {
        this.scene.remove(this.gridHelper);
        this.gridHelper.geometry.dispose();
        this.gridHelper.material.dispose();
        this.gridHelper = null;
      }
      if (this.ground) {
        this.scene.remove(this.ground);
        this.ground.geometry.dispose();
        this.ground.material.dispose();
        this.ground = null;
      }

      const planeSize = this.gridSize * this.cellSize;
      const center = this._getGridCenterWorld();
      const gridColors = this._getGridHelperColors();
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize, planeSize),
        new THREE.MeshStandardMaterial({ color: 0xaeb4bb, roughness: 0.95, metalness: 0.02 })
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
    },

    _addLiveBuildingDetails(root, type) {
      const animatedTypes = new Set([
        'house1',
        'house2',
        'skyscraper',
        'fireStation',
        'school',
        'library',
        'bakery',
        'factory',
        'treeA',
        'treeB',
        'park',
        'flowerGarden',
        'road',
      ]);
      if (!animatedTypes.has(type)) {
        return;
      }

      const base = this.cellSize * 0.85;
      const proceduralChild = root.children[0] || root;
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
        sirenMesh: null,
        flagMesh: null,
        parkAnimData: null,
      };

      root.traverse((child) => {
        if (child.userData.isSiren) {
          entry.sirenMesh = child;
        }
        if (child.userData.isFlag) {
          entry.flagMesh = child;
        }
        if (child.userData.isSkyscraperPulse) {
          entry.pulsers.push(child);
        }
        if (child.userData.isSkyscraperRotor) {
          entry.rotors.push(child);
        }
        if (type === 'park' && child.userData.isParkPerson) {
          entry.parkAnimData ??= { people: [] };
          entry.parkAnimData.people.push(child);
        }
      });

      const addWindow = (x, y, z, width = this.cellSize * 0.18, height = this.cellSize * 0.16) => {
        const material = new THREE.MeshStandardMaterial({
          color: 0xfff2a8,
          emissive: 0xffcc55,
          emissiveIntensity: 0.25 + Math.random() * 0.35,
          roughness: 0.28,
          metalness: 0.1,
        });
        const windowMesh = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, this.cellSize * 0.025),
          material
        );
        windowMesh.position.set(x, y, z);
        windowMesh.userData.baseIntensity = material.emissiveIntensity;
        proceduralChild.add(windowMesh);
        entry.windows.push(windowMesh);
      };

      const windowRowsByType = {
        house1: 1,
        house2: 1,
        shop: 2,
        factory: 1,
        bakery: 1,
        school: 2,
        library: 2,
        hospital: 2,
        fireStation: 1,
        tower: 3,
        apartment: 4,
        clockTower: 2,
      };

      const skipOverlayWindows =
        type === 'house1' &&
        root.userData?.assetType === 'house1' &&
        !root.userData?.proceduralRoot;
      const rows = skipOverlayWindows ? 0 : (windowRowsByType[type] || 0);
      if (rows) {
        const cols = ['tower', 'clockTower'].includes(type) ? 1 : type === 'skyscraper' ? 3 : 2;
        for (let row = 0; row < rows; row++) {
          const y = this.cellSize * (0.34 + row * 0.32);
          for (let col = 0; col < cols; col++) {
            const x = (col - (cols - 1) / 2) * this.cellSize * 0.22;
            addWindow(x, y, base * 0.47);
            if (rows > 1 && col % 2 === 0) {
              addWindow(x, y, -base * 0.47);
            }
          }
        }
      }

      if (['hospital', 'shop', 'bakery'].includes(type)) {
        const color = type === 'hospital' ? 0x49b8ff : 0xffdd55;
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(this.cellSize * 0.09, 12, 12),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.8,
            roughness: 0.2,
          })
        );
        beacon.position.set(base * 0.34, this.cellSize * 1.03, base * 0.34);
        proceduralChild.add(beacon);
        entry.pulsers.push(beacon);
      }

      if (type === 'clockTower') {
        const handMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.4 });
        const minute = new THREE.Mesh(
          new THREE.BoxGeometry(this.cellSize * 0.035, this.cellSize * 0.34, this.cellSize * 0.035),
          handMaterial
        );
        const hour = new THREE.Mesh(
          new THREE.BoxGeometry(this.cellSize * 0.045, this.cellSize * 0.23, this.cellSize * 0.035),
          handMaterial
        );
        minute.position.set(0, this.cellSize * 1.72, base * 0.295);
        hour.position.set(0, this.cellSize * 1.72, base * 0.305);
        proceduralChild.add(minute, hour);
        entry.clockHands.push({ minute, hour });
      }

      if (['treeA', 'treeB', 'flowerGarden'].includes(type)) {
        entry.swayers.push(root);
      }

      this.liveBuildingParts.push(entry);
    },

    _updateLiveBuildings(dt, elapsed) {
      for (const entry of this.liveBuildingParts) {
        if (!entry.root.parent) {
          continue;
        }

        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + entry.phase);
        entry.windows.forEach((windowMesh, index) => {
          if (windowMesh.material) {
            windowMesh.material.emissiveIntensity =
              windowMesh.userData.baseIntensity *
              (0.55 + 0.45 * Math.sin(elapsed * (1.3 + index * 0.07) + entry.phase + index));
          }
        });
        entry.rotors.forEach((rotor) => {
          rotor.rotation.z += dt * (rotor.userData.isSkyscraperRotor ? 0.8 : 6.5);
        });
        entry.pulsers.forEach((pulser) => {
          pulser.material.emissiveIntensity = 0.4 + pulse * 1.6;
          pulser.scale.setScalar(0.85 + pulse * 0.3);
        });
        entry.clockHands.forEach((hands) => {
          hands.minute.rotation.z -= dt * 1.8;
          hands.hour.rotation.z -= dt * 0.16;
        });
        entry.swayers.forEach((swayer) => {
          swayer.rotation.x = Math.sin(elapsed * 1.8 + entry.phase) * 0.025;
          swayer.rotation.z = Math.cos(elapsed * 1.4 + entry.phase) * 0.025;
        });

        entry.parkAnimData?.people?.forEach((person) => {
          const path = person.userData.path;
          if (!path) {
            return;
          }

          let x = person.position.x;
          let z = person.position.z;
          let nextX = x;
          let nextZ = z;

          if (path.type === 'oval') {
            const angle = elapsed * path.speed + person.userData.phase;
            x = path.cx + Math.cos(angle) * path.rx;
            z = path.cz + Math.sin(angle) * path.rz;
            nextX = path.cx + Math.cos(angle + 0.03) * path.rx;
            nextZ = path.cz + Math.sin(angle + 0.03) * path.rz;
          } else {
            path.t = (path.t + dt * path.speed) % 1;
            const nextT = (path.t + 0.02) % 1;
            x = path.x1 + (path.x2 - path.x1) * path.t;
            z = path.z1 + (path.z2 - path.z1) * path.t;
            nextX = path.x1 + (path.x2 - path.x1) * nextT;
            nextZ = path.z1 + (path.z2 - path.z1) * nextT;
          }

          person.position.set(
            x,
            0.04 + Math.abs(Math.sin(elapsed * 6 + person.userData.phase)) * 0.025,
            z
          );
          const dx = nextX - x;
          const dz = nextZ - z;
          if (Math.abs(dx) + Math.abs(dz) > 0.00001) {
            person.rotation.y = Math.atan2(dx, dz);
          }
          const swing = Math.sin(elapsed * 6 + person.userData.phase) * 0.28;
          person.children.forEach((part) => {
            if (part.position.x < 0 && part.position.y < 0.25) {
              part.rotation.x = swing;
            }
            if (part.position.x > 0 && part.position.y < 0.25) {
              part.rotation.x = -swing;
            }
            if (part.position.x < 0 && part.position.y > 0.25 && part.position.y < 0.45) {
              part.rotation.x = -swing * 0.5;
            }
            if (part.position.x > 0 && part.position.y > 0.25 && part.position.y < 0.45) {
              part.rotation.x = swing * 0.5;
            }
          });
        });

        if (entry.type === 'fireStation' && entry.sirenMesh) {
          entry.sirenMesh.material.emissiveIntensity = 0.4 + pulse * 2.2;
          entry.sirenMesh.material.emissive.setHSL(0, 1, 0.35 + pulse * 0.15);
        }
        if (entry.flagMesh) {
          entry.flagMesh.rotation.z = Math.sin(elapsed * 3.2 + entry.phase) * 0.12;
          entry.flagMesh.rotation.y = Math.sin(elapsed * 2 + entry.phase * 0.5) * 0.06;
        }
        if (entry.type === 'shop') {
          entry.windows.forEach((windowMesh) => {
            if (windowMesh.material) {
              windowMesh.material.emissiveIntensity =
                0.18 + 0.08 * Math.sin(elapsed * 0.9 + entry.phase);
            }
          });
        }
        if (entry.type === 'factory') {
          entry.smokeTimer -= dt;
          if (entry.smokeTimer <= 0) {
            const chimneyX = (Math.random() < 0.5 ? -1 : 1) * this.cellSize * 0.1;
            const world = entry.root.localToWorld(
              new THREE.Vector3(chimneyX, this.cellSize * 1.5, -this.cellSize * 0.07)
            );
            this._emitSmokePuff(world);
            entry.smokeTimer = 0.35 + Math.random() * 0.35;
          }
        }
        if (entry.type === 'bakery') {
          entry.smokeTimer -= dt;
          if (entry.smokeTimer <= 0) {
            const world = entry.root.localToWorld(
              new THREE.Vector3(0, this.cellSize * 0.98, this.cellSize * 0.08)
            );
            this._emitSmokePuff(world, 0xfff1dc, 0.45);
            entry.smokeTimer = 0.55 + Math.random() * 0.45;
          }
        }
      }
    },

    _emitSmokePuff(position, color = 0xc8c8c8, opacity = 0.36) {
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity,
        roughness: 1,
        depthWrite: false,
      });
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(this.cellSize * 0.09, 10, 10),
        material
      );
      puff.position.copy(position);
      puff.castShadow = false;
      this.scene.add(puff);
      this.smokePuffs.push({
        mesh: puff,
        life: 1,
        driftX: (Math.random() - 0.5) * this.cellSize * 0.18,
        driftZ: (Math.random() - 0.5) * this.cellSize * 0.18,
      });
    },

    _updateSmoke(dt) {
      for (let index = this.smokePuffs.length - 1; index >= 0; index--) {
        const puff = this.smokePuffs[index];
        const mesh = puff.mesh || puff.sprite;
        puff.life -= dt * 0.55;
        if (puff.life <= 0) {
          this.scene.remove(mesh);
          mesh.geometry?.dispose?.();
          if (mesh.material?.map) {
            mesh.material.map.dispose();
          }
          mesh.material?.dispose?.();
          this.smokePuffs.splice(index, 1);
          continue;
        }
        mesh.position.y += dt * this.cellSize * 0.35;
        mesh.position.x += puff.driftX * dt;
        mesh.position.z += puff.driftZ * dt;
        mesh.scale.setScalar(1 + (1 - puff.life) * 2.2);
        if (mesh.material) {
          mesh.material.opacity = Math.max(0, puff.life * 0.36);
        }
      }
    },

    _spawnCarOnPath() {
      if (!this._roadPathCurve) {
        return;
      }
      const mesh = this._buildCarMesh();
      const pathT = Math.random();
      mesh.position.copy(this._roadPathCurve.getPointAt(pathT));
      this.scene.add(mesh);
      this.cars.push({
        mesh,
        pathT,
        speed: 0.018 + Math.random() * 0.014,
        isPathCar: true,
        targetSpeed: null,
      });
    },

    _buildCarMesh(color = null) {
      const carColor =
        color ??
        [0x3b89ff, 0xe74c3c, 0x2ecc71, 0xf39c12, 0x9b59b6][Math.floor(Math.random() * 5)];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(this.cellSize * 0.32, this.cellSize * 0.18, this.cellSize * 0.52),
        new THREE.MeshStandardMaterial({ color: carColor, metalness: 0.4, roughness: 0.4 })
      );
      body.castShadow = true;

      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(this.cellSize * 0.28, this.cellSize * 0.1, this.cellSize * 0.26),
        new THREE.MeshStandardMaterial({ color: 0xaad0ff, roughness: 0.1, metalness: 0.9 })
      );
      roof.position.y = this.cellSize * 0.14;
      body.add(roof);

      [
        [-this.cellSize * 0.14, this.cellSize * 0.18],
        [this.cellSize * 0.14, this.cellSize * 0.18],
        [-this.cellSize * 0.14, -this.cellSize * 0.18],
        [this.cellSize * 0.14, -this.cellSize * 0.18],
      ].forEach(([x, z]) => {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(this.cellSize * 0.055, this.cellSize * 0.055, this.cellSize * 0.05, 12),
          new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, -this.cellSize * 0.07, z);
        body.add(wheel);
      });

      const group = new THREE.Group();
      body.position.y = this.cellSize * 0.14;
      group.add(body);
      return group;
    },

    _findRandomRoadStart() {
      const candidates = [];
      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          if (!this._isRoadCell(row, col)) {
            continue;
          }
          const options = this._roadNeighborDirs(row, col);
          if (options.length) {
            candidates.push({ row, col, options });
          }
        }
      }
      if (!candidates.length) {
        return null;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return {
        row: pick.row,
        col: pick.col,
        dir: pick.options[Math.floor(Math.random() * pick.options.length)],
      };
    },

    _roadNeighborDirs(row, col) {
      const directions = [];
      if (this._isRoadCell(row - 1, col)) directions.push('N');
      if (this._isRoadCell(row + 1, col)) directions.push('S');
      if (this._isRoadCell(row, col + 1)) directions.push('E');
      if (this._isRoadCell(row, col - 1)) directions.push('W');
      return directions;
    },

    _spawnCar(row, col, dir) {
      const mesh = this._buildCarMesh();
      const center = this._gridToWorld(col, row);
      const laneOffset = this.cellSize * 0.18;
      const direction = this._dirVec(dir);
      const perpendicular = { x: -direction.z, z: direction.x };
      mesh.position.set(
        center.x + perpendicular.x * laneOffset,
        0,
        center.z + perpendicular.z * laneOffset
      );
      mesh.rotation.y = this._yawForDir(dir);
      this.scene.add(mesh);
      this.cars.push({
        mesh,
        row,
        col,
        dir,
        t: 0,
        speed: this.cellSize * (0.55 + Math.random() * 0.35),
        laneOffset,
        laneSign: 1,
        isPathCar: false,
        targetSpeed: null,
      });
    },

    _yawForDir(dir) {
      return dir === 'N' ? Math.PI : dir === 'S' ? 0 : dir === 'E' ? -Math.PI / 2 : Math.PI / 2;
    },

    _updateCars(dt) {
      for (let index = this.cars.length - 1; index >= 0; index--) {
        const car = this.cars[index];
        if (!car.isPathCar) {
          continue;
        }
        if (!this._roadPathCurve) {
          this.scene.remove(car.mesh);
          this.cars.splice(index, 1);
          continue;
        }

        car.pathT += car.speed * dt;
        if (car.pathT > 1) {
          this.scene.remove(car.mesh);
          this.cars.splice(index, 1);
          continue;
        }

        const position = this._roadPathCurve.getPointAt(car.pathT);
        const tangent = this._roadPathCurve.getTangentAt(car.pathT);
        car.mesh.position.copy(position);
        car.mesh.lookAt(position.clone().add(tangent));
      }

      for (let index = this.cars.length - 1; index >= 0; index--) {
        const car = this.cars[index];
        if (car.isPathCar) {
          continue;
        }

        const direction = this._dirVec(car.dir);
        let carAhead = false;
        const nextRow = car.row + direction.gr;
        const nextCol = car.col + direction.gc;

        if (this._isRoadCell(nextRow, nextCol)) {
          for (const other of this.cars) {
            if (other === car || other.isPathCar) {
              continue;
            }
            if (other.row === nextRow && other.col === nextCol) {
              carAhead = true;
              break;
            }
          }
        }

        if (carAhead) {
          car.speed *= 0.7;
          if (car.speed < this.cellSize * 0.05) {
            car.speed = 0;
          }
        } else {
          car.speed = Math.min(car.speed + dt * this.cellSize * 0.1, this.cellSize * 0.9);
        }

        car.t += (car.speed * dt) / this.cellSize;
        const start = this._gridToWorld(car.col, car.row);
        const perpendicular = { x: -direction.z, z: direction.x };
        car.mesh.position.x = start.x + direction.x * this.cellSize * car.t + perpendicular.x * car.laneSign * car.laneOffset;
        car.mesh.position.z = start.z + direction.z * this.cellSize * car.t + perpendicular.z * car.laneSign * car.laneOffset;

        if (car.t >= 1) {
          const targetRow = car.row + direction.gr;
          const targetCol = car.col + direction.gc;
          if (!this._isRoadCell(targetRow, targetCol)) {
            const choices = this._roadNeighborDirs(car.row, car.col).filter(
              (choice) => choice !== this._oppositeDir(car.dir)
            );
            if (choices.length) {
              car.dir = choices[Math.floor(Math.random() * choices.length)];
              car.mesh.rotation.y = this._yawForDir(car.dir);
            } else {
              this.scene.remove(car.mesh);
              this.cars.splice(index, 1);
              continue;
            }
          } else {
            car.row = targetRow;
            car.col = targetCol;
          }
          car.t = 0;
        }

        if (car.row < 0 || car.col < 0 || car.row >= this.gridSize || car.col >= this.gridSize) {
          this.scene.remove(car.mesh);
          this.cars.splice(index, 1);
        }
      }
    },

    _oppositeDir(dir) {
      return dir === 'N' ? 'S' : dir === 'S' ? 'N' : dir === 'E' ? 'W' : 'E';
    },

    _dirVec(dir) {
      switch (dir) {
        case 'N':
          return { x: 0, z: -1, gr: -1, gc: 0 };
        case 'S':
          return { x: 0, z: 1, gr: 1, gc: 0 };
        case 'E':
          return { x: 1, z: 0, gr: 0, gc: 1 };
        case 'W':
          return { x: -1, z: 0, gr: 0, gc: -1 };
        default:
          return { x: 0, z: 0, gr: 0, gc: 0 };
      }
    },

    _spawnPeopleForPark() {},
    _removePeopleForPark() {},
    _updatePeople() {},
    _spawnVisitorsForBuilding() {},
    _removeVisitorsForBuilding() {},
    _updateVisitors() {},

    _animate() {
      this._raf = requestAnimationFrame(() => this._animate());
      const now = performance.now() * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, now - this._lastTime));
      this._lastTime = now;
      const scaledDt = dt * (this.timeScale || 0);

      if (this._roadPathDirty) {
        this._rebuildRoadPath();
        this._roadPathDirty = false;
      }

      this._updateLiveBuildings(dt, now);
      this._updateSmoke(dt);
      this._updatePeople(scaledDt);
      this._updateVisitors?.(scaledDt);

      this.controls.update?.();
      this.renderer.render(this.scene, this.camera);
    },

    setTimeScale(scale) {
      const clamped = Math.max(0, Math.min(3, Math.floor(scale)));
      this.timeScale = clamped;
      const markActive = (element, isActive) => {
        element?.classList.toggle('active', !!isActive);
      };
      if (this.speedBtns) {
        markActive(this.speedBtns.pause, clamped === 0);
        markActive(this.speedBtns.x1, clamped === 1);
        markActive(this.speedBtns.x2, clamped === 2);
        markActive(this.speedBtns.x3, clamped === 3);
      }
      this._feed(`Speed: ${clamped === 0 ? 'Paused' : `${clamped}x`}`);
    },
  });
}

