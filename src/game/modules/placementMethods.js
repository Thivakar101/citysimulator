import * as THREE from 'three';
import { BUILDING_LABELS } from '../gameConfig.js';

export function installPlacementMethods(City3DGame) {
  Object.assign(City3DGame.prototype, {
    _onPointerMove(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (!this.ghost && !this.isRelocating) {
        return;
      }

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, point);
      const cell = this._worldToGrid(point.x, point.z);
      if (!cell) {
        if (this.ghost) {
          this.ghost.visible = false;
        }
        return;
      }

      const { col, row } = cell;
      const { x, z } = this._gridToWorld(col, row);
      if (!this.ghost) {
        return;
      }

      this.ghost.position.set(x, 0.01, z);
      this.ghost.visible = true;
      const isFree = !this.grid[row][col];
      const placementType = this.currentPlacement
        ? this.currentPlacement.type
        : this.isRelocating?.userData.type;
      const registryEntry = placementType ? this.buildingRegistry[placementType] : null;
      const isUnlocked = !registryEntry || registryEntry.level <= this.level;
      this._setGhostColor(this.ghost, isFree && isUnlocked ? 0x66ff99 : 0xff6666);
    },

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
      if (!this.raycaster.ray.intersectPlane(plane, point)) {
        return;
      }

      const cell = this._worldToGrid(point.x, point.z);
      if (!cell) {
        return;
      }

      const { col, row } = cell;
      if (this.isRelocating) {
        this._placeRelocatedBuilding(row, col);
        return;
      }
      if (!this.currentPlacement) {
        return;
      }

      const registryEntry = this.buildingRegistry[this.currentPlacement.type];
      if (registryEntry && registryEntry.level > this.level) {
        this._toastAtCell(row, col, `Unlock at Level ${registryEntry.level}!`);
        return;
      }
      if (!this._canPlaceType(this.currentPlacement.type)) {
        this._toastAtCell(row, col, `${this._getLabelForType(this.currentPlacement.type)} limit reached`);
        return;
      }
      if (this.grid[row][col]) {
        return;
      }
      if (this.currentPlacement.isDecoration && this.happinessPoints < this.currentPlacement.cost) {
        this._toastAtCell(row, col, 'Not enough Happiness Points!');
        return;
      }

      const mesh = this._createBuildingMesh(this.currentPlacement.type);
      const position = this._gridToWorld(col, row);
      mesh.position.set(position.x, mesh.position.y, position.z);
      mesh.rotation.y = this.currentPlacement.type === 'road' ? 0 : this.placementRotation;
      mesh.userData = {
        ...mesh.userData,
        type: this.currentPlacement.type,
        grid: { col, row },
        isDecoration: this.currentPlacement.isDecoration,
        roadRotation:
          this.currentPlacement.type === 'road'
            ? this._snapRoadRotation(this.placementRotation)
            : undefined,
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

      if (mesh.userData.type === 'park') {
        this._spawnPeopleForPark(mesh, row, col);
      }
      if (mesh.userData.type === 'road') {
        this._refreshRoadNetworkAround(row, col);
      }

      this._recomputeCityStats();
      this._updateUI();
      this._feed(`Placed ${mesh.userData.type}`);
    },

    _placeRelocatedBuilding(row, col) {
      if (this.grid[row][col]) {
        return;
      }

      const mesh = this.isRelocating;
      const previousCell = mesh.userData.grid;
      if (previousCell) {
        this.grid[previousCell.row][previousCell.col] = null;
      }

      const position = this._gridToWorld(col, row);
      mesh.position.set(position.x, mesh.position.y, position.z);
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
      this._setPlacementUiActive(false);
      this._recomputeCityStats();
      this._feed('Building moved');

      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost = null;
      }

      if (mesh.userData.type === 'road') {
        if (previousCell) {
          this._refreshRoadNetworkAround(previousCell.row, previousCell.col);
        }
        this._refreshRoadNetworkAround(row, col);
      }
    },

    _onDoubleClick(event) {
      this._openBuildingActionMenu(this._getBuildingFromEvent(event));
    },

    _cancelPlacement() {
      this.currentPlacement = null;
      this.isRelocating = null;
      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost = null;
      }
      this._setPlacementUiActive(false);
      this._hideBuildingActionMenu();
    },

    _onPointerDown(event) {
      if (this.currentPlacement || this.isRelocating || this.selectedBuilding) {
        return;
      }
      const target = this._getBuildingFromEvent(event);
      if (!target) {
        return;
      }

      this._clearLongPress();
      this._longPressState.pointerId = event.pointerId;
      this._longPressState.startX = event.clientX;
      this._longPressState.startY = event.clientY;
      this._longPressState.target = target;
      this._longPressState.timer = setTimeout(() => {
        this._longPressState.active = true;
        this._openBuildingActionMenu(target);
      }, this.longPressDuration);
    },

    _onPointerDragMove(event) {
      const state = this._longPressState;
      if (!state.timer || state.pointerId !== event.pointerId) {
        return;
      }
      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) {
        this._clearLongPress();
      }
    },

    _clearLongPress() {
      const state = this._longPressState;
      if (state.timer) {
        clearTimeout(state.timer);
      }
      state.timer = null;
      state.pointerId = null;
      state.target = null;
      state.active = false;
    },

    _getBuildingFromEvent(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.buildings, true);
      if (!intersects.length) {
        return null;
      }

      let object = intersects[0].object;
      while (object && !this.buildings.includes(object)) {
        object = object.parent;
      }
      return object || null;
    },

    _openBuildingActionMenu(mesh) {
      this._clearLongPress();
      if (!mesh) {
        return;
      }
      this.selectedBuilding = mesh;
      this.ui.buildingActionMenu?.classList.add('visible');
    },

    _hideBuildingActionMenu() {
      this.selectedBuilding = null;
      this.ui.buildingActionMenu?.classList.remove('visible');
    },

    _beginMoveSelectedBuilding() {
      if (!this.selectedBuilding) {
        return;
      }
      this.isRelocating = this.selectedBuilding;
      this.currentPlacement = null;
      this._ensureGhost(this.isRelocating.userData.type);
      this.placementRotation =
        this.isRelocating.userData.type === 'road'
          ? this.isRelocating.userData.roadRotation ?? 0
          : this.isRelocating.rotation.y;
      if (this.ghost) {
        this.ghost.rotation.y = this.placementRotation;
      }
      this._setPlacementUiActive(true);
      this._hideBuildingActionMenu();
    },

    _removeSelectedBuilding() {
      if (!this.selectedBuilding) {
        return;
      }

      const mesh = this.selectedBuilding;
      const position = mesh.userData?.grid;
      if (position) {
        this.grid[position.row][position.col] = null;
      }
      this._removePeopleForPark(mesh);
      this._removeVisitorsForBuilding(mesh);
      this.scene.remove(mesh);
      this.buildings = this.buildings.filter((building) => building !== mesh);
      this.liveBuildingParts = this.liveBuildingParts.filter((entry) => entry.root !== mesh);
      if (mesh.userData?.type === 'road' && position) {
        this._refreshRoadNetworkAround(position.row, position.col);
      }
      this._hideBuildingActionMenu();
      this._recomputeCityStats();
      this._updateUI();
      this._feed(`Removed ${mesh.userData?.type || 'building'}`);
    },

    _getPlacedCount(type) {
      return this.buildings.filter((mesh) => mesh?.userData?.type === type).length;
    },

    _getRemainingStock(type) {
      if (type === 'road') {
        return Infinity;
      }
      return Math.max(0, this.maxPlacementsPerType - this._getPlacedCount(type));
    },

    _canPlaceType(type) {
      return this._getRemainingStock(type) > 0;
    },

    _getLabelForType(type) {
      return BUILDING_LABELS[type] || type;
    },

    _onKeyDown(event) {
      if (event.key === 'r' || event.key === 'R') {
        this.placementRotation += Math.PI / 2;
        if (this.ghost) {
          this.ghost.rotation.y = this.placementRotation;
        }
      }
      if (event.key === 'Escape') {
        this._cancelPlacement();
      }
    },
  });
}
