"""Create an owned, asset-free test scene; run via Blender --python, never on user scenes."""
from pathlib import Path
import sys
import bpy
from mathutils import Vector


def main():
    target = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    if target.exists() or target.suffix != '.blend':
        raise RuntimeError('sample output must be a new .blend file')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 1))
    bpy.context.object.name = 'GuideCube'
    material = bpy.data.materials.new('clay')
    material.diffuse_color = (.55, .32, .18, 1)
    bpy.context.object.data.materials.append(material)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    bpy.ops.object.camera_add(location=(6, -8, 5))
    camera = bpy.context.object
    camera.name = 'GuideCamera'
    bpy.context.scene.camera = camera
    for frame, location in ((1, (6, -8, 5)), (12, (4, -8, 4))):
        camera.location = location
        camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.keyframe_insert(data_path='location', frame=frame)
        camera.keyframe_insert(data_path='rotation_euler', frame=frame)
    bpy.ops.object.light_add(type='AREA', location=(2, -4, 7))
    bpy.context.object.data.energy = 1300
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 5
    bpy.context.scene.world = bpy.data.worlds.new('GuideWorld')
    bpy.context.scene.world.color = (.12, .12, .12)
    bpy.context.scene.frame_end = 12
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target))


if __name__ == '__main__':
    main()
