import { Engine } from '@babylonjs/core/Engines/engine';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { FlowingCampusRoute, navigationCameraFrame } from './parking-navigation';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { INITIAL_ZONES, Quality, resolutionScale, ZoneId, Zone } from './parking-data';
import { zoneView, C_SIDE_POSITION } from './parking-layout';
import { ParkingVehicleBatches } from './parking-batches';
import { ParkingRenderProfiler, type RenderProfile } from './parking-profiler';
import { configureLocalKtxDecoder } from './parking-textures';
import { nearestAngle, rollWheel, sampleRoute, tailCameraPose, type TrafficRoutes, type TrafficRoute, type VehicleRig } from './parking-traffic';

export interface SceneStats { fps: number; meshes: number; backend: string; quality: string; renderWidth: number; renderHeight: number; profile?: RenderProfile; visibleParked?: number; parkedLod?: number; }
export interface ScenePin { id: ZoneId | 'C-side' | 'vehicle'; x: number; y: number; visible: boolean; }
export interface VehiclePick { parked: boolean; position: Vector3; index: number; }
interface Flight { start: number; from: Vector3; to: Vector3; radiusFrom: number; radiusTo: number; betaFrom: number; betaTo: number; alphaFrom: number; alphaTo: number; }
interface MovingVehicle { node: TransformNode; wheels: TransformNode[]; route: TrafficRoute; offset: number; speed: number; yaw: number; wheelAngle: number; previous?: Vector3; previousTime?: number; }

export class ParkingScene {
  private engine?: AbstractEngine;
  private scene?: Scene;
  private camera?: ArcRotateCamera;
  private observer?: ResizeObserver;
  private glow?: GlowLayer;
  private navigationRoute?: FlowingCampusRoute;
  private batches?: ParkingVehicleBatches;
  private profiler?: ParkingRenderProfiler;
  private vehicle?: TransformNode;
  private destroyed = false;
  private lastFrame = 0;
  private lastStats = 0;
  private lastProjection = 0;
  private renderedFrames = 0;
  private backend = 'WebGL';
  private quality: Quality = 'auto';
  private adaptiveCadence = false;
  private slowWindows = 0;
  private orbit = false;
  private follow = false;
  private vehiclePaused = false;
  private vehicleTime = 0;
  private trafficInitialized = false;
  private readonly tail = tailCameraPose(0, .008, 0, 0);
  private readonly tailTarget = new Vector3();
  private readonly flightTarget = new Vector3();
  private fleet: MovingVehicle[] = [];
  private rig?: VehicleRig;
  private selectedTrafficIndex = 0;
  private ktxLoaded = 0;
  private variantFallback = false;
  private flight?: Flight;
  private zones: Zone[] = structuredClone(INITIAL_ZONES);
  private removeTouch?: () => void;
  private onVisibility = () => {
    if (!this.engine) return;
    if (document.hidden) this.engine.stopRenderLoop();
    else { this.lastFrame = 0; this.lastStats = performance.now(); this.renderedFrames = 0; this.engine.runRenderLoop(this.render); }
  };
  constructor(private canvas: HTMLCanvasElement, private mobile: boolean, private onPick: (id: ZoneId | 'vehicle', vehicle?:VehiclePick) => void, private onStats: (stats: SceneStats) => void, private onProject: (pins: ScenePin[]) => void) {}

  async init(onProgress: (value: string) => void): Promise<string> {
    if (new URLSearchParams(location.search).get('renderer') === 'webgpu') {
      try {
        const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
        if (await WebGPUEngine.IsSupportedAsync) {
          const engine = new WebGPUEngine(this.canvas, { antialias: true });
          await engine.initAsync();
          if (this.destroyed) { engine.dispose(); return ''; }
          this.engine = engine; this.backend = 'WebGPU';
        }
      } catch { onProgress('正在切换至 WebGL…'); }
    }
    if (this.destroyed) return '';
    this.engine ??= new Engine(this.canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance' });
    this.applyQuality('auto');
    const scene = this.scene = new Scene(this.engine);
    // Keep the source glTF coordinate system; no destructive model recenter/scale.
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(.002, .007, .015, 1);
    scene.skipPointerMovePicking = true;
    scene.environmentIntensity = .35;
    this.camera = new ArcRotateCamera('orbit', -Math.PI / 2, .79, this.overviewRadius(), new Vector3(0, .8, 1.3), scene);
    this.camera.fov = .82;
    this.camera.lowerRadiusLimit = .65; this.camera.upperRadiusLimit = 65;
    this.camera.lowerBetaLimit = .15; this.camera.upperBetaLimit = 1.42;
    this.camera.minZ = .02; this.camera.maxZ = 250;
    this.camera.panningSensibility = 450; this.camera.wheelDeltaPercentage = .018;
    this.camera.pinchDeltaPercentage = .015;
    if (this.mobile) this.attachTouch(); else this.camera.attachControl(this.canvas, true);
    const ambient = new HemisphericLight('ambient', Vector3.Up(), scene);
    ambient.intensity = 2; ambient.specular.setAll(0);
    const key = new DirectionalLight('architectural-key', new Vector3(-20, -5, -5), scene);
    key.intensity = 25; key.specular.setAll(0);
    const rim = new DirectionalLight('architectural-rim', new Vector3(0, -5, 5), scene);
    rim.intensity = 5; rim.specular.setAll(0);
    this.createSiteGround();
    this.glow = new GlowLayer('architectural-glow', scene, { mainTextureFixedSize: this.mobile ? 512 : 1024, blurKernelSize: 16 });
    this.glow.intensity = .38;
    await import('@babylonjs/loaders/glTF');
    if (this.destroyed) return '';
    const suffix = this.mobile ? 'mobile' : 'desktop';
    const compressed = new URLSearchParams(location.search).get('textures') === 'ktx2';
    const farLod = new URLSearchParams(location.search).get('lod') === 'far';
    if (compressed) configureLocalKtxDecoder(this.mobile);
    onProgress('加载精细园区 · 建筑与道路纹理…');
    const campus = await this.loadModel(`campus-${suffix}-v2`, compressed, onProgress);
    if (this.destroyed) return '';
    for (const mesh of campus.meshes) { mesh.isPickable = false; mesh.renderingGroupId=mesh.material?.name.includes('ground')?0:1; mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true; }
    this.styleMaterials();
    onProgress('实例化精细车辆…');
    const [cars, placementResponse, routeResponse, rigResponse] = await Promise.all([
      this.loadModel(`vehicle-${suffix}-v3`, compressed, onProgress),
      fetch(new URL('models/vehicle-placements-v3.json', document.baseURI)),
      fetch(new URL('models/traffic-routes-v3.json', document.baseURI)),
      fetch(new URL('models/vehicle-rig-v3.json', document.baseURI))
    ]);
    if (this.destroyed) return '';
    if (!placementResponse.ok || !routeResponse.ok || !rigResponse.ok) throw new Error('Vehicle data failed');
    const placements = await placementResponse.json() as { matrices: number[][] };
    this.batches = new ParkingVehicleBatches(placements.matrices, new URLSearchParams(location.search).get('instances') === 'single' ? 'single' : 'adaptive');
    const traffic = await routeResponse.json() as TrafficRoutes;
    this.rig = await rigResponse.json() as VehicleRig;
    const lowMeshes = new Map<string, Mesh>();
    if (farLod) {
      const materials = new Set(scene.materials), textures = new Set(scene.textures);
      try {
        const low = await this.loadModel(`vehicle-${suffix}-v3-far`, false, onProgress);
        for (const mesh of low.meshes) if (mesh instanceof Mesh && mesh.getTotalVertices()) {
          const high = cars.meshes.find(m => m.name === mesh.name);
          if (high?.material) { mesh.material = high.material; mesh.setEnabled(false); lowMeshes.set(mesh.name, mesh); }
        }
        // The far mesh reuses the original materials/textures, not a second
        // decoded copy of the same texture set.
        scene.materials.filter(m => !materials.has(m)).forEach(m => m.dispose());
        scene.textures.filter(t => !textures.has(t)).forEach(t => t.dispose());
      } catch { this.variantFallback = true; onProgress('远景 LOD 已回退至原始精细车辆…'); }
    }
    this.fleet = traffic.vehicles.map((definition, i) => {
      const route = traffic.routes.find(r => r.id === definition.route)!;
      const node = new TransformNode(`moving-vehicle-${i}`, scene);
      node.scaling.setAll(this.rig!.scale);
      node.rotationQuaternion = Quaternion.Identity();
      const wheels = this.rig!.wheels.map(wheel => {
        const pivot = new TransformNode(`moving-${i}-wheel-${wheel.id}`, scene);
        pivot.parent = node; pivot.position.copyFromFloats(wheel.pivot[0], wheel.pivot[1], wheel.pivot[2]);
        pivot.rotationQuaternion = Quaternion.Identity();
        return pivot;
      });
      // Authored keyframes remain the motion input; vehicle trajectories have no visual meshes.
      return { node, wheels, route, offset: definition.offset, speed: definition.speed, yaw: 0, wheelAngle: 0 };
    });
    this.vehicle = this.fleet[0].node;
    for(const mesh of cars.meshes) {
      if (!(mesh instanceof Mesh) || !mesh.getTotalVertices()) continue;
      const templateMatrix = mesh.computeWorldMatrix(true).clone();
      const wheelMatch = /wheel-(\d+)/.exec(mesh.name);
      const wheelIndex = wheelMatch ? Number(wheelMatch[1]) : -1;
      for (const [i, movingVehicle] of this.fleet.entries()) {
        const moving = mesh.clone(`moving-${i}-${mesh.name}`, wheelIndex >= 0 ? movingVehicle.wheels[wheelIndex] : movingVehicle.node, true);
        if (moving) {
          moving.position.setAll(0); moving.scaling.setAll(1); moving.rotation.setAll(0); moving.rotationQuaternion = Quaternion.Identity();
          moving.isPickable = true; moving.metadata = { vehicle: true, parked: false, trafficIndex: i }; moving.renderingGroupId = 1;
          if (mesh.material instanceof PBRMaterial && mesh.material.name.includes('car-body')) {
            const body = mesh.material.clone(`moving-${i}-body`);
            body.albedoColor = [new Color3(.06,.65,.9), new Color3(.82,.87,.91), new Color3(.84,.46,.14)][i];
            body.emissiveColor = new Color3(.005,.04,.06); moving.material = body;
          }
        }
      }
      // Parked wheels have local pivots; bake each part's local transform into its instance matrix.
      const matrices = new Float32Array(placements.matrices.flatMap(matrix => Array.from(templateMatrix.multiply(Matrix.FromArray(matrix)).asArray())));
      mesh.parent = null; mesh.position.setAll(0); mesh.scaling.setAll(1); mesh.rotation.setAll(0); mesh.rotationQuaternion = Quaternion.Identity();
      mesh.isPickable = true; mesh.thinInstanceEnablePicking = true; mesh.metadata = { vehicle: true,parked:true };
      mesh.renderingGroupId=1;
      mesh.thinInstanceSetBuffer('matrix',matrices,16,true);
      // Aggregate instance bounds are already computed; neither these matrices
      // nor their identity parent transform change after loading.
      mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true;
      mesh.alwaysSelectAsActiveMesh = true;
      this.batches.add(mesh, templateMatrix, lowMeshes.get(mesh.name));
    }
    this.batches.setLod(farLod && lowMeshes.size > 0);
    this.styleMaterials();
    this.createSign();
    this.updateVehicle(0);
    onProgress('预热材质与渲染管线…');
    // Prepare both single-instance and thin-instance defines before revealing
    // the scene. No camera/vehicle motion or image-quality setting is changed.
    const warmup = new Map<string, Promise<void>>();
    for (const mesh of scene.meshes) if (mesh.material && mesh.getTotalVertices() && mesh.isEnabled()) {
      const key = `${mesh.material.uniqueId}:${mesh.hasThinInstances ? 1 : 0}`;
      if (!warmup.has(key)) warmup.set(key, mesh.material.forceCompilationAsync(mesh, { useInstances: mesh.hasThinInstances }));
    }
    await Promise.all(warmup.values());
    if (this.destroyed) return '';
    await scene.whenReadyAsync();
    this.batches.update(this.camera, this.engine.getRenderHeight());
    // Prime Glow and blend shaders behind the existing opening animation.
    for (let i = 0; i < 2; i++) {
      this.engine.beginFrame(); scene.render(); this.engine.endFrame();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (this.destroyed) return '';
    }
    // Freeze immutable shaders, never dynamic vehicle transforms or camera controls.
    scene.materials.forEach(m => m.freeze());
    scene.onPointerObservable.add(info => {
      if (info.type === PointerEventTypes.POINTERDOWN) this.flight = undefined;
      if (!this.mobile && info.type === PointerEventTypes.POINTERPICK && info.pickInfo?.pickedMesh?.metadata?.vehicle) this.pickVehicle(info.pickInfo);
    });
    this.observer = new ResizeObserver(() => {
      this.applyQuality(this.quality); this.engine?.resize();
      if (!this.follow && !this.flight && this.camera && this.camera.radius > 19) this.camera.radius = this.overviewRadius();
    });
    this.observer.observe(this.canvas);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.lastStats = performance.now();
    this.engine.runRenderLoop(this.render);
    if (new URLSearchParams(location.search).get('profile') === '1') this.setProfiling(true);
    this.onStats({fps:0,meshes:scene.meshes.length,backend:this.backend,quality:this.quality,renderWidth:this.engine.getRenderWidth(),renderHeight:this.engine.getRenderHeight()});
    return `精细园区 · ${this.mobile ? '移动 LOD' : '原始建筑细节'} · 126 辆实例化车辆${this.ktxLoaded ? ' · KTX2 保真纹理' : ''}${this.variantFallback ? ' · 原图回退已生效' : ''}`;
  }

  private async loadModel(name: string, compressed: boolean, onProgress: (value: string) => void) {
    const { ImportMeshAsync } = await import('@babylonjs/core/Loading/sceneLoader');
    const scene = this.scene!;
    const load = async (variant: boolean) => {
      const meshes = new Set(scene.meshes), nodes = new Set(scene.transformNodes), materials = new Set(scene.materials), textures = new Set(scene.textures);
      try {
        return await ImportMeshAsync(new URL(`models/${name}${variant ? '-ktx2' : ''}.glb?rev=render-2`, document.baseURI).href, scene,
          { onProgress: e => onProgress(e.lengthComputable ? `精细模型 ${Math.round(e.loaded / e.total * 100)}%` : '加载精细模型…') });
      } catch (error) {
        // Dispose only resources introduced by this import. Preserve the campus,
        // shared lights and any previously loaded original model on fallback.
        scene.meshes.filter(m => !meshes.has(m)).forEach(m => m.dispose(false, false));
        scene.transformNodes.filter(n => !nodes.has(n)).forEach(n => n.dispose(false, false));
        scene.materials.filter(m => !materials.has(m)).forEach(m => m.dispose());
        scene.textures.filter(t => !textures.has(t)).forEach(t => t.dispose());
        throw error;
      }
    };
    if (compressed) {
      try { const result = await load(true); this.ktxLoaded++; return result; }
      catch (error) { if (this.destroyed) throw error; this.variantFallback = true; onProgress('压缩纹理加载中断，正在回退原图…'); }
    }
    return load(false);
  }

  private styleMaterials() {
    if (!this.scene) return;
    for(const material of this.scene.materials) {
      if (!(material instanceof PBRMaterial)) continue;
      material.unfreeze();
      const name = material.name;
      material.environmentIntensity = .4;
      material.forceIrradianceInFragment = false;
      if(name.includes('building')) {
        material.albedoColor = new Color3(.0008,.00226,.00552);
        material.alpha = .99; material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
        material.alphaMode = Constants.ALPHA_MAXIMIZED; material.separateCullingPass = true;
      } else if(name.includes('window-glow')) {
        material.alpha = 0;
      } else if(name.includes('-window-')) {
        material.metallic = .6; material.roughness = .2; material.unlit = true;
        material.albedoColor = new Color3(.008373,.0242,.08464);
        material.alpha = .61; material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
        material.alphaMode = Constants.ALPHA_MAXIMIZED;
      } else if(name.includes('ground')) {
        material.unlit=true;material.albedoColor = new Color3(.004,.007,.011); material.metallic = 0; material.roughness = 1;
      } else if(name.includes('parking-glow')) {
        material.emissiveColor = new Color3(.016,.24,.36); material.alpha = 1;
      } else if(name.includes('parking-base')) {
        material.alpha=1; material.albedoColor=new Color3(.012,.025,.045);
        material.transparencyMode=PBRMaterial.PBRMATERIAL_OPAQUE;
      } else if(name.includes('road-marking')) {
        material.albedoColor = new Color3(.062,.114,.184); material.metallic=.3; material.roughness=.8;
        material.emissiveColor = new Color3(.006,.012,.024);
      } else if(name.includes('landscape')) {
        material.albedoColor=new Color3(.005,.012,.024); material.alpha=.99;
        material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND; material.alphaMode=Constants.ALPHA_MAXIMIZED;
      } else if(name.includes('foundation')) {
        material.unlit=true; material.alpha=.35; material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
      } else if(name.includes('lamp')) {
        material.emissiveColor=new Color3(.07,.21,.24);
      } else if(name.includes('gate')) {
        material.emissiveColor=new Color3(.36,.16,.015);
      } else if(name.includes('car-body')) {
        material.metallic=.85; material.roughness=.85; material.albedoColor=new Color3(.24,.62,.75);
      } else if(name.includes('car-glass')) {
        material.alpha=.35; material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
      }
      for(const texture of material.getActiveTextures()) if(texture instanceof Texture) texture.anisotropicFilteringLevel=this.mobile?8:16;
    }
  }
  private createSiteGround() {
    const minor:Vector3[][]=[],major:Vector3[][]=[];
    for(let x=-60;x<=60;x+=2){const target=x%10===0?major:minor;target.push([new Vector3(x,-.04,-50),new Vector3(x,-.04,50)]);}
    for(let z=-50;z<=50;z+=2){const target=z%10===0?major:minor;target.push([new Vector3(-60,-.04,z),new Vector3(60,-.04,z)]);}
    for(const [name,lines,color] of [['minor-grid',minor,new Color3(.025,.05,.075)],['major-grid',major,new Color3(.06,.12,.18)]] as const){
      const grid=CreateLineSystem(name,{lines},this.scene);grid.color=color;grid.alpha=.75;grid.isPickable=false;grid.freezeWorldMatrix();
    }
  }
  private createSign() {
    const texture=new DynamicTexture('generic-sign',{width:1280,height:256},this.scene,true);
    texture.hasAlpha=true;texture.drawText('某某中医院',null,178,'bold 144px Microsoft YaHei, sans-serif','#c4eaff','transparent',true);
    texture.uScale=-1;texture.uOffset=1;
    const material=new StandardMaterial('generic-sign-material',this.scene);
    material.diffuseTexture=texture;material.emissiveTexture=texture;material.opacityTexture=texture;
    material.disableLighting=true;material.backFaceCulling=true;
    for(const [side,z,angle] of [['front',6.015,Math.PI],['back',6.13,0]] as const){
      const sign=CreatePlane(`generic-rooftop-sign-${side}`,{width:3.0,height:.6},this.scene);
      sign.position.set(-8.15,6.59,z);sign.rotation.y=angle;sign.isPickable=false;
      sign.material=material;sign.freezeWorldMatrix();
    }
  }
  private attachTouch() {
    const pointers=new Map<number,{x:number;y:number}>();
    let start={x:0,y:0},moved=false;
    const coordinates=(e:PointerEvent)=>{const rect=this.canvas.getBoundingClientRect();return matchMedia('(orientation: portrait)').matches?{x:e.clientY-rect.top,y:rect.right-e.clientX}:{x:e.clientX-rect.left,y:e.clientY-rect.top};};
    const distance=()=>{const[a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
    const down=(e:PointerEvent)=>{if(this.follow)return;this.flight=undefined;const p=coordinates(e);pointers.set(e.pointerId,p);start=p;moved=false;this.canvas.setPointerCapture(e.pointerId);};
    const move=(e:PointerEvent)=>{
      const old=pointers.get(e.pointerId);if(!old||!this.camera)return;
      const before=distance(),p=coordinates(e);pointers.set(e.pointerId,p);
      if(Math.hypot(p.x-start.x,p.y-start.y)>5)moved=true;
      if(pointers.size===1){this.camera.alpha-=(p.x-old.x)*.004;this.camera.beta=Math.max(.15,Math.min(1.42,this.camera.beta+(p.y-old.y)*.004));}
      else {const after=distance();if(before>0&&after>0)this.camera.radius=Math.max(.65,Math.min(65,this.camera.radius*before/after));}
    };
    const up=(e:PointerEvent)=>{if(!moved&&pointers.size===1&&this.scene){const p=coordinates(e),pick=this.scene.pick(p.x,p.y);if(pick?.pickedMesh?.metadata?.vehicle)this.pickVehicle(pick);}pointers.delete(e.pointerId);};
    const cancel=(e:PointerEvent)=>pointers.delete(e.pointerId);
    this.canvas.addEventListener('pointerdown',down);this.canvas.addEventListener('pointermove',move);this.canvas.addEventListener('pointerup',up);this.canvas.addEventListener('pointercancel',cancel);
    this.removeTouch=()=>{this.canvas.removeEventListener('pointerdown',down);this.canvas.removeEventListener('pointermove',move);this.canvas.removeEventListener('pointerup',up);this.canvas.removeEventListener('pointercancel',cancel);pointers.clear();};
  }
  private overviewRadius() { const aspect=this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight);return aspect<1.4?33:aspect>2.1?25:28; }
  private pickVehicle(pick:PickingInfo){
    if(!pick.pickedPoint)return;
    const parked = !!pick.pickedMesh?.metadata?.parked;
    const parkedIndex = pick.pickedMesh?.metadata?.parkedIndices?.[pick.thinInstanceIndex] ?? pick.thinInstanceIndex;
    this.onPick('vehicle',{parked,position:pick.pickedPoint.clone(),index:parked?parkedIndex:pick.pickedMesh!.metadata.trafficIndex});
  }
  private fly(to:Vector3,radius:number,beta=.85,alpha=this.camera?.alpha??-Math.PI/2) {
    if(!this.camera)return;
    this.setFollowing(false);this.orbit=false;
    this.clearCameraInertia();
    this.flight={start:performance.now(),from:this.camera.target.clone(),to,radiusFrom:this.camera.radius,radiusTo:radius,betaFrom:this.camera.beta,betaTo:beta,alphaFrom:this.camera.alpha,alphaTo:alpha};
  }
  private updateVehicle(delta:number) {
    if(!this.fleet.length || !this.rig)return;
    if(this.vehiclePaused && this.trafficInitialized)return;
    if(!this.vehiclePaused)this.vehicleTime+=delta;
    for (const moving of this.fleet) {
      const pose = sampleRoute(moving.route, moving.offset + this.vehicleTime * moving.speed, moving.yaw);
      moving.node.position.set(pose.x, .008, pose.z);
      const distance = moving.previous ? Vector3.Distance(moving.previous, moving.node.position) : 0;
      const wrapped = moving.previousTime !== undefined && pose.time < moving.previousTime;
      if (!wrapped && distance < 1) moving.wheelAngle = rollWheel(moving.wheelAngle, distance, this.rig.wheels[0].radius * this.rig.scale);
      moving.yaw = nearestAngle(moving.yaw, pose.yaw);
      Quaternion.RotationAxisToRef(Vector3.UpReadOnly, moving.yaw, moving.node.rotationQuaternion!);
      for (const wheel of moving.wheels) Quaternion.RotationAxisToRef(Vector3.RightReadOnly, moving.wheelAngle, wheel.rotationQuaternion!);
      moving.previous ??= new Vector3(); moving.previous.copyFrom(moving.node.position); moving.previousTime = pose.time;
    }
    this.trafficInitialized = true;
  }
  private clearCameraInertia() {
    if (!this.camera) return;
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = this.camera.inertialPanningY = 0;
  }
  private setFollowing(value: boolean) {
    this.follow = value; this.clearCameraInertia();
    if (!this.mobile && this.camera) { if (value) this.camera.detachControl(); else this.camera.attachControl(this.canvas, true); }
  }
  private tailPose() {
    const moving = this.fleet[this.selectedTrafficIndex];
    return tailCameraPose(moving.node.position.x, moving.node.position.y, moving.node.position.z, moving.yaw, this.tail);
  }
  private applyTailCamera() {
    if (!this.camera || !this.fleet.length) return;
    const pose = this.tailPose();
    this.tailTarget.copyFromFloats(pose.target[0], pose.target[1], pose.target[2]);
    this.camera.setTarget(this.tailTarget, false, true, true);
    this.camera.alpha = pose.alpha; this.camera.beta = pose.beta; this.camera.radius = pose.radius;
    this.clearCameraInertia();
  }
  private render=()=>{
    if(!this.engine||!this.scene||!this.camera||this.destroyed||document.hidden)return;
    const now=performance.now(),interval=this.mobile||this.adaptiveCadence||this.quality==='low'?1000/30:1000/60;
    if(now-this.lastFrame<interval-1)return;
    const delta=this.lastFrame?Math.min((now-this.lastFrame)/1000,.1):0;this.lastFrame=now;
    this.updateVehicle(delta);
    this.navigationRoute?.update(now/1000);
    if(this.flight){const f=this.flight,t=Math.min(1,(now-f.start)/1050),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      if(this.follow){const pose=this.tailPose();f.to.copyFromFloats(pose.target[0],pose.target[1],pose.target[2]);f.alphaTo=nearestAngle(f.alphaFrom,pose.alpha);f.radiusTo=pose.radius;f.betaTo=pose.beta;}
      Vector3.LerpToRef(f.from,f.to,e,this.flightTarget);this.camera.setTarget(this.flightTarget,false,true,true);this.camera.radius=f.radiusFrom+(f.radiusTo-f.radiusFrom)*e;this.camera.beta=f.betaFrom+(f.betaTo-f.betaFrom)*e;this.camera.alpha=f.alphaFrom+(f.alphaTo-f.alphaFrom)*e;if(t===1)this.flight=undefined;
    }
    if(this.orbit)this.camera.alpha+=delta*.065;
    if(this.follow&&!this.flight)this.applyTailCamera();
    this.batches?.update(this.camera, this.engine.getRenderHeight());
    this.scene.render();this.renderedFrames++;
    if(now-this.lastProjection>50){
      const viewport=this.camera.viewport.toGlobal(this.engine.getRenderWidth(),this.engine.getRenderHeight());
      const project=(id:ScenePin['id'],position:Vector3):ScenePin=>{const p=Vector3.Project(position,Matrix.IdentityReadOnly,this.scene!.getTransformMatrix(),viewport);return{id,x:p.x/this.engine!.getRenderWidth()*this.canvas.clientWidth,y:p.y/this.engine!.getRenderHeight()*this.canvas.clientHeight,visible:p.z>0&&p.z<1&&p.x>0&&p.y>0&&p.x<viewport.width&&p.y<viewport.height};};
      this.onProject([...this.zones.map(z=>project(z.id,new Vector3(z.position[0],.5,z.position[1]))),project('C-side',new Vector3(C_SIDE_POSITION.x,.5,C_SIDE_POSITION.z)),...(this.vehicle?[project('vehicle',this.vehicle.position.add(new Vector3(0,.5,0)))]:[])]);
      this.lastProjection=now;
    }
    if(now-this.lastStats>1500){
      const fps=Math.round(this.renderedFrames*1000/(now-this.lastStats));this.slowWindows=fps<22?this.slowWindows+1:0;
      if(this.quality==='auto'&&this.slowWindows>=3&&!this.adaptiveCadence){this.adaptiveCadence=true;if(this.glow)this.glow.isEnabled=false;}
      this.onStats({fps,meshes:this.scene.meshes.length,backend:this.backend,quality:this.adaptiveCadence?'清晰优先 · 节能帧率':this.quality,renderWidth:this.engine.getRenderWidth(),renderHeight:this.engine.getRenderHeight(),profile:this.profiler?.snapshot(),visibleParked:this.batches?.visibleInstances,parkedLod:this.batches?.selectedLod});
      this.lastStats=now;this.renderedFrames=0;
    }
  };
  updateZones(zones:Zone[]){this.zones=zones;}
  focusPoint(x:number,z:number){if(Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x)<=40&&Math.abs(z)<=40)this.fly(new Vector3(x,.35,z),5.2,.9);}
  showNavigation(points:[number,number][]){
    this.clearNavigation();if(!this.scene||points.length<2)return;
    try{this.navigationRoute=new FlowingCampusRoute(this.scene,points,this.mobile);}catch{/* Invalid/zero-length paths do not paint a misleading line. */}
  }
  focusNavigation(points:[number,number][]){
    if(points.length<2||!points.every(p=>p.every(n=>Number.isFinite(n)&&Math.abs(n)<=40)))return;
    const view=navigationCameraFrame(points,this.canvas.clientWidth,this.canvas.clientHeight,this.mobile,this.camera?.fov);
    this.fly(new Vector3(view.x,.1,view.z),view.radius,.28,-Math.PI/2);
  }
  clearNavigation(){this.navigationRoute?.dispose();this.navigationRoute=undefined;}
  captureJpeg(){
    if(!this.scene||!this.engine)throw new Error('请等待场景加载完成');this.engine.beginFrame();this.scene.render();this.engine.endFrame();
    const out=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(this.canvas.width,this.canvas.height));
    out.width=Math.max(64,Math.round(this.canvas.width*scale));out.height=Math.max(64,Math.round(this.canvas.height*scale));
    out.getContext('2d')!.drawImage(this.canvas,0,0,out.width,out.height);return out.toDataURL('image/jpeg',.8);
  }
  applyQuality(quality:Quality){
    this.quality=quality;this.adaptiveCadence=false;this.slowWindows=0;
    this.engine?.setHardwareScalingLevel(resolutionScale(quality,this.mobile,window.devicePixelRatio,this.canvas.clientWidth,this.canvas.clientHeight));
    if(this.glow)this.glow.isEnabled=quality!=='low';
  }
  setOrbit(value:boolean){this.flight=undefined;this.setFollowing(false);this.orbit=value;}
  setPaused(value:boolean){this.vehiclePaused=value;}
  setProfiling(value:boolean){this.profiler?.dispose();this.profiler=value&&this.scene&&this.engine?new ParkingRenderProfiler(this.scene,this.engine):undefined;}
  focusZone(id:ZoneId){const view=zoneView(id);this.fly(new Vector3(view.x,.25,view.z),view.radius,view.beta);}
  focusVehicle(position?:Vector3,index=0){
    if(!this.fleet.length)return;
    if(position){this.fly(position,1.6,.96);return;}
    this.selectedTrafficIndex=Math.max(0,Math.min(this.fleet.length-1,index));this.vehicle=this.fleet[this.selectedTrafficIndex].node;
    const pose=this.tailPose();this.fly(Vector3.FromArray(pose.target),pose.radius,pose.beta,nearestAngle(this.camera?.alpha??0,pose.alpha));this.setFollowing(true);
  }
  followVehicle(value:boolean){this.setFollowing(value);this.orbit=false;this.flight=undefined;if(value)this.applyTailCamera();}
  reset(){this.fly(new Vector3(0,.8,1.3),this.overviewRadius(),.79,-Math.PI/2);}
  top(){this.fly(new Vector3(0,0,1.3),this.overviewRadius()+1,.15,-Math.PI/2);}
  dispose(){this.destroyed=true;this.clearNavigation();this.profiler?.dispose();this.observer?.disconnect();this.removeTouch?.();document.removeEventListener('visibilitychange',this.onVisibility);this.engine?.stopRenderLoop();this.batches?.dispose();this.scene?.dispose();this.engine?.dispose();}
}
