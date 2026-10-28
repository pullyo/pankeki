"""Build identity observes actual source/HTML bytes, not declared release flags."""
import importlib
from pathlib import Path
import tempfile
import unittest


class BuildIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name, data in {
            'pankeki/__init__.py': b'', 'pankeki/engine.py': b'answer = 1\n',
            'web/build.py': b'# builder\n', 'web/src/index.template.html': b'<html></html>',
            'web/src/app.js': b'const value=1;\n', 'web/assets/pankeki-user-20261025.png': b'logo',
            'web/assets/motion-demo/project.json': b'{}',
            'desktop/main.cjs': b'module.exports=1;\n', 'desktop/preload.cjs': b'// narrow IPC\n',
            'desktop/shell.html': b'<html>shell</html>', 'desktop/package.json': b'{"version":"0.1.0"}',
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def identity(self):
        self.assertIsNotNone(importlib.util.find_spec('pankeki.build_identity'),
                             'build identity implementation is absent')
        return importlib.import_module('pankeki.build_identity')

    @staticmethod
    def html(identifier):
        return f'<html><head><meta name="pankeki-source-id" content="{identifier}"></head></html>'.encode()

    def test_source_change_is_detected_but_generated_and_runtime_files_are_excluded(self):
        module = self.identity()
        before = module.source_content_id(self.root)
        self.assertRegex(before, r'^[0-9a-f]{64}$')
        for name in ['web/index.html', 'runtime/state.json', 'output/result.png', 'tests/test_ignored.py']:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('not a build source')
        self.assertEqual(module.source_content_id(self.root), before)
        (self.root / 'web/src/app.js').write_text('const value=2;\n')
        self.assertNotEqual(module.source_content_id(self.root), before)

    def test_embedded_asset_change_is_detected(self):
        module = self.identity()
        before = module.source_content_id(self.root)
        (self.root / 'web/assets/pankeki-user-20261025.png').write_bytes(b'new logo')
        self.assertNotEqual(module.source_content_id(self.root), before)

    def test_served_font_bytes_remain_in_source_identity_and_route_name(self):
        module = self.identity()
        font = self.root / module.FONT_SOURCE
        font.parent.mkdir(parents=True)
        font.write_bytes(b'font one')
        before = module.source_content_id(self.root)
        self.assertRegex(module.font_asset_path(b'font one'), module.FONT_ROUTE)
        html = self.html(before)
        self.assertEqual(module.get_build_identity(self.root, html_bytes=html)['status'], 'match')
        font.write_bytes(b'font two')
        self.assertNotEqual(module.source_content_id(self.root), before)
        self.assertNotEqual(module.font_asset_path(b'font two'), module.font_asset_path(b'font one'))
        self.assertEqual(module.get_build_identity(self.root, html_bytes=html)['status'], 'mismatch')

    def test_mcp_runtime_source_changes_are_not_hidden_by_excluded_download_paths(self):
        module = self.identity()
        plugin = self.root / 'plugins/pankeki-local/server/pankeki_mcp.py'
        plugin.parent.mkdir(parents=True)
        plugin.write_text('def handle(): return 1\n')
        before = module.source_content_id(self.root)
        download = self.root / 'runtime/macos/qwen-edit/downloads/part.bin'
        download.parent.mkdir(parents=True)
        download.write_bytes(b'a model download')
        self.assertEqual(module.source_content_id(self.root), before)
        plugin.write_text('def handle(): return 2\n')
        self.assertNotEqual(module.source_content_id(self.root), before)

    def test_source_relocation_does_not_change_identity(self):
        import shutil
        module = self.identity()
        other = self.root / 'copy'
        for name in ['pankeki', 'web', 'desktop']:
            shutil.copytree(self.root / name, other / name)
        self.assertEqual(module.source_content_id(other), module.source_content_id(self.root))

    def test_stale_html_does_not_claim_a_match(self):
        module = self.identity()
        old_id = module.source_content_id(self.root)
        html = self.html(old_id)
        self.assertEqual(module.get_build_identity(self.root, html_bytes=html)['status'], 'match')
        (self.root / 'pankeki/engine.py').write_text('answer = 2\n')
        result = module.get_build_identity(self.root, html_bytes=html)
        self.assertEqual(result['status'], 'mismatch')
        self.assertEqual(result['html_source_id'], old_id)
        self.assertNotEqual(result['source_id'], old_id)
        self.assertNotIn(str(self.root), str(result))

    def test_process_start_source_is_explicit_not_inferred_from_current_disk(self):
        module = self.identity()
        start = module.source_content_id(self.root)
        self.assertIsNone(module.get_build_identity(self.root).get('process_source_id'))
        self.assertEqual(module.get_build_identity(self.root).get('process_status'), 'unknown')
        (self.root / 'pankeki/engine.py').write_text('changed after process startup')
        result = module.get_build_identity(self.root, process_source_id=start)
        self.assertEqual(result['process_source_id'], start)
        self.assertNotEqual(result['source_id'], start)
        self.assertEqual(result['process_status'], 'mismatch')
        self.assertIsNone(module.get_build_identity(self.root, process_source_id='declared-release').get('process_source_id'))

    def test_missing_or_duplicate_html_marker_remains_unknown(self):
        module = self.identity()
        marker = self.html(module.source_content_id(self.root))
        for html in [b'<html></html>', self.html('not-a-sha'), marker + marker]:
            with self.subTest(html=html):
                result = module.get_build_identity(self.root, html_bytes=html)
                self.assertEqual(result['status'], 'unknown')
                self.assertIsNone(result['html_source_id'])
                self.assertIsNotNone(result['html_sha256'])

    def test_html_hash_observes_exact_served_bytes(self):
        import hashlib
        module = self.identity()
        first = self.html(module.source_content_id(self.root))
        second = first + b'\n<!-- another response -->'
        result = module.get_build_identity(self.root, html_bytes=second)
        self.assertEqual(result['html_sha256'], hashlib.sha256(second).hexdigest())
        self.assertNotEqual(module.get_build_identity(self.root, html_bytes=first)['html_sha256'],
                            result['html_sha256'])

    def test_missing_source_or_html_stays_unknown(self):
        module = self.identity()
        self.assertEqual(module.get_build_identity(self.root)['status'], 'unknown')
        (self.root / 'web/build.py').unlink()
        result = module.get_build_identity(self.root, html_bytes=self.html('a' * 64))
        self.assertEqual(result['status'], 'unknown')
        self.assertIsNone(result['source_id'])

    def test_desktop_hash_changes_for_bundle_code_not_package_version(self):
        module = self.identity()
        before = module.get_build_identity(self.root)['desktop_source_id']
        (self.root / 'desktop/package.json').write_text('{"version":"99.0.0"}')
        self.assertEqual(module.get_build_identity(self.root)['desktop_source_id'], before)
        (self.root / 'desktop/main.cjs').write_text('module.exports=2;\n')
        self.assertNotEqual(module.get_build_identity(self.root)['desktop_source_id'], before)

    def builder(self):
        spec = importlib.util.spec_from_file_location('pankeki_web_builder', Path(__file__).resolve().parents[1] / 'web/build.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_builder_rejects_dependency_missing_reordered_duplicate_or_unknown_modules(self):
        builder = self.builder()
        self.assertTrue(callable(getattr(builder, 'validate_script_order', None)), 'explicit dependency validation is absent')
        scripts = list(builder.SCRIPT_MODULES)
        builder.validate_script_order(scripts)
        bad = scripts.copy()
        bad.remove('profiles.js')
        reordered = scripts.copy()
        reordered.remove('app.js')
        reordered.insert(0, 'app.js')
        for invalid in [bad, reordered, scripts + ['app.js'], scripts + ['unregistered.js']]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                builder.validate_script_order(invalid)

    def prepared_builder(self):
        import shutil
        builder = self.builder()
        project = Path(__file__).resolve().parents[1]
        shutil.copytree(project / 'web/src', self.root / 'web/src', dirs_exist_ok=True)
        shutil.rmtree(self.root / 'web/assets')
        (self.root / 'web/assets').symlink_to(project / 'web/assets', target_is_directory=True)
        (self.root / 'web/vendor').symlink_to(project / 'web/vendor', target_is_directory=True)
        shutil.copy2(project / 'web/build.py', self.root / 'web/build.py')
        builder.ROOT = self.root / 'web'
        return builder

    def test_real_builder_embeds_identity_and_does_not_write_outside_selected_root(self):
        import contextlib
        import io
        builder, module = self.prepared_builder(), self.identity()
        project = Path(__file__).resolve().parents[1]
        original = (project / 'web/index.html').read_bytes()
        with contextlib.redirect_stdout(io.StringIO()):
            builder.build()
        generated = (self.root / 'web/index.html').read_bytes()
        self.assertEqual(module.html_source_id(generated), module.source_content_id(self.root))
        self.assertEqual(module.get_build_identity(self.root)['status'], 'match')
        self.assertEqual((project / 'web/index.html').read_bytes(), original)

    def test_changed_source_during_build_preserves_previous_html(self):
        from unittest.mock import patch
        builder = self.prepared_builder()
        previous = self.root / 'web/index.html'
        previous.write_bytes(b'previous build')
        original_icon, changed = builder.icon, False

        def changed_icon(match):
            nonlocal changed
            if not changed:
                changed = True
                (self.root / 'web/src/app.js').write_text('// changed while HTML was assembled')
            return original_icon(match)

        with patch.object(builder, 'icon', changed_icon), self.assertRaisesRegex(RuntimeError, 'Source changed'):
            builder.build()
        self.assertEqual(previous.read_bytes(), b'previous build')

    def test_duplicate_identity_marker_preserves_previous_html(self):
        builder = self.prepared_builder()
        template = self.root / 'web/src/index.template.html'
        template.write_text(template.read_text().replace('</head>', '<meta name="pankeki-source-id" content="' + 'a' * 64 + '"></head>'))
        previous = self.root / 'web/index.html'
        previous.write_bytes(b'previous build')
        with self.assertRaisesRegex(RuntimeError, 'unique source identity'):
            builder.build()
        self.assertEqual(previous.read_bytes(), b'previous build')


if __name__ == '__main__':
    unittest.main()
