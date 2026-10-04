"""Optional read-only Blender audit. Run: blender -b --python THIS -- MODEL.glb REPORT.json.

Does not save/export the imported scene, modify meshes, apply Decimate, merge
materials, change normals, rename nodes, or alter the original GLB.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
source, output = (Path(value).resolve() for value in args[:2])
before = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = []
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    mesh = obj.data
    mesh.calc_loop_triangles()
    meshes.append({
        "name": obj.name,
        "vertices": len(mesh.vertices),
        "triangles": len(mesh.loop_triangles),
        "uvLayers": len(mesh.uv_layers),
        "materials": [material.name if material else None for material in mesh.materials],
        "worldMatrix": [list(row) for row in obj.matrix_world],
        "dimensions": list(obj.dimensions),
    })
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"blenderVersion": bpy.app.version_string, "sourceHash": before, "readOnly": True, "meshes": meshes}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Read-only Blender audit: {len(meshes)} meshes; source hash unchanged.")
