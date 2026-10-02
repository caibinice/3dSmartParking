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
import { CreateLineSystem, CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
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
import { nearestAngle, rollWheel, sampleRoute, tailCameraPose, type TrafficRoutes, type TrafficRoute, type VehicleRig } from './parking-traffic';

export interface SceneStats { fps: number; meshes: number; backend: string; quality: string; renderWidth: number; renderHeight: number; }
export interface ScenePin { id: ZoneId | 'vehicle'; x: number; y: number; visible: boolean; }
export interface VehiclePick { parked: boolean; position: Vector3; index: number; }
interface Flight { start: number; from: Vector3; to: Vector3; radiusFrom: number; radiusTo: number; betaFrom: number; betaTo: number; alphaFrom: number; alphaTo: number; }
interface MovingVehicle { node: TransformNode; wheels: TransformNode[]; route: TrafficRoute; offset: number; speed: number; yaw: number; wheelAngle: number; previous?: Vector3; previousTime?: number; }

export class ParkingScene {
  private engine?: AbstractEngine;
  private scene?: Scene;
  private camera?: ArcRotateCamera;
  private observer?: ResizeObserver;
  private glow?: GlowLayer;
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
  private fleet: MovingVehicle[] = [];
  private rig?: VehicleRig;
  private selectedTrafficIndex = 0;
  private routeLines: LinesMesh[] = [];
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
    const { ImportMeshAsync } = await import('@babylonjs/core/Loading/sceneLoader');
    await import('@babylonjs/loaders/glTF');
    if (this.destroyed) return '';
    const suffix = this.mobile ? 'mobile' : 'desktop';
    onProgress('加载精细园区 · 建筑与道路纹理…');
    const campus = await ImportMeshAsync(new URL(`models/campus-${suffix}-v2.glb`, document.baseURI).href, scene, {
      onProgress: e => onProgress(e.lengthComputable ? `精细园区 ${Math.round(e.loaded/e.total*100)}%` : '加载精细园区…')
    });
    if (this.destroyed) return '';
    for (const mesh of campus.meshes) { mesh.isPickable = false; mesh.renderingGroupId=mesh.material?.name.includes('ground')?0:1; mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); }
    this.styleMaterials();
    onProgress('实例化精细车辆…');
    const [cars, placementResponse, routeResponse, rigResponse] = await Promise.all([
      ImportMeshAsync(new URL(`models/vehicle-${suffix}-v3.glb`, document.baseURI).href, scene),
      fetch(new URL('models/vehicle-placements-v3.json', document.baseURI)),
      fetch(new URL('models/traffic-routes-v3.json', document.baseURI)),
      fetch(new URL('models/vehicle-rig-v3.json', document.baseURI))
    ]);
    if (this.destroyed) return '';
    if (!placementResponse.ok || !routeResponse.ok || !rigResponse.ok) throw new Error('Vehicle data failed');
    const placements = await placementResponse.json() as { matrices: number[][] };
    const traffic = await routeResponse.json() as TrafficRoutes;
    this.rig = await rigResponse.json() as VehicleRig;
    this.fleet = traffic.vehicles.map((definition, i) => {
      const route = traffic.routes.find(r => r.id === definition.route)!;
      const node = new TransformNode(`moving-vehicle-${i}`, scene);
      node.scaling.setAll(this.rig!.scale);
      const wheels = this.rig!.wheels.map(wheel => {
        const pivot = new TransformNode(`moving-${i}-wheel-${wheel.id}`, scene);
        pivot.parent = node; pivot.position.copyFromFloats(wheel.pivot[0], wheel.pivot[1], wheel.pivot[2]);
        return pivot;
      });
      const line = CreateLines(`driving-route-${i}`, { points: route.keyframes.map(f => new Vector3(f[1], .025, f[2])) }, scene);
      line.color = new Color3(.09, .45, .65); line.alpha = .7; line.isPickable = false; line.renderingGroupId = 1; line.setEnabled(false);
      this.routeLines.push(line);
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
      mesh.alwaysSelectAsActiveMesh = true;
    }
    this.styleMaterials();
    this.createSign();
    this.updateVehicle(0);
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
    this.onStats({fps:0,meshes:scene.meshes.length,backend:this.backend,quality:this.quality,renderWidth:this.engine.getRenderWidth(),renderHeight:this.engine.getRenderHeight()});
    return this.mobile ? '精细园区 · 移动 LOD · 126 辆实例化车辆' : '精细园区 · 原始建筑细节 · 126 辆实例化车辆';
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
    this.onPick('vehicle',{parked,position:pick.pickedPoint.clone(),index:parked?pick.thinInstanceIndex:pick.pickedMesh!.metadata.trafficIndex});
  }
  private fly(to:Vector3,radius:number,beta=.85,alpha=this.camera?.alpha??-Math.PI/2) {
    if(!this.camera)return;
    this.setFollowing(false);this.orbit=false;
    this.clearCameraInertia();
    this.flight={start:performance.now(),from:this.camera.target.clone(),to,radiusFrom:this.camera.radius,radiusTo:radius,betaFrom:this.camera.beta,betaTo:beta,alphaFrom:this.camera.alpha,alphaTo:alpha};
  }
  private updateVehicle(delta:number) {
    if(!this.fleet.length || !this.rig)return;
    if(!this.vehiclePaused)this.vehicleTime+=delta;
    for (const moving of this.fleet) {
      const pose = sampleRoute(moving.route, moving.offset + this.vehicleTime * moving.speed, moving.yaw);
      moving.node.position.set(pose.x, .008, pose.z);
      const distance = moving.previous ? Vector3.Distance(moving.previous, moving.node.position) : 0;
      const wrapped = moving.previousTime !== undefined && pose.time < moving.previousTime;
      if (!wrapped && distance < 1) moving.wheelAngle = rollWheel(moving.wheelAngle, distance, this.rig.wheels[0].radius * this.rig.scale);
      moving.yaw = pose.yaw; moving.node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), moving.yaw);
      for (const wheel of moving.wheels) wheel.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), moving.wheelAngle);
      moving.previous ??= new Vector3(); moving.previous.copyFrom(moving.node.position); moving.previousTime = pose.time;
    }
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
    return tailCameraPose(moving.node.position.x, moving.node.position.y, moving.node.position.z, moving.yaw);
  }
  private applyTailCamera() {
    if (!this.camera || !this.fleet.length) return;
    const pose = this.tailPose();
    this.camera.setTarget(Vector3.FromArray(pose.target));
    this.camera.alpha = pose.alpha; this.camera.beta = pose.beta; this.camera.radius = pose.radius;
    this.clearCameraInertia();
  }
  private render=()=>{
    if(!this.engine||!this.scene||!this.camera||this.destroyed||document.hidden)return;
    const now=performance.now(),interval=this.mobile||this.adaptiveCadence||this.quality==='low'?1000/30:1000/60;
    if(now-this.lastFrame<interval-1)return;
    const delta=this.lastFrame?Math.min((now-this.lastFrame)/1000,.1):0;this.lastFrame=now;
    this.updateVehicle(delta);
    if(this.flight){const f=this.flight,t=Math.min(1,(now-f.start)/1050),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      if(this.follow){const pose=this.tailPose();f.to=Vector3.FromArray(pose.target);f.alphaTo=nearestAngle(f.alphaFrom,pose.alpha);f.radiusTo=pose.radius;f.betaTo=pose.beta;}
      this.camera.setTarget(Vector3.Lerp(f.from,f.to,e));this.camera.radius=f.radiusFrom+(f.radiusTo-f.radiusFrom)*e;this.camera.beta=f.betaFrom+(f.betaTo-f.betaFrom)*e;this.camera.alpha=f.alphaFrom+(f.alphaTo-f.alphaFrom)*e;if(t===1)this.flight=undefined;
    }
    if(this.orbit)this.camera.alpha+=delta*.065;
    if(this.follow&&!this.flight)this.applyTailCamera();
    this.scene.render();this.renderedFrames++;
    if(now-this.lastProjection>50){
      const viewport=this.camera.viewport.toGlobal(this.engine.getRenderWidth(),this.engine.getRenderHeight());
      const project=(id:ZoneId|'vehicle',position:Vector3):ScenePin=>{const p=Vector3.Project(position,Matrix.IdentityReadOnly,this.scene!.getTransformMatrix(),viewport);return{id,x:p.x/this.engine!.getRenderWidth()*this.canvas.clientWidth,y:p.y/this.engine!.getRenderHeight()*this.canvas.clientHeight,visible:p.z>0&&p.z<1&&p.x>0&&p.y>0&&p.x<viewport.width&&p.y<viewport.height};};
      this.onProject([...this.zones.map(z=>project(z.id,new Vector3(z.position[0],.5,z.position[1]))),...(this.vehicle?[project('vehicle',this.vehicle.position.add(new Vector3(0,.5,0)))]:[])]);
      this.lastProjection=now;
    }
    if(now-this.lastStats>1500){
      const fps=Math.round(this.renderedFrames*1000/(now-this.lastStats));this.slowWindows=fps<22?this.slowWindows+1:0;
      if(this.quality==='auto'&&this.slowWindows>=3&&!this.adaptiveCadence){this.adaptiveCadence=true;if(this.glow)this.glow.isEnabled=false;}
      this.onStats({fps,meshes:this.scene.meshes.length,backend:this.backend,quality:this.adaptiveCadence?'清晰优先 · 节能帧率':this.quality,renderWidth:this.engine.getRenderWidth(),renderHeight:this.engine.getRenderHeight()});
      this.lastStats=now;this.renderedFrames=0;
    }
  };
  updateZones(zones:Zone[]){this.zones=zones;}
  applyQuality(quality:Quality){
    this.quality=quality;this.adaptiveCadence=false;this.slowWindows=0;
    this.engine?.setHardwareScalingLevel(resolutionScale(quality,this.mobile,window.devicePixelRatio,this.canvas.clientWidth,this.canvas.clientHeight));
    if(this.glow)this.glow.isEnabled=quality!=='low';
  }
  setOrbit(value:boolean){this.flight=undefined;this.setFollowing(false);this.orbit=value;}
  setPaused(value:boolean){this.vehiclePaused=value;}
  focusZone(id:ZoneId){const zone=this.zones.find(z=>z.id===id);if(zone)this.fly(new Vector3(zone.position[0],.25,zone.position[1]),9,.65);}
  focusVehicle(position?:Vector3,index=0){
    if(!this.fleet.length)return;
    if(position){this.fly(position,1.6,.96);return;}
    this.selectedTrafficIndex=Math.max(0,Math.min(this.fleet.length-1,index));this.vehicle=this.fleet[this.selectedTrafficIndex].node;
    const pose=this.tailPose();this.fly(Vector3.FromArray(pose.target),pose.radius,pose.beta,nearestAngle(this.camera?.alpha??0,pose.alpha));this.setFollowing(true);
  }
  showRoute(value:boolean){this.routeLines.forEach((line,i)=>line.setEnabled(value&&i===this.selectedTrafficIndex));}
  followVehicle(value:boolean){this.setFollowing(value);this.orbit=false;this.flight=undefined;if(value)this.applyTailCamera();}
  reset(){this.fly(new Vector3(0,.8,1.3),this.overviewRadius(),.79,-Math.PI/2);}
  top(){this.fly(new Vector3(0,0,1.3),this.overviewRadius()+1,.15,-Math.PI/2);}
  dispose(){this.destroyed=true;this.observer?.disconnect();this.removeTouch?.();document.removeEventListener('visibilitychange',this.onVisibility);this.engine?.stopRenderLoop();this.scene?.dispose();this.engine?.dispose();}
}
