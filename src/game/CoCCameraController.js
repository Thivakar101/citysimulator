import * as THREE from 'three';

// Clash-of-Clans style camera controller: left-drag to pan, wheel to zoom, fixed tilt and yaw
export class CoCCameraController {
  constructor(camera, domElement, { interactive = true } = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;
    this.interactive = interactive;
    this.pitch = THREE.MathUtils.degToRad(55); // fixed tilt
    this.yaw = -Math.PI / 4; // isometric yaw
    this.distance = 40; // starting distance
    this.minDistance = 12;
    this.maxDistance = 120;
    this.panSpeed = 0.0025; // pixels -> world scale
    this.zoomSpeed = 0.0015; // wheel delta -> distance
    this.target = new THREE.Vector3();
    this.bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
    this._last = new THREE.Vector2();
    this._dragging = false;
    this._didDragLastGesture = false;

    this._isRotating = false;

    // Mouse events
    this._onMouseDown = (e) => {
      if (!this.enabled || !this.interactive) return;
      if (e.button === 0) {
        this._dragging = true;
        this._isRotating = false;
        this.domElement.style.cursor = 'grabbing';
      } else if (e.button === 2) {
        this._dragging = false;
        this._isRotating = true;
      } else {
        return;
      }
      this.hasDragged = false;
      this._didDragLastGesture = false;
      this._last.set(e.clientX, e.clientY);
    };
    this._onMouseMove = (e) => {
      if (!this.enabled || !this.interactive) return;
      if (!this._dragging && !this._isRotating) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      if (Math.hypot(dx, dy) > 2) {
        this.hasDragged = true;
      }
      if (this._dragging) {
        this._pan(dx, dy);
      } else if (this._isRotating) {
        this.yaw -= dx * 0.008;
        this.pitch -= dy * 0.008;
        this.pitch = THREE.MathUtils.clamp(this.pitch, 0.1, Math.PI / 2 - 0.05);
        this._updateCamera();
      }
      this._last.set(e.clientX, e.clientY);
    };
    this._onMouseUp = () => {
      this._dragging = false;
      this._isRotating = false;
      this._didDragLastGesture = !!this.hasDragged;
      this.hasDragged = false;
      this.domElement.style.cursor = 'default';
    };
    this._onWheel = (e) => {
      if (!this.enabled || !this.interactive) return;
      e.preventDefault();
      const factor = Math.exp(e.deltaY * this.zoomSpeed);
      this.setDistance(this.distance * factor);
    };
    this._onContextMenu = (e) => e.preventDefault();

    // Touch: one finger pan, two finger pinch zoom
    this._touchState = { active: false, last: null, pinchDist: 0 };
    this._onTouchStart = (e) => {
      if (!this.enabled || !this.interactive) return;
      this.hasDragged = false;
      this._didDragLastGesture = false;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._touchState.active = true; this._touchState.last = { x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 2) {
        this._touchState.active = false; // pinch mode
        this._touchState.pinchDist = this._touchDistance(e.touches[0], e.touches[1]);
      }
    };
    this._onTouchMove = (e) => {
      if (!this.enabled || !this.interactive) return;
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
    this._onTouchEnd = () => {
      this._touchState.active = false;
      this._didDragLastGesture = !!this.hasDragged;
      this.hasDragged = false;
    };

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
  setInteractive(interactive) { this.interactive = !!interactive; }

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
