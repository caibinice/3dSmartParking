import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ParkingStore } from '../core/parking-store';
import { Quality, ZoneId } from '../core/parking-data';
import type { ParkingScene, SceneStats, ScenePin, VehiclePick } from '../core/parking-scene';
import { ParkingAssistantComponent, type TourState } from '../assistant/parking-assistant.component';
import { CAMPUS_TOUR, parseAgentAction, snapshot, type AgentAction } from '../core/parking-agent';
import { validRoute, type ParkingCatalog, type ParkingDatabaseSnapshot, type ParkingPoi, type ParkingRoute } from '../core/parking-operations';
type Panel = 'overview' | 'zones' | 'records' | 'alarms' | 'settings' | 'views' | null;
@Component({
  selector: 'app-dashboard', imports: [RouterLink, FormsModule, ParkingAssistantComponent],
  templateUrl: './dashboard.component.html', styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pins') pins!: ElementRef<HTMLElement>;
  @ViewChild('openingVideo') openingVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild(ParkingAssistantComponent) assistant?: ParkingAssistantComponent;
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
  readonly introDone=signal(false);
  readonly introFailed=signal(false);
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
  readonly tour=signal<TourState>({active:false,paused:false,index:0,title:'',narration:''});
  readonly navigation=signal<ParkingRoute|null>(null);
  readonly poiLabel=signal('');
  private poiCatalog?:ParkingCatalog;
  private tourSteps=CAMPUS_TOUR;
  readonly filteredEvents=computed(()=>this.store.events().filter(e=>`${e.plate}${e.zone}${e.action}`.toLowerCase().includes(this.search().toLowerCase())));
  readonly activeAlarms=computed(()=>this.store.alarms().filter(a=>!a.acknowledged).length);
  readonly recommended=computed(()=>[...this.store.zones()].sort((a,b)=>b.capacity-b.occupied-(a.capacity-a.occupied))[0]);
  quality:Quality='auto';
  textures=new URLSearchParams(location.search).get('textures')==='ktx2'?'ktx2':'original';
  farLod=new URLSearchParams(location.search).get('lod')==='far';
  renderer=new URLSearchParams(location.search).get('renderer')==='webgpu'?'webgpu':'webgl';
  readonly profiling=signal(new URLSearchParams(location.search).get('profile')==='1');
  readonly trend=[24,31,27,42,58,65,72,66,54,49,61,63];
  private scene?:ParkingScene;
  private timer?:ReturnType<typeof setInterval>;
  private toastTimer?:ReturnType<typeof setTimeout>;
  private introTimer?:ReturnType<typeof setTimeout>;
  private tourTimer?:ReturnType<typeof setTimeout>;
  private lastAgentResult='';
  private disposed=false;
  async ngAfterViewInit(){
    for(let i=0;i<6;i++)this.store.advance();
    await this.loadScene();
    if(this.disposed)return;
    this.timer=setInterval(()=>{this.now.set(new Date());if(!this.paused()&&!document.hidden){this.store.advance();this.scene?.updateZones(this.store.zones());}},5000);
  }
  async loadScene(){
    this.scene?.dispose();this.ready.set(false);this.error.set(false);this.introDone.set(false);this.introFailed.set(false);clearTimeout(this.introTimer);
    this.progress.set('准备精细三维场景…');
    try{
      const {ParkingScene}=await import('../core/parking-scene');
      if(this.disposed)return;
      this.scene=new ParkingScene(this.canvas.nativeElement,this.mobile,(id,vehicle)=>id==='vehicle'?this.selectVehicle(vehicle):this.selectZone(id),stats=>this.stats.set(stats),pins=>this.projectPins(pins));
      const status=await this.scene.init(value=>this.progress.set(value));
      if(!this.disposed){
        this.scene.applyQuality(this.quality);this.status.set(status);this.ready.set(true);
        if(this.introFailed())this.finishIntro();
        else this.introTimer=setTimeout(()=>this.finishIntro(),12000);
      }
    }catch{
      if(!this.disposed){this.scene?.dispose();this.error.set(true);this.progress.set('精细模型加载中断，请检查网络后重试');}
    }
  }
  playIntro(){const video=this.openingVideo?.nativeElement;if(!video)return;video.muted=true;void video.play().catch(()=>this.introUnavailable());}
  loopIntro(){const video=this.openingVideo?.nativeElement;if(video&&!this.ready()&&!this.error()&&video.currentTime>=5.4)video.currentTime=.05;}
  finishIntro(){
    if(!this.ready()){const video=this.openingVideo?.nativeElement;if(video){video.currentTime=0;this.playIntro();}return;}
    this.openingVideo?.nativeElement.pause();this.introDone.set(true);clearTimeout(this.introTimer);
  }
  introUnavailable(){this.introFailed.set(true);this.introDone.set(true);}
  private projectPins(pins:ScenePin[]){
    for(const pin of pins){const element=this.pins.nativeElement.querySelector<HTMLElement>(`[data-pin="${pin.id}"]`);if(!element)continue;element.style.transform=`translate(${pin.x.toFixed(1)}px,${pin.y.toFixed(1)}px) translate(-50%,-100%)`;element.style.visibility=pin.visible?'visible':'hidden';}
  }
  togglePanel(panel:Panel){this.assistant?.hide();this.panel.update(current=>current===panel?null:panel);this.clean.set(false);}
  selectZone(id:ZoneId,fromAgent=false){if(!fromAgent)this.manualSceneInput();this.selected.set(id);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.focusZone(id);this.scene?.showRoute(false);this.panel.set(null);}
  selectVehicle(vehicle?:VehiclePick,trafficIndex=0,fromAgent=false){if(!fromAgent)this.manualSceneInput();this.selected.set(null);this.vehicleSelected.set(true);this.parkedVehicle.set(vehicle?.parked??false);this.vehicleIndex.set((vehicle?.index??trafficIndex)+1);this.following.set(!vehicle?.parked);this.orbit.set(false);this.panel.set(null);this.scene?.focusVehicle(vehicle?.parked?vehicle.position:undefined,vehicle?.index??trafficIndex);this.scene?.showRoute(!vehicle?.parked);}
  nextVehicle(){this.selectVehicle(undefined,this.vehicleIndex()%3);}
  toggleFollow(){this.following.update(v=>!v);this.scene?.followVehicle(this.following());}
  reset(fromAgent=false){if(!fromAgent)this.manualSceneInput();this.selected.set(null);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.reset();this.scene?.showRoute(false);this.panel.set(null);}
  top(fromAgent=false){if(!fromAgent)this.manualSceneInput();this.selected.set(null);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.scene?.top();this.scene?.showRoute(false);this.panel.set(null);}
  toggleOrbit(){this.manualSceneInput();this.orbit.update(v=>!v);this.following.set(false);this.scene?.setOrbit(this.orbit());this.panel.set(null);}
  togglePause(){this.paused.update(v=>!v);this.scene?.setPaused(this.paused());}
  toggleClean(){this.clean.update(v=>!v);this.assistant?.hide();if(this.clean()){this.stopTour();this.assistant?.voice.stop();}this.panel.set(null);this.help.set(false);this.selected.set(null);this.vehicleSelected.set(false);this.scene?.showRoute(false);}
  changeQuality(){this.scene?.applyQuality(this.quality);}
  changeProfiling(value:boolean){this.profiling.set(value);this.scene?.setProfiling(value);}
  reloadRenderMode(key:string,value:string){const url=new URL(location.href);if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);location.assign(url.href);}
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
  readonly agentContext=()=>snapshot(this.store.zones(),this.store.events(),this.store.alarms(),this.ready()&&this.introDone(),this.selected()??(this.vehicleSelected()?'vehicle':'overview'),this.lastAgentResult);
  readonly captureAgentScene=()=>this.scene?.captureJpeg()??'';
  receiveAgentCatalog(value:ParkingCatalog){this.poiCatalog=value;}
  receiveAgentSnapshot(value:ParkingDatabaseSnapshot){this.store.applyDatabaseSnapshot(value);this.scene?.updateZones(this.store.zones());}
  receiveAgentRoute(value:ParkingRoute){if(!validRoute(value))return;this.navigation.set(value);this.scene?.showNavigation(value.points);}
  clearAgentRoute(){this.navigation.set(null);this.scene?.clearNavigation();}
  readonly executeAgentAction=(input:AgentAction):string=>{
    const action=parseAgentAction(input);
    if(!action)return '未执行：指令未通过场景白名单校验';
    let result='';
    if(action.type==='scene.focus'){
      if(!this.ready()||!this.introDone())result='未执行定位：精细场景尚未加载完成';
      else{this.pauseTour();this.focusAgentTarget(action.target);result=`✓ 已启动镜头定位：${action.target==='overview'?'园区全景':action.target==='top'?'垂直俯视':action.target==='vehicle'?'巡行车辆固定尾随':this.store.zones().find(z=>z.id===action.target)?.name}`;}
    }else if(action.type==='scene.poi'){
      const poi=this.poiCatalog?.graph.nodes.find(p=>p.id===action.target&&!p.closed);
      if(!poi)result='未执行：点位不在当前可用园区图中';else{this.pauseTour();this.focusPoi(poi);result='✓ 已启动点位镜头定位：'+poi.label;}
    }else if(action.type==='route.show')result='✓ 已请求显示经道路图计算的路径';
    else if(action.type==='route.clear'){this.clearAgentRoute();result='✓ 路径显示已隐藏';}
    else if(action.type==='workorder.prepare')result='✓ 将展示待人工确认的工单草稿，尚未提交';
    else if(action.type==='report.show')result='✓ 报表已按本次后端模拟账本计算，将显示在助手卡片中';
    else if(action.type==='tour.start'){
      if(!this.ready()||!this.introDone())result='未启动导览：请先等待场景加载完成';
      else{this.stopTour();this.tourSteps=this.makeTour(action.target);this.runTourStep(0);result='✓ 园区导览已启动，可暂停、继续或结束';}
    }else if(action.type==='tour.pause'){result=this.tour().active?'✓ 导览已暂停':'当前没有正在进行的导览';this.pauseTour();}
    else if(action.type==='tour.resume'){
      if(this.tour().active&&this.tour().paused){this.runTourStep(this.tour().index);result='✓ 导览已继续';}
      else result=this.tour().active?'导览正在进行':'当前没有已暂停的导览';
    }else if(action.type==='tour.stop'){this.stopTour();result='✓ 导览已结束，镜头保持当前位置';}
    this.lastAgentResult=result;return result;
  };
  private focusAgentTarget(target:string){
    this.clean.set(false);
    if(target==='overview')this.reset(true);
    else if(target==='top')this.top(true);
    else if(target==='vehicle')this.selectVehicle(undefined,0,true);
    else if(target==='A'||target==='B'||target==='C')this.selectZone(target,true);
    else{const poi=this.poiCatalog?.graph.nodes.find(p=>p.id===target&&!p.closed);if(poi)this.focusPoi(poi);}
  }
  private focusPoi(poi:ParkingPoi){this.clean.set(false);this.selected.set(null);this.vehicleSelected.set(false);this.following.set(false);this.orbit.set(false);this.panel.set(null);this.poiLabel.set(poi.label);this.scene?.focusPoint(poi.x,poi.z);}
  private makeTour(name:string){
    const ids=this.poiCatalog?.tours[name==='campus'?'visitor':name];if(!ids)return CAMPUS_TOUR;
    return ids.flatMap(id=>{const poi=this.poiCatalog?.graph.nodes.find(p=>p.id===id&&!p.closed);if(!poi)return[];const zone=this.store.zones().find(z=>z.id===poi.zone);return[{target:poi.id,title:poi.label,narration:`这里是${poi.label}。${zone?`本次数据库模拟快照中${zone.name}空余${zone.capacity-zone.occupied}个泊位。`:''}路线和距离来自演示道路图，不是现实医院通行指引。你可以随时暂停或切换视角。`}];});
  }
  private runTourStep(index:number){
    clearTimeout(this.tourTimer);
    const step=this.tourSteps[index];
    if(!step){this.stopTour();this.message('园区导览已完成');return;}
    this.tour.set({active:true,paused:false,index,title:step.title,narration:step.narration,total:this.tourSteps.length});
    this.focusAgentTarget(step.target);this.assistant?.narrate(step.narration);
    this.tourTimer=setTimeout(()=>this.runTourStep(index+1),14000);
  }
  private pauseTour(){if(this.tour().active&&!this.tour().paused){clearTimeout(this.tourTimer);this.tour.update(t=>({...t,paused:true}));this.assistant?.stopSpeaking();}}
  private stopTour(){clearTimeout(this.tourTimer);this.tour.set({active:false,paused:false,index:0,title:'',narration:''});this.assistant?.stopSpeaking();}
  manualSceneInput(){this.pauseTour();}
  closeVehicle(){this.vehicleSelected.set(false);this.following.set(false);this.scene?.followVehicle(false);this.scene?.showRoute(false);}
  @HostListener('document:keydown.escape')close(){this.help.set(false);this.panel.set(null);this.selected.set(null);this.closeVehicle();if(this.clean())this.clean.set(false);}
  ngOnDestroy(){this.disposed=true;clearInterval(this.timer);clearTimeout(this.toastTimer);clearTimeout(this.introTimer);clearTimeout(this.tourTimer);this.openingVideo?.nativeElement.pause();this.scene?.dispose();}
}
