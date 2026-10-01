import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ParkingStore } from '../core/parking-store';
import { Quality, ZoneId } from '../core/parking-data';
import type { ParkingScene, SceneStats } from '../core/parking-scene';
@Component({
  selector: 'app-dashboard', imports: [RouterLink, FormsModule],
  templateUrl: './dashboard.component.html', styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  readonly store = inject(ParkingStore);
  readonly mobile = inject(ActivatedRoute).snapshot.data['mobile'] === true;
  readonly selected = signal<ZoneId | null>(null);
  readonly selectedZone = computed(() => this.store.zones().find(z => z.id === this.selected()));
  readonly ready = signal(false);
  readonly progress = signal('准备三维引擎…');
  readonly status = signal('');
  readonly error = signal(false);
  readonly stats = signal<SceneStats>({ fps: 0, meshes: 0, backend: 'WebGL', quality: 'auto' });
  readonly now = signal(new Date());
  readonly help = signal(false);
  readonly drawer = signal(false);
  readonly paused = signal(false);
  readonly orbit = signal(false);
  readonly toast = signal('');
  readonly search = signal('');
  readonly filteredEvents = computed(() => this.store.events().filter(e => `${e.plate}${e.zone}${e.action}`.toLowerCase().includes(this.search().toLowerCase())));
  readonly activeAlarms = computed(() => this.store.alarms().filter(a => !a.acknowledged).length);
  readonly recommended = computed(() => [...this.store.zones()].sort((a, b) => b.capacity - b.occupied - (a.capacity - a.occupied))[0]);
  quality: Quality = 'auto';
  readonly trend = [24,31,27,42,58,65,72,66,54,49,61,63];
  private scene?: ParkingScene;
  private timer?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  async ngAfterViewInit() {
    for (let i = 0; i < 6; i++) this.store.advance();
    await this.loadScene();
    if (this.disposed) return;
    this.timer = setInterval(() => {
      this.now.set(new Date());
      if (!this.paused() && !document.hidden) {
        this.store.advance(); this.scene?.updateZones(this.store.zones());
      }
    }, 5000);
  }
  async loadScene() {
    this.scene?.dispose(); this.ready.set(false); this.error.set(false);
    try {
      const { ParkingScene } = await import('../core/parking-scene');
      if (this.disposed) return;
      this.scene = new ParkingScene(this.canvas.nativeElement, this.mobile, id => this.selectZone(id), stats => this.stats.set(stats));
      const status = await this.scene.init(value => this.progress.set(value));
      if (!this.disposed) { this.status.set(status); this.ready.set(true); }
    } catch {
      if (!this.disposed) { this.error.set(true); this.progress.set('三维引擎初始化失败，请检查浏览器硬件加速后重试'); }
    }
  }
  selectZone(id: ZoneId) { this.selected.set(id); this.scene?.focusZone(id); this.drawer.set(false); }
  reset() { this.selected.set(null); this.scene?.reset(); }
  top() { this.selected.set(null); this.scene?.top(); }
  toggleOrbit() { this.orbit.update(v => !v); this.scene?.setOrbit(this.orbit()); }
  changeQuality() { this.scene?.applyQuality(this.quality); }
  acknowledge(id: number) { this.store.acknowledge(id); this.message('演示告警已确认，不向真实设备发送指令'); }
  exportEvents() {
    const rows = [['时间', '模拟车牌', '区域', '动作'], ...this.filteredEvents().map(e => [e.time, e.plate, e.zone, e.action])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'parking-demo-events.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); this.message('已导出当前筛选的模拟记录');
  }
  async fullscreen() {
    try {
      const shell = this.canvas.nativeElement.closest('.shell') as HTMLElement;
      if (!document.fullscreenElement) await shell.requestFullscreen(); else { await document.exitFullscreen(); return; }
      if (this.mobile) {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
        try { await orientation.lock?.('landscape'); } catch { this.message('已全屏；横屏布局由页面自动适配'); }
      }
    } catch { this.message('当前浏览器使用页面横屏适配，可手动旋转设备'); }
  }
  private message(value: string) { this.toast.set(value); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toast.set(''), 3500); }
  @HostListener('document:keydown.escape') close() { this.help.set(false); this.drawer.set(false); }
  ngOnDestroy() { this.disposed = true; clearInterval(this.timer); clearTimeout(this.toastTimer); this.scene?.dispose(); }
}
