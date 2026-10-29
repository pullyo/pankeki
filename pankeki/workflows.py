"""Small, explicit built-in ComfyUI API graphs. No custom nodes required."""


def txt2img(model_name, prompt, negative='', seed=1, width=512, height=512, steps=1, cfg=1., sampler='euler', scheduler='normal'):
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': model_name}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['1', 1]}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': negative, 'clip': ['1', 1]}},
        '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': width, 'height': height, 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {'seed': seed, 'steps': steps, 'cfg': cfg,
              'sampler_name': sampler, 'scheduler': scheduler, 'denoise': 1., 'model': ['1', 0],
              'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0]}},
        '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': 'Pankeki'}},
    }


def inpaint(model_name, prompt, image_name, negative='', seed=1, steps=1, cfg=1., denoise=1., sampler='euler', scheduler='normal'):
    graph = txt2img(model_name, prompt, negative, seed, steps=steps, cfg=cfg, sampler=sampler, scheduler=scheduler)
    graph['4'] = {'class_type': 'LoadImage', 'inputs': {'image': image_name}}
    # These general-purpose checkpoints need the selected area's original
    # structure for partial-strength edits. Noise is restricted separately.
    graph['8'] = {'class_type': 'VAEEncode', 'inputs': {
        'pixels': ['4', 0], 'vae': ['1', 2]}}
    graph['9'] = {'class_type': 'SetLatentNoiseMask', 'inputs': {
        'samples': ['8', 0], 'mask': ['4', 1]}}
    graph['5']['inputs'].update({'latent_image': ['9', 0], 'denoise': denoise})
    return graph


def inpaint_sdxl(model_name, unet_name, prompt, image_name, negative='', seed=1,
                 steps=25, cfg=6., denoise=.55, sampler='dpmpp_2m', scheduler='karras'):
    """Dedicated nine-channel UNet; Base checkpoint supplies CLIP and VAE."""
    graph = inpaint(model_name, prompt, image_name, negative, seed, steps, cfg, denoise, sampler, scheduler)
    graph['8'] = {'class_type': 'UNETLoader', 'inputs': {
        'unet_name': unet_name, 'weight_dtype': 'default'}}
    graph['9'] = {'class_type': 'InpaintModelConditioning', 'inputs': {
        'positive': ['2', 0], 'negative': ['3', 0], 'vae': ['1', 2],
        'pixels': ['4', 0], 'mask': ['4', 1], 'noise_mask': True}}
    graph['5']['inputs'].update(model=['8', 0], positive=['9', 0],
                                negative=['9', 1], latent_image=['9', 2])
    return graph


def img2img(model_name, prompt, image_name, negative='', seed=1, steps=25, cfg=6.,
            denoise=.55, sampler='dpmpp_2m', scheduler='karras'):
    """Whole-image source-conditioned sampling; no mask or inpaint conditioning."""
    if not 0 < denoise < 1:
        raise ValueError('img2img denoise must preserve source conditioning: 0 < denoise < 1')
    graph = txt2img(model_name, prompt, negative, seed, steps=steps, cfg=cfg,
                   sampler=sampler, scheduler=scheduler)
    graph['4'] = {'class_type': 'LoadImage', 'inputs': {'image': image_name}}
    graph['8'] = {'class_type': 'VAEEncode', 'inputs': {'pixels': ['4', 0], 'vae': ['1', 2]}}
    graph['5']['inputs'].update(latent_image=['8', 0], denoise=denoise)
    return graph
