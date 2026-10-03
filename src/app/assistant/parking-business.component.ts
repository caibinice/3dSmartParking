import {Component,input,output,signal,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ParkingAgentClient} from './parking-agent-client';
import {ParkingBusinessReportComponent} from './parking-business-report.component';
import {validRoute,type ParkingCatalog,type ParkingRoute} from '../core/parking-operations';
import type{AgentReport}from '../core/parking-agent';

@Component({selector:'app-parking-business',imports:[FormsModule,ParkingBusinessReportComponent],templateUrl:'./parking-business.component.html',styleUrl:'./parking-business.component.scss'})
export class ParkingBusinessComponent implements OnInit{
 readonly client=input.required<ParkingAgentClient>();readonly catalog=input.required<ParkingCatalog>();readonly capture=input.required<()=>string>();readonly draft=input<any>(null);readonly initialMode=input('guide');
 readonly routeReady=output<ParkingRoute>();readonly focus=output<string>();readonly send=output<string>();readonly catalogUpdated=output<ParkingCatalog>();
 mode='guide';readonly busy=signal(false);readonly error=signal('');readonly report=signal<AgentReport|null>(null);readonly workorders=signal<any[]>([]);readonly audits=signal<any[]>([]);readonly stays=signal<any[]>([]);readonly reportJobs=signal<{period:string;generatedAt:string}[]>([]);
 from='';to='';zone='';page=1;confirmation=false;note='请人工核验现场车辆、道路及车位信息，记录处置结论。';
 pending:{row:any;action:string}|null=null;image='';visionQuestion='描述当前画面中可见的道路、建筑和停车区，给出可核验的巡检建议。';imageConfirmed=false;readonly visionAnswer=signal('');
 graphJson='';newUser='';newName='';newRole='security';newPassword='';
 ngOnInit(){this.mode=this.initialMode();this.from=this.catalog().dataset.startDate;this.to=this.catalog().dataset.endDate;this.graphJson=JSON.stringify(this.catalog().graph,null,2);if(this.mode==='workorders')void this.loadWorkorders();}
 staff(){return this.catalog().role!=='visitor';}operator(){return ['operator','admin'].includes(this.catalog().role);}admin(){return this.catalog().role==='admin';}
 async task(callback:()=>Promise<void>){if(this.busy())return;this.busy.set(true);this.error.set('');try{await callback();}catch(e){this.error.set(e instanceof Error?e.message:'业务请求未完成');}finally{this.busy.set(false);}}
 async showRoute(){await this.task(async()=>{const route=await this.client().route(this.client().destination);if(validRoute(route))this.routeReady.emit(route);else throw new Error('道路路径格式未通过校验');});}
 async analytics(){await this.task(async()=>{const result=await this.client().request<Record<string,any>>('/analytics?from='+encodeURIComponent(this.from)+'&to='+encodeURIComponent(this.to)+(this.zone?'&zone='+this.zone:''));this.report.set({kind:'yearly',source:'database-synthetic',observedAt:new Date().toISOString(),data:result});});}
 async loadStays(){await this.task(async()=>this.stays.set(await this.client().request<any[]>('/stays?page='+this.page+'&size=20')));}
 async loadReportJobs(){await this.task(async()=>this.reportJobs.set(await this.client().request<{period:string;generatedAt:string}[]>('/report-jobs')));}
 async loadWorkorders(){await this.task(async()=>this.workorders.set(await this.client().request<any[]>('/workorders')));}
 async submitWorkorder(){await this.task(async()=>{if(!this.draft()?.alert)throw new Error('请先准备告警工单');await this.client().request('/workorders','POST',{alertId:this.draft().alert.id,note:this.note,requestKey:crypto.randomUUID(),confirmed:this.confirmation});this.confirmation=false;this.workorders.set(await this.client().request<any[]>('/workorders'));this.error.set('工单已提交至待审核队列。');});}
 async transition(){const pending=this.pending;if(!pending)return;await this.task(async()=>{await this.client().request('/workorders/'+pending.row.id+'/transition','POST',{version:pending.row.version,action:pending.action,note:this.note,confirmed:this.confirmation});this.confirmation=false;this.pending=null;this.workorders.set(await this.client().request<any[]>('/workorders'));});}
 prepareTransition(row:any,action:string){this.pending={row,action};this.confirmation=false;this.note='人工核验记录：';}
 async loadAudits(){await this.task(async()=>this.audits.set(await this.client().request<any[]>('/audit')));}
 takeScreenshot(){try{this.image=this.capture()();this.imageConfirmed=false;this.visionAnswer.set('');if(!this.image)throw new Error('场景尚未就绪');}catch(e){this.error.set(String(e));}}
 async askVision(){await this.task(async()=>{const result=await this.client().request<{answer:string;model:string}>('/vision','POST',{question:this.visionQuestion,screenshot:this.image,confirmed:this.imageConfirmed});this.visionAnswer.set(result.answer);});}
 async saveGraph(){await this.task(async()=>{await this.client().request('/graph','PUT',JSON.parse(this.graphJson));const catalog=await this.client().catalog();this.catalogUpdated.emit(catalog);this.graphJson=JSON.stringify(catalog.graph,null,2);this.error.set('路径图已保存，新请求使用新版本。');});}
 async createUser(){await this.task(async()=>{await this.client().request('/users','POST',{username:this.newUser,displayName:this.newName,role:this.newRole,password:this.newPassword});this.newPassword='';this.error.set('业务账号已创建；密码仅保留为后端哈希。');});}
 status(value:string){return ({pending_review:'待审核',approved:'已批准',assigned:'已领取',resolved:'已完成核验',closed:'已关闭'} as Record<string,string>)[value]??value;}
 actionName(value:string){return ({approve:'批准',assign:'领取',resolve:'完成核验',close:'关闭'} as Record<string,string>)[value]??value;}
 modeChanged(){this.error.set('');if(this.mode==='workorders')void this.loadWorkorders();if(this.mode==='audit')void this.loadAudits();}
}
