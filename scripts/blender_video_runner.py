"""Run inside Blender only; emits RGB plus raw, unnormalised Z-pass EXRs."""
import json
from pathlib import Path
import sys
import bpy


def reject_external_dependencies():
    # Blender's own path walker also covers VDB, fonts and less common ID paths.
    external = list(bpy.utils.blend_paths(absolute=True, packed=False, local=False))
    external += list(bpy.data.libraries) + list(bpy.data.movieclips) + list(bpy.data.sounds) + list(bpy.data.cache_files)
    external += [image for image in bpy.data.images
                 if image.source not in ('GENERATED', 'VIEWER') and image.filepath and not image.packed_file]
    external += [volume for volume in bpy.data.volumes if volume.filepath]
    external += [font for font in bpy.data.fonts
                 if font.filepath not in ('', '<builtin>') and not font.packed_file]
    def disk_cache(cache):
        return cache is not None and (cache.use_disk_cache or cache.use_external or cache.filepath)
    for obj in bpy.data.objects:
        for modifier in obj.modifiers:
            if (disk_cache(getattr(modifier, 'point_cache', None))
                    or getattr(modifier, 'domain_settings', None) is not None
                    or getattr(modifier, 'bakes', None)
                    or getattr(modifier, 'filepath', '')):
                external.append(modifier)
        for particles in obj.particle_systems:
            if disk_cache(particles.point_cache):
                external.append(particles)
    for scene in getattr(bpy.data, 'scenes', ()):
        if scene.rigidbody_world and disk_cache(scene.rigidbody_world.point_cache):
            external.append(scene.rigidbody_world)
    if external:
        raise RuntimeError('external scene dependencies are unsupported; pack supported assets or remove disk caches before importing')


def main():
    request_path = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    request = json.loads(request_path.read_text())
    output = request_path.parent
    scene_path = Path(request['scene_path']).resolve()
    if scene_path != output / 'scene.blend':
        raise RuntimeError('scene must be the job snapshot')
    bpy.ops.wm.open_mainfile(filepath=str(scene_path), use_scripts=False, load_ui=False)
    scene = bpy.context.scene
    # Relative external assets would resolve against the snapshot, not the original.
    # Reject all unpacked dependencies; an explicit import broker can pack them later.
    reject_external_dependencies()
    if request['camera']:
        scene.camera = scene.objects.get(request['camera'])
    if not scene.camera or scene.camera.type != 'CAMERA':
        raise RuntimeError('selected scene requires a camera')
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 8
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = request['width']
    scene.render.resolution_y = request['height']
    scene.render.resolution_percentage = 100
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.use_multiview = False
    scene.render.fps = request['fps']
    scene.render.fps_base = 1
    scene.render.use_file_extension = True
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_layers[0].use_pass_z = True
    for kind in ('rgb', 'depth'):
        (output / kind).mkdir(exist_ok=False)
    for frame in range(request['start'], request['end'] + 1):
        scene.frame_set(frame)
        scene.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'
        scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        scene.render.filepath = str(output / 'depth' / f'{frame:06d}.exr')
        bpy.ops.render.render(write_still=True)
        scene.render.image_settings.media_type = 'IMAGE'
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.image_settings.color_depth = '8'
        bpy.data.images['Render Result'].save_render(str(output / 'rgb' / f'{frame:06d}.png'), scene=scene)
    info = {'blender_version': bpy.app.version_string, 'camera': scene.camera.name,
            'camera_clip_start': scene.camera.data.clip_start, 'camera_clip_end': scene.camera.data.clip_end,
            'width': request['width'], 'height': request['height'], 'fps': request['fps'],
            'frame_start': request['start'], 'frame_end': request['end'], 'rgb_color_space': 'Standard sRGB',
            'depth': {'format': 'OPEN_EXR_MULTILAYER', 'channel': scene.view_layers[0].name + '.Depth.Z',
                      'units': 'Blender scene units', 'normalized': False, 'background': 'renderer infinity'},
            'engine': 'CYCLES CPU', 'samples': 8, 'external_assets': []}
    if request.get('builtin_encode'):
        encode = bpy.data.scenes.new('PankekiGuideEncode')
        bpy.context.window.scene = encode
        encode.render.resolution_x = request['width']
        encode.render.resolution_y = request['height']
        encode.render.resolution_percentage = 100
        encode.render.fps = request['fps']
        encode.render.fps_base = 1
        encode.frame_start = 1
        encode.frame_end = request['end'] - request['start'] + 1
        encode.view_settings.view_transform = 'Standard'
        sequence = encode.sequence_editor_create()
        first = output / 'rgb' / f"{request['start']:06d}.png"
        strip = sequence.strips.new_image('Blender guide - not AI', str(first), channel=1, frame_start=1)
        for frame in range(request['start'] + 1, request['end'] + 1):
            strip.elements.append(f'{frame:06d}.png')
        encode.render.image_settings.media_type = 'VIDEO'
        encode.render.image_settings.file_format = 'FFMPEG'
        encode.render.ffmpeg.format = 'MPEG4'
        encode.render.ffmpeg.codec = 'H264'
        encode.render.ffmpeg.constant_rate_factor = 'MEDIUM'
        encode.render.ffmpeg.audio_codec = 'NONE'
        encode.render.filepath = str(output / 'guide.mp4')
        bpy.ops.render.render(animation=True, scene=encode.name)
        info['encoder'] = 'Blender bundled FFmpeg H264 MPEG4'
    else:
        info['encoder'] = 'external ffmpeg H264 MPEG4'
    (output / 'render-info.json').write_text(json.dumps(info, indent=2))


if __name__ == '__main__':
    main()
