import { Engine } from '@babylonjs/core/Engines/engine';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { INITIAL_ZONES, Quality, resolutionScale, ZoneId, Zone } from './parking-data';

export interface SceneStats { fps: number; meshes: number; backend: string; quality: string; }
export class ParkingScene {
  private engine?: AbstractEngine;
  private scene?: Scene;
  private camera?: ArcRotateCamera;
  private observer?: ResizeObserver;
  private destroyed = false;
  private lastFrame = 0;
  private lastStats = 0;
  private renderedFrames = 0;
  private backend = 'WebGL';
  private quality: Quality = 'auto';
  private adaptiveLow = false;
  private slowWindows = 0;
  private orbit = false;
  private slots?: Mesh;
  private cars?: Mesh;
  private zones: Zone[] = structuredClone(INITIAL_ZONES);
  private removeTouch?: () => void;
  private onVisibility = () => {
    if (!this.engine) return;
    if (document.hidden) this.engine.stopRenderLoop();
    else this.engine.runRenderLoop(this.render);
  };
  constructor(private canvas: HTMLCanvasElement, private mobile: boolean, private onPick: (zone: ZoneId) => void, private onStats: (stats: SceneStats) => void) {}

  async init(onProgress: (value: string) => void): Promise<string> {
    // WebGPU is opt-in. Choose the backend before loading any scene resources.
    if (new URLSearchParams(location.search).get('renderer') === 'webgpu') {
      try {
        const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
        if (await WebGPUEngine.IsSupportedAsync) {
          const engine = new WebGPUEngine(this.canvas, { antialias: !this.mobile });
          await engine.initAsync();
          if (this.destroyed) { engine.dispose(); return ''; }
          this.engine = engine; this.backend = 'WebGPU';
        }
      } catch { onProgress('WebGPU 暂不可用，切换 WebGL'); }
    }
    if (this.destroyed) return '';
    this.engine ??= new Engine(this.canvas, !this.mobile, { preserveDrawingBuffer: false, stencil: false });
    this.applyQuality('auto');
    const scene = this.scene = new Scene(this.engine);
    scene.clearColor = new Color4(.026, .051, .085, 1);
    scene.ambientColor = new Color3(.35, .4, .5);
    this.camera = new ArcRotateCamera('orbit', -Math.PI / 2.2, .78, this.mobile ? 150 : 125, new Vector3(0, 5, 0), scene);
    this.camera.fov = .95;
    this.camera.lowerRadiusLimit = 30; this.camera.upperRadiusLimit = 190;
    this.camera.lowerBetaLimit = .18; this.camera.upperBetaLimit = 1.45;
    this.camera.minZ = .1; this.camera.maxZ = 500;
    this.camera.panningSensibility = 90; this.camera.wheelDeltaPercentage = .02;
    if (this.mobile) this.attachTouch(); else this.camera.attachControl(this.canvas, true);
    const light = new HemisphericLight('ambient', new Vector3(.5, 1, -.3), scene);
    light.intensity = 1.1;
    this.createSiteGround();
    let status = this.mobile ? '轻量场景 · 无大模型下载' : '园区模型已加载';
    if (this.mobile) this.createLightCampus();
    else {
      try {
        onProgress('加载精简园区模型…');
        const { ImportMeshAsync } = await import('@babylonjs/core/Loading/sceneLoader');
        await import('@babylonjs/loaders/glTF');
        if (this.destroyed) return '';
        const result = await ImportMeshAsync(new URL('models/campus-v1.glb', document.baseURI).href, scene, {
          onProgress: e => onProgress(e.lengthComputable ? `园区模型 ${Math.round(e.loaded / e.total * 100)}%` : '加载精简园区模型…')
        });
        if (this.destroyed) return '';
        const parent = new TransformNode('campus', scene);
        result.meshes.filter(m => !m.parent).forEach(m => m.parent = parent);
        const bounds = parent.getHierarchyBoundingVectors(true);
        const size = bounds.max.subtract(bounds.min);
        const factor = 92 / Math.max(size.x, size.z);
        parent.scaling.setAll(factor);
        const center = bounds.max.add(bounds.min).scale(.5);
        parent.position = new Vector3(-center.x * factor, -bounds.min.y * factor + .04, -center.z * factor);
        const material = this.material('campus-blue', '#416789', .12);
        const groundMaterial = this.material('campus-ground', '#122b3d', .1);
        const windowMaterial = this.material('campus-windows', '#307b8a', .2);
        result.meshes.forEach(m => { m.isPickable = false; if (m instanceof Mesh && m.getTotalVertices()) m.material = m.name.includes('ground') ? groundMaterial : m.name.includes('window') ? windowMaterial : material; });
        // Imported lights would otherwise change the presentation unpredictably.
        scene.lights.filter(l => l !== light).forEach(l => l.dispose());
      } catch {
        if (this.destroyed) return '';
        this.createLightCampus(); status = '模型加载失败，已启用轻量场景；可点击重新加载';
      }
    }
    this.createSign();
    this.createParking();
    this.createZoneMarkers();
    scene.onPointerObservable.add(info => {
      if (!this.mobile && info.type === PointerEventTypes.POINTERPICK) {
        const id = info.pickInfo?.pickedMesh?.metadata?.zone as ZoneId | undefined;
        if (id) this.onPick(id);
      }
    });
    this.observer = new ResizeObserver(() => this.engine?.resize());
    this.observer.observe(this.canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.lastStats = performance.now();
    this.engine.runRenderLoop(this.render);
    return status;
  }
  private material(name: string, hex: string, emissive = .3) {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(hex); mat.emissiveColor = mat.diffuseColor.scale(emissive);
    mat.specularColor.setAll(.15); return mat;
  }
  private attachTouch() {
    const pointers = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 }, moved = false;
    const coordinates = (event: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return matchMedia('(orientation: portrait)').matches
        ? { x: event.clientY - rect.top, y: rect.right - event.clientX }
        : { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const distance = () => { const [a,b] = [...pointers.values()]; return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : 0; };
    const down = (e: PointerEvent) => { const p = coordinates(e); pointers.set(e.pointerId, p); start = p; moved = false; this.canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      const old = pointers.get(e.pointerId); if (!old || !this.camera) return;
      const before = distance(), p = coordinates(e); pointers.set(e.pointerId, p);
      if (Math.hypot(p.x-start.x,p.y-start.y)>5) moved=true;
      if (pointers.size === 1) {
        this.camera.alpha -= (p.x-old.x)*.005;
        this.camera.beta = Math.max(.18,Math.min(1.45,this.camera.beta+(p.y-old.y)*.005));
      } else { const after = distance(); if (before>0 && after>0) this.camera.radius=Math.max(30,Math.min(190,this.camera.radius*before/after)); }
    };
    const up = (e: PointerEvent) => {
      if (!moved && pointers.size===1 && this.scene) {
        const p=coordinates(e); const pick=this.scene.pick(p.x,p.y); const zone=pick?.pickedMesh?.metadata?.zone as ZoneId | undefined;
        if(zone) this.onPick(zone);
      }
      pointers.delete(e.pointerId);
    };
    const cancel = (e: PointerEvent) => { pointers.delete(e.pointerId); };
    this.canvas.addEventListener('pointerdown',down);this.canvas.addEventListener('pointermove',move);this.canvas.addEventListener('pointerup',up);this.canvas.addEventListener('pointercancel',cancel);
    this.removeTouch=()=> {this.canvas.removeEventListener('pointerdown',down);this.canvas.removeEventListener('pointermove',move);this.canvas.removeEventListener('pointerup',up);this.canvas.removeEventListener('pointercancel',cancel);pointers.clear();};
  }
  private createSiteGround() {
    const ground = CreateGround('site', { width: 120, height: 90 }, this.scene);
    ground.material = this.material('ground', '#11273b', .12); ground.isPickable = false;
    const line = CreateBox('grid-source', { width: .07, height: .03, depth: 90 }, this.scene);
    line.material = this.material('grid', '#24506a', .6); line.isPickable = false;
    const transforms: number[] = [];
    for (let x = -60; x <= 60; x += 10) transforms.push(...Matrix.Translation(x, .03, 0).asArray());
    line.thinInstanceSetBuffer('matrix', new Float32Array(transforms), 16, true);
  }
  private createLightCampus() {
    const material = this.material('buildings', '#32617c', .2);
    for (const [x, z, w, d, h] of [[-24,-21,23,17,16],[14,-22,25,18,27],[-43,0,12,18,11],[37,-22,15,16,12]]) {
      const building = CreateBox('building', { width: w, depth: d, height: h }, this.scene);
      building.position.set(x, h / 2, z); building.material = material; building.isPickable = false;
      const roof = CreateBox('roof', { width: w + .6, depth: d + .6, height: .4 }, this.scene);
      roof.position.set(x, h, z); roof.material = this.material(`roof-${x}`, '#347d83', .1); roof.isPickable = false;
      // Floor strips are cheap geometry, no large textures or post processing.
      for (let y = 3; y < h; y += 3) {
        const strip = CreateBox('floor', { width: w + .08, depth: d + .08, height: .12 }, this.scene);
        strip.position.set(x, y, z); strip.material = roof.material; strip.isPickable = false;
      }
    }
  }
  private createSign() {
    const texture = new DynamicTexture('generic-hospital-sign', { width: 768, height: 128 }, this.scene, false);
    texture.drawText('某某中医院', null, 88, 'bold 72px Microsoft YaHei, sans-serif', '#d6fff9', '#0c273c', true);
    const sign = CreatePlane('某某中医院', { width: 24, height: 4 }, this.scene);
    sign.position.set(4, 24, -20); sign.billboardMode = Mesh.BILLBOARDMODE_ALL; sign.isPickable = false;
    const material = this.material('sign', '#ffffff', 1); material.diffuseTexture = texture; material.emissiveTexture = texture;
    sign.material = material;
  }
  private createParking() {
    this.slots = CreateBox('parking-slots', { width: 2.1, height: .05, depth: 4.2 }, this.scene);
    this.slots.material = this.material('free-slots', '#38a994', .5); this.slots.isPickable = false;
    this.cars = CreateBox('demo-vehicles', { width: 1.65, height: 1.15, depth: 3.4 }, this.scene);
    this.cars.material = this.material('vehicles', '#7f9fbd', .2); this.cars.isPickable = false;
    this.updateZones(this.zones);
  }
  updateZones(zones: Zone[]) {
    this.zones = zones;
    if (!this.slots || !this.cars) return;
    const slots: number[] = [], cars: number[] = [];
    zones.forEach(zone => {
      // The 3D footprint is representative; the authoritative capacity is in the data panel.
      const visible = this.mobile ? 18 : 30;
      const occupied = Math.round(zone.occupied / zone.capacity * visible);
      for (let i = 0; i < visible; i++) {
        const x = zone.position[0] + i % 10 * 2.55 - 11.5;
        const z = zone.position[1] + Math.floor(i / 10) * 5 - 3;
        slots.push(...Matrix.Translation(x, .22, z).asArray());
        if (i < occupied) cars.push(...Matrix.Translation(x, .85, z).asArray());
      }
    });
    this.slots.thinInstanceSetBuffer('matrix', new Float32Array(slots), 16, true);
    this.cars.thinInstanceSetBuffer('matrix', new Float32Array(cars), 16, true);
  }
  private createZoneMarkers() {
    for (const zone of this.zones) {
      const pin = CreateCylinder(`zone-${zone.id}`, { height: 1, diameter: 3.5, tessellation: 12 }, this.scene);
      pin.position.set(zone.position[0], 3, zone.position[1] - 8); pin.material = this.material(`zone-color-${zone.id}`, zone.color, .8); pin.metadata = { zone: zone.id };
    }
  }
  private render = () => {
    if (!this.engine || !this.scene || this.destroyed || document.hidden) return;
    const now = performance.now();
    if (now - this.lastFrame < (this.mobile || this.adaptiveLow ? 1000 / 30 : 1000 / 60) - 1) return;
    this.lastFrame = now;
    if (this.orbit && this.camera) this.camera.alpha += .0015;
    this.scene.render();
    this.renderedFrames++;
    if (now - this.lastStats > 1500) {
      const fps = Math.round(this.renderedFrames * 1000 / (now - this.lastStats));
      this.slowWindows = fps < 24 ? this.slowWindows + 1 : 0;
      if (this.quality === 'auto' && this.slowWindows >= 3 && !this.adaptiveLow) {
        this.adaptiveLow = true; this.engine.setHardwareScalingLevel(1.35);
      }
      this.onStats({ fps, meshes: this.scene.meshes.length, backend: this.backend, quality: this.adaptiveLow ? '自适应低功耗' : this.quality });
      this.lastStats = now;
      this.renderedFrames = 0;
    }
  };
  applyQuality(quality: Quality) {
    this.quality = quality; this.adaptiveLow = false; this.slowWindows = 0;
    this.engine?.setHardwareScalingLevel(resolutionScale(quality, this.mobile, window.devicePixelRatio));
  }
  setOrbit(value: boolean) { this.orbit = value; }
  focusZone(id: ZoneId) {
    const zone = this.zones.find(z => z.id === id);
    if (zone && this.camera) { this.camera.setTarget(new Vector3(zone.position[0], 0, zone.position[1])); this.camera.radius = 62; }
  }
  reset() { if (this.camera) { this.camera.setTarget(new Vector3(0, 5, 0)); this.camera.alpha = -Math.PI / 2.2; this.camera.beta = .78; this.camera.radius = this.mobile ? 150 : 125; } }
  top() { if (this.camera) { this.reset(); this.camera.beta = .2; } }
  dispose() {
    this.destroyed = true; this.observer?.disconnect();
    this.removeTouch?.();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.engine?.stopRenderLoop(); this.scene?.dispose(); this.engine?.dispose();
  }
}
