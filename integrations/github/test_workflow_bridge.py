"""Behavior tests for the offline API-graph adapter; no ComfyUI/GPU required."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

try:
    import workflow_bridge as bridge
except ModuleNotFoundError:
    bridge = None


def example_graph():
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
        "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "existing.safetensors"}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "existing prompt", "clip": ["2", 1]}},
        "4": {"class_type": "VAEEncodeForInpaint", "inputs": {"pixels": ["1", 0], "mask": ["1", 1], "vae": ["2", 2], "grow_mask_by": 6}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["3", 0], "negative": ["3", 0], "latent_image": ["4", 0], "seed": 456, "steps": 20, "cfg": 7.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 0.7}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["2", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "unchanged"}, "_meta": {"title": "Save", "unvalidated": ["not-a-node", -99]}},
    }


class WorkflowBridgeTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(bridge, "workflow_bridge implementation is not present yet")
        self.graph = example_graph()

    def transform(self, graph=None):
        return bridge.add_crop_and_stitch(self.graph if graph is None else graph, encode_node_id="4", output_node_id="7")

    def nodes_of_type(self, graph, class_type):
        return [(key, node) for key, node in graph.items() if node["class_type"] == class_type]

    def test_keeps_original_and_unrelated_settings_unchanged(self):
        original = copy.deepcopy(self.graph)
        result = self.transform()
        self.assertEqual(self.graph, original)
        for node_id in ("1", "2", "3", "5", "6"):
            self.assertEqual(result[node_id], original[node_id])
        self.assertEqual(result["4"]["inputs"]["grow_mask_by"], 6)
        self.assertEqual(result["7"]["inputs"]["filename_prefix"], "unchanged")
        result["5"]["inputs"]["steps"] = 99
        self.assertEqual(self.graph["5"]["inputs"]["steps"], 20)

    def test_connects_crop_slots_and_original_decode_to_stitch(self):
        result = self.transform()
        crop_id, crop = self.nodes_of_type(result, "InpaintCropImproved")[0]
        stitch_id, stitch = self.nodes_of_type(result, "InpaintStitchImproved")[0]
        self.assertEqual(crop["inputs"]["image"], ["1", 0])
        self.assertEqual(crop["inputs"]["mask"], ["1", 1])
        self.assertEqual(result["4"]["inputs"]["pixels"], [crop_id, 1])
        self.assertEqual(result["4"]["inputs"]["mask"], [crop_id, 2])
        self.assertEqual(stitch["inputs"], {"stitcher": [crop_id, 0], "inpainted_image": ["6", 0]})
        self.assertNotEqual(stitch_id, crop_id)

    def test_guard_composites_over_original_using_original_mask(self):
        result = self.transform()
        stitch_id, _ = self.nodes_of_type(result, "InpaintStitchImproved")[0]
        guard_id, guard = self.nodes_of_type(result, "ImageCompositeMasked")[0]
        self.assertEqual(guard["inputs"], {"destination": ["1", 0], "source": [stitch_id, 0], "mask": ["1", 1], "x": 0, "y": 0, "resize_source": False})
        self.assertEqual(result["7"]["inputs"]["images"], [guard_id, 0])

    def test_crop_emits_all_required_widgets_with_preservation_defaults(self):
        crop = self.nodes_of_type(self.transform(), "InpaintCropImproved")[0][1]["inputs"]
        self.assertEqual(crop, {
            "image": ["1", 0], "mask": ["1", 1],
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
        })

    def test_allocates_noncolliding_ids_and_keeps_existing_nodes(self):
        self.graph["8"] = {"class_type": "SolidMask", "inputs": {"value": 0, "width": 32, "height": 32}}
        self.graph["pankeki_crop"] = {"class_type": "SolidMask", "inputs": {"value": 1, "width": 32, "height": 32}}
        result = self.transform()
        self.assertEqual(len(result), len(self.graph) + 3)
        self.assertEqual(result["8"], self.graph["8"])
        self.assertEqual(result["pankeki_crop"], self.graph["pankeki_crop"])
        self.assertEqual(len(set(result) - set(self.graph)), 3)

    def test_rejects_other_encode_class(self):
        self.graph["4"]["class_type"] = "VAEEncode"
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_other_output_class(self):
        self.graph["7"]["class_type"] = "PreviewImage"
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_invalid_mask_links(self):
        for bad_link in (["missing", 0], ["1", -1], ["1", True], ["1", "1"], ["1"], 1, ["1", 99]):
            with self.subTest(mask=bad_link):
                graph = example_graph()
                graph["4"]["inputs"]["mask"] = bad_link
                with self.assertRaises(ValueError):
                    self.transform(graph)

    def test_rejects_wrong_image_mask_slot_types(self):
        self.graph["4"]["inputs"]["mask"] = ["1", 0]
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_non_decode_output_link(self):
        self.graph["7"]["inputs"]["images"] = ["1", 0]
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_disconnected_encode_and_decode(self):
        self.graph["8"] = {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}}
        self.graph["5"]["inputs"]["latent_image"] = ["8", 0]
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_graph_cycles(self):
        self.graph["3"]["inputs"]["clip"] = ["3", 0]
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_missing_references_even_outside_selected_path(self):
        self.graph["8"] = {"class_type": "PreviewImage", "inputs": {"images": ["missing", 0]}}
        with self.assertRaises(ValueError):
            self.transform()

    def test_rejects_shared_encode_path_to_another_image_output(self):
        for output_class in ("SaveImage", "PreviewImage"):
            with self.subTest(output_class=output_class):
                graph = example_graph()
                graph["8"] = {"class_type": output_class, "inputs": {"images": ["6", 0]}}
                original = copy.deepcopy(graph)
                with self.assertRaises(ValueError):
                    self.transform(graph)
                self.assertEqual(graph, original)

    def test_keeps_independent_image_output_unchanged(self):
        self.graph["8"] = {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}}
        result = self.transform()
        self.assertEqual(result["8"], self.graph["8"])

    def test_ignores_node_meta_but_rejects_ui_or_request_wrappers(self):
        self.assertEqual(self.transform()["7"]["_meta"], self.graph["7"]["_meta"])
        for wrapped in ({"prompt": self.graph}, {"nodes": [], "links": []}, {}):
            with self.subTest(wrapped=list(wrapped)):
                with self.assertRaises(ValueError):
                    self.transform(wrapped)

    def test_cli_writes_json_without_overwriting_input(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            source = Path(directory) / "input.json"
            output = Path(directory) / "output.json"
            source.write_text(json.dumps(self.graph), encoding="utf-8")
            original = source.read_bytes()
            command = [sys.executable, str(Path(__file__).with_name("workflow_bridge.py")), str(source), str(output), "--encode-node", "4", "--output-node", "7"]
            completed = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(len(json.loads(output.read_text(encoding="utf-8"))), len(self.graph) + 3)
            self.assertEqual(source.read_bytes(), original)
            command[3] = str(source)
            rejected = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
