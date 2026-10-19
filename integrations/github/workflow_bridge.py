"""Offline, stdlib-only CropAndStitch adapter for a plain ComfyUI API graph.

This changes a deep copy; it does not contact ComfyUI, install nodes, or run a GPU.
Node schema snapshot: ComfyUI-Inpaint-CropAndStitch 3.0.18, commit
348a8bbaad1a9000523e42dd3eaf6ab34a8fe62f (INPUT_TYPES / RETURN_TYPES).
Composite schema: Comfy-Org/ComfyUI/comfy_extras/nodes_mask.py,
ImageCompositeMasked, inspected 2026-10-19.

Only a plain API node map is accepted, not UI workflow JSON or a /prompt wrapper.
Node-level _meta is retained but is not interpreted as graph data.
Known core output slots are checked; unknown custom-node output schemas must be
validated by the installed ComfyUI before execution. This is not a replacement
for ComfyUI's complete type/required-input validation.

The final guard keeps the original destination at mask=0 for finite image values
and matching original image/mask geometry. It is not a GPU-tested pixel claim.
Soft masks blend, and a mismatched mask can be resized by the built-in node;
check dimensions and preservation on real images before accepting the workflow.
"""

import argparse
import copy
import json
import math
from pathlib import Path
import sys


# Output types needed for the selected route plus common input providers. Unknown
# custom nodes remain structurally checked rather than pretending to know them.
_OUTPUT_TYPES = {
    "LoadImage": ("IMAGE", "MASK"),
    "LoadImageMask": ("MASK",),
    "CheckpointLoaderSimple": ("MODEL", "CLIP", "VAE"),
    "CLIPTextEncode": ("CONDITIONING",),
    "VAELoader": ("VAE",),
    "VAEEncodeForInpaint": ("LATENT",),
    "VAEEncode": ("LATENT",),
    "VAEDecode": ("IMAGE",),
    "KSampler": ("LATENT",),
    "KSamplerAdvanced": ("LATENT",),
    "EmptyLatentImage": ("LATENT",),
    "SolidMask": ("MASK",),
    "ImageToMask": ("MASK",),
    "MaskToImage": ("IMAGE",),
    "InvertMask": ("MASK",),
    "GrowMask": ("MASK",),
    "FeatherMask": ("MASK",),
    "ImageCompositeMasked": ("IMAGE",),
    "InpaintCropImproved": ("STITCHER", "IMAGE", "MASK"),
    "InpaintStitchImproved": ("IMAGE",),
    "SaveImage": (),
    "PreviewImage": (),
}


def _link(graph, value, label, expected_type=None):
    if (not isinstance(value, list) or len(value) != 2
            or not isinstance(value[0], str)
            or type(value[1]) is not int or value[1] < 0):
        raise ValueError(f"{label}: expected [node_id, nonnegative integer slot]")
    node_id, slot = value
    if node_id not in graph:
        raise ValueError(f"{label}: references missing node {node_id!r}")
    output_types = _OUTPUT_TYPES.get(graph[node_id]["class_type"])
    if output_types is not None:
        if slot >= len(output_types):
            raise ValueError(f"{label}: invalid output slot {slot} for node {node_id!r}")
        if expected_type and output_types[slot] != expected_type:
            raise ValueError(f"{label}: expected {expected_type}, got {output_types[slot]}")
    return value


def _validate_graph(graph):
    if not isinstance(graph, dict) or not graph:
        raise ValueError("Input must be a nonempty plain API graph (node ID to node)")
    for node_id, node in graph.items():
        if not isinstance(node_id, str) or not node_id:
            raise ValueError("API graph node IDs must be nonempty strings")
        if (not isinstance(node, dict) or not isinstance(node.get("class_type"), str)
                or not node["class_type"] or not isinstance(node.get("inputs"), dict)):
            raise ValueError(f"{node_id!r}: expected an API node with class_type and inputs")
        if set(node) - {"class_type", "inputs", "_meta"}:
            raise ValueError(f"{node_id!r}: unsupported node metadata; use plain API JSON")

    dependencies = {}
    for node_id, node in graph.items():
        dependencies[node_id] = []
        for name, value in node["inputs"].items():
            if not isinstance(name, str):
                raise ValueError(f"{node_id!r}: input names must be strings")
            if isinstance(value, list):
                dependencies[node_id].append(_link(graph, value, f"{node_id}.{name}")[0])
            elif isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"{node_id}.{name}: nonfinite numeric input")
            elif not isinstance(value, (str, int, float, bool, type(None))):
                raise ValueError(f"{node_id}.{name}: unsupported input value; expected literal or link")

    # Iterative DFS avoids Python recursion limits on large, valid API graphs.
    visited, active = set(), set()
    for start in graph:
        stack = [(start, False)]
        while stack:
            node_id, leaving = stack.pop()
            if leaving:
                active.remove(node_id)
                visited.add(node_id)
            elif node_id in active:
                raise ValueError(f"Graph cycle detected at node {node_id!r}")
            elif node_id not in visited:
                active.add(node_id)
                stack.append((node_id, True))
                stack.extend((upstream, False) for upstream in dependencies[node_id])
    return dependencies


def _node(graph, node_id, class_type):
    if not isinstance(node_id, str) or node_id not in graph:
        raise ValueError(f"Missing selected {class_type} node {node_id!r}")
    if graph[node_id]["class_type"] != class_type:
        raise ValueError(f"Selected node {node_id!r} must have class_type {class_type}")
    return graph[node_id]


def _crop_inputs(image, mask):
    # All required widgets from the inspected source, with requested conservative
    # overrides. MAX_RESOLUTION=16384 is the source fallback/core schema snapshot.
    return {
        "image": image, "mask": mask,
        "downscale_algorithm": "bilinear", "upscale_algorithm": "bicubic",
        "preresize": False, "preresize_mode": "ensure minimum resolution",
        "preresize_min_width": 1024, "preresize_min_height": 1024,
        "preresize_max_width": 16384, "preresize_max_height": 16384,
        "mask_fill_holes": False, "mask_expand_pixels": 0, "mask_invert": False,
        "mask_blend_pixels": 0, "mask_hipass_filter": 0.0,
        "extend_for_outpainting": False, "extend_up_factor": 1.0,
        "extend_down_factor": 1.0, "extend_left_factor": 1.0, "extend_right_factor": 1.0,
        "context_from_mask_extend_factor": 1.2, "output_resize_to_target_size": False,
        "output_target_width": 512, "output_target_height": 512,
        "output_padding": "32", "device_mode": "cpu (compatible)",
    }


def add_crop_and_stitch(graph, *, encode_node_id, output_node_id):
    """Return a copied API graph with crop, stitch, and original-mask guard.

    Explicit IDs select a VAEEncodeForInpaint and SaveImage. SaveImage must
    consume VAEDecode slot 0, whose samples depend on the selected encoder.
    The existing intermediate nodes, sampler parameters, VAE/model links, seed,
    and grow_mask_by remain unchanged. Only the selected encoder's pixels/mask
    and selected SaveImage.images links are replaced, plus three new nodes.

    A selected encoder shared by another SaveImage/PreviewImage output is
    rejected: use a dedicated inpaint branch first. Custom output-node semantics
    still require review against the installed ComfyUI schemas. The original
    graph is always unchanged.
    """
    dependencies = _validate_graph(graph)
    encode = _node(graph, encode_node_id, "VAEEncodeForInpaint")
    output = _node(graph, output_node_id, "SaveImage")
    image_link = _link(graph, encode["inputs"].get("pixels"), "encode.pixels", "IMAGE")
    mask_link = _link(graph, encode["inputs"].get("mask"), "encode.mask", "MASK")
    _link(graph, encode["inputs"].get("vae"), "encode.vae", "VAE")
    decode_link = _link(graph, output["inputs"].get("images"), "output.images", "IMAGE")
    decode = _node(graph, decode_link[0], "VAEDecode")
    if decode_link[1] != 0:
        raise ValueError("SaveImage must consume VAEDecode output slot 0")
    samples_link = _link(graph, decode["inputs"].get("samples"), "decode.samples", "LATENT")
    _link(graph, decode["inputs"].get("vae"), "decode.vae", "VAE")

    ancestors, pending = set(), [samples_link[0]]
    while pending:
        node_id = pending.pop()
        if node_id not in ancestors:
            ancestors.add(node_id)
            pending.extend(dependencies[node_id])
    if encode_node_id not in ancestors or samples_link[0] == encode_node_id:
        raise ValueError("VAEDecode samples must depend on the selected encode through a sampling path")

    consumers = {node_id: [] for node_id in graph}
    for node_id, upstream_nodes in dependencies.items():
        for upstream in upstream_nodes:
            consumers[upstream].append(node_id)
    affected, pending = set(), [encode_node_id]
    while pending:
        node_id = pending.pop()
        if node_id not in affected:
            affected.add(node_id)
            pending.extend(consumers[node_id])
    for node_id in affected:
        if node_id != output_node_id and graph[node_id]["class_type"] in {"SaveImage", "PreviewImage"}:
            raise ValueError(f"Encoder {encode_node_id!r} is shared by another image output {node_id!r}; use a dedicated branch")

    result = copy.deepcopy(graph)
    # Do not parse IDs as integers: arbitrary API IDs (and very long strings)
    # remain valid. Allocate new decimal IDs without overwriting any existing ID.
    new_ids, candidate = [], 1
    while len(new_ids) < 3:
        node_id = str(candidate)
        if node_id not in result:
            new_ids.append(node_id)
        candidate += 1
    crop_id, stitch_id, guard_id = new_ids
    result[crop_id] = {"class_type": "InpaintCropImproved", "inputs": _crop_inputs(copy.deepcopy(image_link), copy.deepcopy(mask_link))}
    result[encode_node_id]["inputs"]["pixels"] = [crop_id, 1]
    result[encode_node_id]["inputs"]["mask"] = [crop_id, 2]
    result[stitch_id] = {"class_type": "InpaintStitchImproved", "inputs": {
        "stitcher": [crop_id, 0], "inpainted_image": copy.deepcopy(decode_link),
    }}
    result[guard_id] = {"class_type": "ImageCompositeMasked", "inputs": {
        "destination": copy.deepcopy(image_link), "source": [stitch_id, 0],
        "mask": copy.deepcopy(mask_link), "x": 0, "y": 0, "resize_source": False,
    }}
    result[output_node_id]["inputs"]["images"] = [guard_id, 0]
    _validate_graph(result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Plain ComfyUI API graph JSON")
    parser.add_argument("output", type=Path, help="New output JSON path (must not exist)")
    parser.add_argument("--encode-node", required=True, help="VAEEncodeForInpaint node ID")
    parser.add_argument("--output-node", required=True, help="SaveImage node ID")
    args = parser.parse_args(argv)
    try:
        if args.input.resolve() == args.output.resolve():
            raise ValueError("Input and output paths must differ")
        graph = json.loads(args.input.read_text(encoding="utf-8-sig"))
        adapted = add_crop_and_stitch(graph, encode_node_id=args.encode_node, output_node_id=args.output_node)
        encoded = json.dumps(adapted, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        with args.output.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(encoded)
    except (OSError, ValueError) as exc:
        print(f"workflow_bridge: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {args.output}; graph transformation only, no image generation performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
