import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export interface RoutePosition { x:number;z:number;dx:number;dz:number;remaining:number; }
/** Fit the route between the header/navigation chip and the bottom scene controls. */
export function navigationCameraFrame(points:[number,number][],width:number,height:number,mobile=false,fov=.82){
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const h=Math.max(1,height),aspect=Math.max(.5,width/h),top=mobile?108:164,bottom=mobile?82:104;
  const usable=Math.max(.3,Math.min(.85,1-(top+bottom)/h)),tan=Math.tan(fov/2);
  const radius=Math.min(65,Math.max(8,Math.max(maxZ-minZ,(maxX-minX)/aspect)/(2*tan*usable)*1.2));
  return {x:(minX+maxX)/2,z:(minZ+maxZ)/2+(top-bottom)/h*radius*tan/Math.cos(.28),radius};
}
/** Arc-length samples keep flow speed constant, including uneven road segments. */
export class CampusPolyline {
  readonly points:[number,number][]=[];
  readonly segments:{x:number;z:number;dx:number;dz:number;start:number;length:number}[]=[];
  readonly length:number;
  constructor(input:[number,number][]){
    if(input.length<2||input.length>40||!input.every(p=>p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=40)))throw new Error('导航路径范围无效');
    let total=0;
    for(const p of input){const old=this.points.at(-1);if(!old||Math.hypot(p[0]-old[0],p[1]-old[1])>.001)this.points.push([p[0],p[1]]);}
    for(let i=1;i<this.points.length;i++){const a=this.points[i-1],b=this.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);this.segments.push({x:a[0],z:a[1],dx:(b[0]-a[0])/length,dz:(b[1]-a[1])/length,start:total,length});total+=length;}
    if(total<=.001)throw new Error('起点和终点相同，无需绘制路线');this.length=total;
  }
  sample(distance:number,out:RoutePosition){
    const d=Math.max(0,Math.min(this.length,distance));
    const segment=this.segments.find(s=>d<s.start+s.length)??this.segments[this.segments.length-1];
    const local=d-segment.start;out.x=segment.x+segment.dx*local;out.z=segment.z+segment.dz*local;out.dx=segment.dx;out.dz=segment.dz;out.remaining=segment.length-local;return out;
  }
}

/** Two bounded road draw calls plus an endpoint. No replacement of original GLB/materials. */
export class FlowingCampusRoute {
  readonly path:CampusPolyline;
  private readonly meshes:Mesh[]=[];
  private readonly materials:StandardMaterial[]=[];
  private readonly dashes:Mesh;
  private readonly endpoint:StandardMaterial;
  private readonly matrices:Float32Array;
  private readonly count:number;
  private readonly sample:RoutePosition={x:0,z:0,dx:0,dz:1,remaining:0};
  private readonly scaling=new Vector3(1,1,1);
  private readonly position=new Vector3();
  private readonly rotation=Quaternion.Identity();
  private readonly matrix=Matrix.Identity();
  constructor(scene:Scene,points:[number,number][],mobile=false){
    this.path=new CampusPolyline(points);this.count=Math.min(mobile?12:20,Math.max(4,Math.ceil(this.path.length/1.5)));this.matrices=new Float32Array(this.count*16);
    const material=(name:string,color:string,alpha=1)=>{const m=new StandardMaterial(name,scene);m.disableLighting=true;m.emissiveColor=Color3.FromHexString(color);m.diffuseColor.setAll(0);m.specularColor.setAll(0);m.alpha=alpha;this.materials.push(m);return m;};
    // Group 1 is after the ground (group 0), while buildings/vehicles still depth-occlude it.
    const register=(mesh:Mesh,m:StandardMaterial)=>{mesh.material=m;mesh.isPickable=false;mesh.renderingGroupId=1;mesh.metadata={navigation:true};this.meshes.push(mesh);return mesh;};
    const base=register(CreateTube('assistant-navigation-base',{path:this.path.points.map(p=>new Vector3(p[0],.065,p[1])),radius:mobile?.032:.025,tessellation:6,cap:Mesh.CAP_ALL},scene),material('navigation-base-material','#218e98',.75));
    base.freezeWorldMatrix();
    this.dashes=register(CreateBox('assistant-navigation-flow',{width:mobile?.09:.075,height:.024,depth:1},scene),material('navigation-flow-material','#b8fff0'));
    this.dashes.thinInstanceSetBuffer('matrix',this.matrices,16,false);this.dashes.alwaysSelectAsActiveMesh=true;
    const end=this.path.points.at(-1)!;
    this.endpoint=material('navigation-endpoint-material','#8dffdd',.85);
    const pin=register(CreateCylinder('assistant-navigation-end',{height:.014,diameter:mobile?.36:.3,tessellation:20},scene),this.endpoint);pin.position.set(end[0],.082,end[1]);pin.freezeWorldMatrix();
    this.update(0);
  }
  update(seconds:number){
    const distance=seconds*1.8;
    for(let i=0;i<this.count;i++){
      const offset=(distance+i*this.path.length/this.count)%this.path.length;
      this.path.sample(offset,this.sample);
      // Clip each dash at the road corner rather than cutting through its inside.
      const length=Math.max(.01,Math.min(.42,this.sample.remaining));
      this.position.set(this.sample.x+this.sample.dx*length/2,.09,this.sample.z+this.sample.dz*length/2);
      this.scaling.z=length;Quaternion.RotationYawPitchRollToRef(Math.atan2(this.sample.dx,this.sample.dz),0,0,this.rotation);
      Matrix.ComposeToRef(this.scaling,this.rotation,this.position,this.matrix);this.matrix.copyToArray(this.matrices,i*16);
    }
    this.dashes.thinInstanceBufferUpdated('matrix');this.endpoint.alpha=.55+.35*(.5+.5*Math.sin(seconds*4));
  }
  dispose(){this.meshes.forEach(m=>m.dispose(false,false));this.materials.forEach(m=>m.dispose());}
}
