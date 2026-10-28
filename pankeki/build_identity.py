"""Content identities for source, generated HTML and the desktop runtime.

These values identify bytes. They do not attest installation, execution or quality.
Models, downloads, caches, user projects and generated output are never inputs.
"""
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import re


_SHA = re.compile(r'[0-9a-f]{64}\Z')
_REQUIRED = ('pankeki/__init__.py', 'web/build.py', 'web/src/index.template.html',
             'web/assets/pankeki-user-20261025.png', 'web/assets/motion-demo/project.json',
             'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/shell.html',
             'desktop/package.json')
# The UI font is delivered as a separate immutable file named by its content hash.
FONT_SOURCE = 'web/vendor/pretendard/PretendardVariable.woff2'
FONT_ROUTE = re.compile(r'/assets/fonts/pretendard-([0-9a-f]{16})\.woff2\Z')


def font_asset_path(data):
    """URL path for exact font bytes; build and server must derive it identically."""
    return '/assets/fonts/pretendard-' + hashlib.sha256(data).hexdigest()[:16] + '.woff2'


def _digest_files(root, files):
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        data = path.read_bytes()
        digest.update(path.relative_to(root).as_posix().encode('utf-8') + b'\0')
        digest.update(len(data).to_bytes(8, 'big'))
        digest.update(data)
    return digest.hexdigest()


def desktop_content_id(directory):
    """Hash actual runtime files, ignoring declared package/release identifiers."""
    directory = Path(directory)
    try:
        if not all((directory / name).is_file() for name in ('main.cjs', 'preload.cjs', 'shell.html')):
            return None
        files = [path for path in directory.iterdir()
                 if path.suffix == '.cjs' or path.name == 'shell.html']
        if any(path.is_symlink() or not path.is_file() for path in files):
            return None
        shared = directory.parent / 'web/src/profiles.js'
        logical = {path.name: path for path in files}
        if 'profiles.cjs' not in logical and shared.exists():
            if shared.is_symlink() or not shared.is_file():
                return None
            logical['profiles.cjs'] = shared
        digest = hashlib.sha256()
        for name, path in sorted(logical.items()):
            data = path.read_bytes()
            digest.update(name.encode('utf-8') + b'\0')
            digest.update(len(data).to_bytes(8, 'big'))
            digest.update(data)
        return digest.hexdigest()
    except (OSError, ValueError):
        return None


def source_content_id(root):
    """Hash build/runtime source and embedded assets without traversing runtime data."""
    root = Path(root)
    try:
        if not all((root / name).is_file() for name in _REQUIRED):
            return None
        code = {root / 'web/build.py', root / 'desktop/package.json'}
        for folder, suffixes in [('pankeki', {'.py'}), ('web/src', {'.js', '.css', '.html'}),
                                 ('plugins/pankeki-local/server', {'.py'})]:
            code.update(path for path in (root / folder).rglob('*') if path.suffix in suffixes and path.is_file())
        code.update(path for path in (root / 'desktop').iterdir()
                    if path.suffix == '.cjs' or path.name == 'shell.html')
        code.update((root / 'desktop/scripts').glob('*.cjs'))
        if any(path.is_symlink() or not path.is_file() for path in code):
            return None
        # Only assets actually consumed by web/build.py are read; never walk models/runtime.
        assets = {root / 'web/assets/pankeki-user-20261025.png',
                  root / 'web/assets/motion-demo/project.json'}
        assets.update((root / 'web/assets/redesign').glob('*.png'))
        assets.update((root / 'web/vendor/lucide').glob('*.svg'))
        font = root / FONT_SOURCE
        if font.is_file():
            assets.add(font)
        return _digest_files(root, code | assets)
    except (OSError, ValueError):
        return None


class _MarkerParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.markers = []

    def handle_starttag(self, tag, attrs):
        if tag != 'meta':
            return
        names = [value for key, value in attrs if key == 'name']
        if 'pankeki-source-id' not in names:
            return
        values = [value for key, value in attrs if key == 'content']
        self.markers.append(values[0] if len(names) == len(values) == 1 else None)


def html_source_id(html_bytes):
    try:
        parser = _MarkerParser()
        parser.feed(html_bytes.decode('utf-8'))
        if len(parser.markers) == 1 and isinstance(parser.markers[0], str) and _SHA.fullmatch(parser.markers[0]):
            return parser.markers[0]
    except (UnicodeError, ValueError):
        pass
    return None


def get_build_identity(root, *, html_bytes=None, process_source_id=None):
    """Return independent source/HTML observations; missing evidence stays unknown."""
    root = Path(root)
    source = source_content_id(root)
    desktop = desktop_content_id(root / 'desktop')
    if html_bytes is None:
        try:
            html_bytes = (root / 'web/index.html').read_bytes()
        except OSError:
            pass
    html_id = html_source_id(html_bytes) if isinstance(html_bytes, bytes) else None
    html_hash = hashlib.sha256(html_bytes).hexdigest() if isinstance(html_bytes, bytes) else None
    status = 'unknown' if source is None or html_id is None else 'match' if source == html_id else 'mismatch'
    process_id = process_source_id if isinstance(process_source_id, str) and _SHA.fullmatch(process_source_id) else None
    process_status = 'unknown' if source is None or process_id is None else 'match' if source == process_id else 'mismatch'
    reason = ('source-unavailable' if source is None else 'html-unavailable' if html_hash is None
              else 'html-marker-unavailable' if html_id is None else 'source-html-differ' if status == 'mismatch' else None)
    return {'schema': 1, 'source_id': source, 'html_source_id': html_id, 'html_sha256': html_hash,
            'desktop_source_id': desktop, 'status': status, 'reason': reason,
            'process_source_id': process_id, 'process_status': process_status}
