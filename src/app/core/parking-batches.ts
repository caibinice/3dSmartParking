import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export interface InstanceCell { key: string; indices: number[]; matrices: number[][]; center: Vector3; radius: number; }
export function partitionInstances(matrices: number[][], size = 6): InstanceCell[] {
  const cells = new Map<string, InstanceCell>();
  matrices.forEach((matrix, index) => {
    const x = matrix[12], z = matrix[14], key = `${Math.floor(x / size)}:${Math.floor(z / size)}`;
    let cell = cells.get(key);
    if (!cell) { cell = { key, indices: [], matrices: [], center: new Vector3(), radius: 0 }; cells.set(key, cell); }
    cell.indices.push(index); cell.matrices.push(matrix);
  });
  for (const cell of cells.values()) {
    const xs = cell.matrices.map(m => m[12]), zs = cell.matrices.map(m => m[14]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    cell.center.copyFromFloats((minX + maxX) / 2, .1, (minZ + maxZ) / 2);
    // Vehicle bounds plus Glow's blur skirt: conservatively retain edge objects.
    cell.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 1;
  }
  return [...cells.values()];
}
export function cellVisible(cell: InstanceCell, planes: Plane[]) {
  return planes.every(plane => plane.dotCoordinate(cell.center) >= -cell.radius);
}
export class ParkingVehicleBatches {
  private readonly planes = Frustum.GetPlanes(Matrix.Identity());
  private readonly cells: InstanceCell[];
  private readonly sources: { high: Mesh; low?: Mesh; matrices: Float32Array }[] = [];
  private readonly visible: Uint8Array;
  private readonly state: Uint8Array;
  private readonly nextState: Uint8Array;
  private mode: 'single' | 'adaptive';
  private lod = false;
  readonly total: number;
  visibleInstances = 0;
  activeCells = 0;
  selectedLod = 0;
  constructor(matrices: number[][], mode: 'single' | 'adaptive' = 'adaptive') {
    this.mode = mode; this.total = matrices.length;
    this.cells = partitionInstances(matrices);
    this.visible = new Uint8Array(this.cells.length); this.state = new Uint8Array(this.cells.length); this.nextState = new Uint8Array(this.cells.length);
    this.state.fill(255);
  }
  add(source: Mesh, template: Matrix, low?: Mesh) {
    const indices = Array.from({ length: this.total }, (_, i) => i);
    const matrices = new Float32Array(this.total * 16);
    for (const cell of this.cells) cell.indices.forEach((index, i) =>
      matrices.set(template.multiply(Matrix.FromArray(cell.matrices[i])).asArray(), index * 16));
    source.metadata = { ...source.metadata, parkedIndices: indices };
    if (low) {
      low.parent = null; low.unfreezeWorldMatrix(); low.doNotSyncBoundingInfo = false;
      low.position.setAll(0); low.scaling.setAll(1); low.rotation.setAll(0); low.rotationQuaternion = null;
      low.material = source.material; low.thinInstanceSetBuffer('matrix', matrices, 16, true);
      low.thinInstanceRefreshBoundingInfo(true); low.computeWorldMatrix(true); low.freezeWorldMatrix(); low.doNotSyncBoundingInfo = true;
      low.isPickable = true; low.thinInstanceEnablePicking = true; low.renderingGroupId = 1;
      low.alwaysSelectAsActiveMesh = true; low.metadata = { vehicle: true, parked: true, parkedIndices: indices };
      low.setEnabled(false);
    }
    this.sources.push({ high: source, low, matrices }); this.state.fill(255);
  }
  setMode(mode: 'single' | 'adaptive') { this.mode = mode; }
  setLod(enabled: boolean) { this.lod = enabled; }
  update(camera: ArcRotateCamera, renderHeight: number) {
    const scene = camera.getScene(); scene.updateTransformMatrix();
    Frustum.GetPlanesToRef(scene.getTransformMatrix(), this.planes);
    let visibleCount = 0, visibleCells = 0;
    this.cells.forEach((cell, i) => { this.visible[i] = cellVisible(cell, this.planes) ? 1 : 0; if (this.visible[i]) { visibleCount += cell.indices.length; visibleCells++; } });
    // Compact one thin-instance buffer per part instead of cloning geometries:
    // Babylon stores world attributes on geometry, shared clones would overwrite
    // each other's matrix buffers. This also avoids extra batches/draw calls.
    const split = this.mode === 'adaptive' && visibleCount < this.total * .6;
    this.visibleInstances = split ? visibleCount : this.total; this.activeCells = split ? visibleCells : 1; this.selectedLod = 0;
    const lowReady = this.lod && this.sources.every(s => s.low);
    let changed = false;
    this.cells.forEach((cell, i) => {
      const enabled = !split || !!this.visible[i];
      // Physical-pixel threshold, not CSS pixels; no near/following car LOD.
      const distance = Math.max(.1, Vector3.Distance(camera.position, cell.center) - cell.radius);
      const projectedCarPixels = .42 * renderHeight / (2 * Math.tan(camera.fov / 2) * Math.max(.1, distance));
      const low = enabled && lowReady && projectedCarPixels < 32;
      this.nextState[i] = enabled ? (low ? 2 : 1) : 0;
      if (low) this.selectedLod += cell.indices.length;
      if (this.nextState[i] !== this.state[i]) changed = true;
    });
    if (!changed) return;
    this.state.set(this.nextState);
    const highIndices: number[] = [], lowIndices: number[] = [];
    this.cells.forEach((cell, i) => { if (this.state[i]) (this.state[i] === 2 ? lowIndices : highIndices).push(...cell.indices); });
    // Retain original global instance order, including transparent car glass.
    highIndices.sort((a, b) => a - b); lowIndices.sort((a, b) => a - b);
    for (const source of this.sources) {
      for (const [mesh, indices] of [[source.high, highIndices], [source.low, lowIndices]] as [Mesh | undefined, number[]][]) {
        if (!mesh) continue;
        mesh.setEnabled(indices.length > 0);
        if (!indices.length) continue;
        const buffer = new Float32Array(indices.length * 16);
        indices.forEach((index, i) => buffer.set(source.matrices.subarray(index * 16, index * 16 + 16), i * 16));
        // Only upload when the visible-cell/LOD set changes, never per frame.
        // Full-layout bounds stay conservative; global picking IDs stay stable.
        mesh.thinInstanceSetBuffer('matrix', buffer, 16, true);
        mesh.metadata.parkedIndices = indices;
      }
    }
  }
  dispose() { this.sources.length = 0; }
}
