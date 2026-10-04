import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import '@babylonjs/core/Engines/Extensions/engine.query';
import { RegisterAbstractEngineTimeQuery } from '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery.pure';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Observable } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

RegisterAbstractEngineTimeQuery();

export interface RenderProfile {
  cpuFrameMs: number; cpuRenderMs: number; cpuGlowMs: number; cpuOpaqueMs: number; cpuTransparentMs: number; cpuSelectionMs: number;
  gpuFrameMs: number | null; gpuStatus: string; draws: number; samples: number;
}
export class SampleWindow {
  private readonly values: Float64Array;
  private index = 0;
  count = 0;
  constructor(size = 120) { this.values = new Float64Array(size); }
  add(value: number) { if (!Number.isFinite(value) || value < 0) return; this.values[this.index++ % this.values.length] = value; this.count = Math.min(this.count + 1, this.values.length); }
  get mean() { let total = 0; for (let i = 0; i < this.count; i++) total += this.values[i]; return this.count ? total / this.count : 0; }
}
export class ParkingRenderProfiler {
  private readonly sceneInstrumentation: SceneInstrumentation;
  private readonly engineInstrumentation: EngineInstrumentation;
  private readonly opaque = new SampleWindow();
  private readonly transparent = new SampleWindow();
  private readonly cleanup: (() => void)[] = [];
  private opaqueFrame = 0;
  private transparentFrame = 0;
  private readonly gpuAvailable: boolean;
  constructor(private scene: Scene, private engine: AbstractEngine) {
    this.sceneInstrumentation = new SceneInstrumentation(scene);
    this.sceneInstrumentation.captureFrameTime = true;
    this.sceneInstrumentation.captureRenderTime = true;
    this.sceneInstrumentation.captureRenderTargetsRenderTime = true;
    this.sceneInstrumentation.captureActiveMeshesEvaluationTime = true;
    this.engineInstrumentation = new EngineInstrumentation(engine);
    this.gpuAvailable = typeof engine.captureGPUFrameTime === 'function' && typeof engine.getGPUFrameTimeCounter === 'function';
    if (this.gpuAvailable) this.engineInstrumentation.captureGPUFrameTime = true;
    this.listen(scene.onBeforeRenderObservable, () => { this.opaqueFrame = this.transparentFrame = 0; });
    this.listen(scene.onAfterRenderObservable, () => { this.opaque.add(this.opaqueFrame); this.transparent.add(this.transparentFrame); });
    for (const mesh of scene.meshes as Mesh[]) {
      if (!mesh.material || !mesh.getTotalVertices()) continue;
      const transparent = mesh.material.needAlphaBlendingForMesh(mesh);
      let start = 0;
      this.listen(mesh.onBeforeRenderObservable, () => { start = performance.now(); });
      this.listen(mesh.onAfterRenderObservable, () => { const duration = performance.now() - start; if (transparent) this.transparentFrame += duration; else this.opaqueFrame += duration; });
    }
  }
  private listen<T>(observable: Observable<T>, callback: (value: T) => void) { const observer = observable.add(callback); this.cleanup.push(() => { observable.remove(observer); }); }
  snapshot(): RenderProfile {
    const scene = this.sceneInstrumentation, gpu = this.gpuAvailable ? this.engineInstrumentation.gpuFrameTimeCounter : undefined;
    // Some drivers expose timer queries yet return near-zero/clamped values.
    // This non-empty 3D scene needs stable, plausible (>10 µs) elapsed samples.
    const hasGpu = !!gpu && gpu.count >= 10 && gpu.lastSecAverage >= 10_000;
    return {
      cpuFrameMs: scene.frameTimeCounter.lastSecAverage, cpuRenderMs: scene.renderTimeCounter.lastSecAverage,
      cpuGlowMs: scene.renderTargetsRenderTimeCounter.lastSecAverage, cpuSelectionMs: scene.activeMeshesEvaluationTimeCounter.lastSecAverage,
      cpuOpaqueMs: this.opaque.mean, cpuTransparentMs: this.transparent.mean,
      gpuFrameMs: hasGpu ? gpu.lastSecAverage * 1e-6 : null,
      gpuStatus: hasGpu ? 'GPU 查询 · 整帧' : this.engine.getCaps().timerQuery ? 'GPU 查询尚未形成稳定有效样本' : '设备未开放 GPU 查询',
      draws: scene.drawCallsCounter.current, samples: this.opaque.count,
    };
  }
  dispose() { this.cleanup.forEach(remove => remove()); this.sceneInstrumentation.dispose(); if (this.gpuAvailable) this.engineInstrumentation.captureGPUFrameTime = false; this.engineInstrumentation.dispose(); }
}
