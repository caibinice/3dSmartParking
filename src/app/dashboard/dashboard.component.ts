import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ParkingStore } from '../core/parking-store';
import { Quality, ZoneId } from '../core/parking-data';
import type { ParkingScene, SceneStats, ScenePin, VehiclePick } from '../core/parking-scene';
type Panel = 'overview' | 'zones' | 'records' | 'alarms' | 'settings' | 'views' | null;
@Component({
  selector: 'app-dashboard', imports: [RouterLink, FormsModule],
  templateUrl: './dashboard.component.html', styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pins') pins!: ElementRef<HTMLElement>;
  readonly store=inject(ParkingStore);
  readonly mobile=inject(ActivatedRoute).snapshot.data['mobile']===true;
  readonly selected=signal<ZoneId|null>(null);
  readonly selectedZone=computed(()=>this.store.zones().find(z=>z.id===this.selected()));
  readonly vehicleSelected=signal(false);
  readonly parkedVehicle=signal(false);
  readonly vehicleIndex=signal(0);
  readonly following=signal(false);
  readonly panel=signal<Panel>(null);
  readonly ready=signal(false);
  readonly progress=signal('准备精细三维场景…');
  readonly status=signal('');
  readonly error=signal(false);
  readonly stats=signal<SceneStats>({fps:0,meshes:0,backend:'WebGL',quality:'auto',renderWidth:0,renderHeight:0});
  readonly now=signal(new Date());
  readonly help=signal(false);
  readonly paused=signal(false);
  readonly orbit=signal(false);
  readonly clean=signal(false);
  readonly showPins=signal(true);
  readonly toast=signal('');
  readonly search=signal('');
  readonly filteredEvents=computed(()=>this.store.events().filter(e=>`${e.plate}${e.zone}${e.action}`.toLowerCase().includes(this.search().toLowerCase())));
  readonly activeAlarms=computed(()=>this.store.alarms().filter(a=>!a.acknowledged).length);
  readonly recommended=computed(()=>[...this.store.zones()].sort((a,b)=>b.capacity-b.occupied-(a.capacity-a.occupied))[0]);
  quality:Quality='auto';
  readonly trend=[24,31,27,42,58,65,72,66,54,49,61,63];
  private scene?:ParkingScene;
  private timer?:ReturnType<typeof setInterval>;
  private toastTimer?:ReturnType<typeof setTimeout>;
  private disposed=false;
  async ngAfterViewInit(){
    for(let i=0;i<6;i++)this.store.advance();
    await this.loadScene();
    if(this.disposed)return;
    this.timer=setInterval(()=>{this.now.set(new Date());if(!this.paused()&&!document.hidden){this.store.advance();this.scene?.updateZones(this.store.zones());}},5000);
  }
  async loadScene(){
    this.scene?.dispose();this.ready.set(false);this.error.set(false);
    this.progress.set('准备精细三维场景…');
    try{
      const {ParkingScene}=await import('../core/parking-scene');
      if(this.disposed)return;
      this.scene=new ParkingScene(this.canvas.nativeElement,this.mobile,(id,vehicle)=>id==='vehicle'?this.selectVehicle(vehicle):this.selectZone(id),stats=>this.stats.set(stats),pins=>this.projectPins(pins));
      const status=await this.scene.init(value=>this.progress.set(value));
      if(!this.disposed){this.scene.applyQuality(this.quality);this.status.set(status);this.ready.set(true);}
    }catch{
      if(!this.disposed){this.scene?.dispose();this.error.set(true);this.progress.set('精细模型加载中断，请检查网络后重试');}
    }
  }
  private projectPins(pins:ScenePin[]){
    for(const pin of pins){const element=this.pins.nativeElement.querySelector<HTMLElement>(`[data-pin="${pin.id}"]`);if(!element)continue;element.style.transform=`translate(${pin.x.toFixed(1)}px,${pin.y.toFixed(1)}px) translate(-50%,-100%)`;element.style.visibility=pin.visible?'visible':'hidden';}
  }
  togglePanel(panel:Panel){this.panel.update(current=>current===panel?null:panel);this.clean.set(false);}
  selectZone(id:ZoneId){this.selected.set(id);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.focusZone(id);this.scene?.showRoute(false);this.panel.set(null);}
  selectVehicle(vehicle?:VehiclePick){this.selected.set(null);this.vehicleSelected.set(true);this.parkedVehicle.set(vehicle?.parked??false);this.vehicleIndex.set((vehicle?.index??0)+1);this.following.set(!vehicle?.parked);this.orbit.set(false);this.panel.set(null);this.scene?.focusVehicle(vehicle?.parked?vehicle.position:undefined);this.scene?.showRoute(!vehicle?.parked);}
  toggleFollow(){this.following.update(v=>!v);this.scene?.followVehicle(this.following());}
  reset(){this.selected.set(null);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.reset();this.scene?.showRoute(false);this.panel.set(null);}
  top(){this.selected.set(null);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.top();this.scene?.showRoute(false);this.panel.set(null);}
  toggleOrbit(){this.orbit.update(v=>!v);this.following.set(false);this.scene?.setOrbit(this.orbit());this.panel.set(null);}
  togglePause(){this.paused.update(v=>!v);this.scene?.setPaused(this.paused());}
  toggleClean(){this.clean.update(v=>!v);this.panel.set(null);this.help.set(false);this.selected.set(null);this.vehicleSelected.set(false);this.scene?.showRoute(false);}
  changeQuality(){this.scene?.applyQuality(this.quality);}
  acknowledge(id:number){this.store.acknowledge(id);this.message('演示告警已确认');}
  exportEvents(){
    const rows=[['时间','模拟车牌','区域','动作'],...this.filteredEvents().map(e=>[e.time,e.plate,e.zone,e.action])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='parking-demo-events.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);this.message('已导出当前筛选的模拟记录');
  }
  async fullscreen(){
    try{
      const shell=this.canvas.nativeElement.closest('.shell') as HTMLElement;
      if(!document.fullscreenElement)await shell.requestFullscreen();else{await document.exitFullscreen();return;}
      if(this.mobile){const orientation=screen.orientation as ScreenOrientation&{lock?:(value:string)=>Promise<void>};try{await orientation.lock?.('landscape');}catch{this.message('页面已全屏，横屏布局自动适配');}}
    }catch{this.message('可手动旋转设备，页面已提供横屏适配');}
  }
  private message(value:string){this.toast.set(value);clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>this.toast.set(''),3500);}
  closeVehicle(){this.vehicleSelected.set(false);this.following.set(false);this.scene?.followVehicle(false);this.scene?.showRoute(false);}
  @HostListener('document:keydown.escape')close(){this.help.set(false);this.panel.set(null);this.selected.set(null);this.closeVehicle();if(this.clean())this.clean.set(false);}
  ngOnDestroy(){this.disposed=true;clearInterval(this.timer);clearTimeout(this.toastTimer);this.scene?.dispose();}
}
