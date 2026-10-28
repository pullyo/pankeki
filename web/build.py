"""Build one self-contained HTML file, optionally embedding pinned design assets."""
from pathlib import Path
import base64
import io
import json
import re
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from pankeki.build_identity import FONT_SOURCE, font_asset_path, html_source_id, source_content_id

SCRIPT_MODULES = (
    'profiles.js', 'character-document.js', 'character-renderer.js',
    'character-export.js', 'character-motion.js',
    'character-document-v3.js', 'character-renderer-v3.js',
    'character-export-v3.js', 'character-workspace-v3.js',
    'cubism-package.js', 'cubism-session.js', 'cubism-controller.js',
    'cubism-workspace.js', 'project-library.js', 'app.js', 'studio.js',
    'photo-editor.js', 'redesign.js', 'desktop-chat.js')
SCRIPT_DEPENDENCIES = {
    'profiles.js': (), 'character-document.js': ('profiles.js',), 'character-renderer.js': (),
    'character-export.js': ('character-document.js', 'character-renderer.js'),
    'character-motion.js': ('character-document.js', 'character-renderer.js', 'character-export.js'),
    'character-document-v3.js': ('character-document.js',),
    'character-renderer-v3.js': ('character-document-v3.js', 'character-renderer.js'),
    'character-export-v3.js': ('character-document-v3.js', 'character-renderer-v3.js'),
    'character-workspace-v3.js': ('character-document-v3.js', 'character-renderer-v3.js', 'character-export-v3.js'),
    'cubism-package.js': (), 'cubism-session.js': (),
    'cubism-controller.js': ('cubism-package.js', 'cubism-session.js'),
    'cubism-runtime.js': ('cubism-package.js', 'cubism-controller.js'),
    'cubism-workspace.js': ('cubism-package.js', 'cubism-session.js', 'cubism-controller.js'),
    'project-library.js': ('profiles.js',),
    'app.js': ('character-motion.js', 'character-workspace-v3.js', 'cubism-workspace.js', 'project-library.js'),
    'studio.js': ('app.js',), 'photo-editor.js': ('app.js', 'studio.js'),
    'redesign.js': ('app.js', 'studio.js', 'photo-editor.js'),
    'desktop-chat.js': ('app.js', 'studio.js', 'redesign.js'),
}


def validate_script_order(scripts):
    if len(set(scripts)) != len(scripts) or not set(SCRIPT_MODULES).issubset(scripts):
        raise ValueError('Duplicate or missing JavaScript module')
    ready = set()
    for name in scripts:
        if name not in SCRIPT_DEPENDENCIES:
            raise ValueError('Unregistered JavaScript module: ' + name)
        dependencies = set(SCRIPT_DEPENDENCIES[name])
        if name == 'cubism-workspace.js' and 'cubism-runtime.js' in scripts:
            dependencies.add('cubism-runtime.js')
        if not dependencies.issubset(ready):
            raise ValueError('JavaScript dependency order invalid: ' + name)
        ready.add(name)
# Original minimal fallback drawings; they are not distributed as Lucide assets.
FALLBACK = {
 'layers':'<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
 'sparkles':'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/><path d="M20 2v4M18 4h4"/>',
 'wand-sparkles':'<path d="m4 20 13-13 3 3L7 23Z"/><path d="m13 11 3 3M6 2v6M3 5h6M20 1v4M18 3h4"/>',
 'brush':'<path d="m10 14 9-10 2 2-9 10Z"/><path d="M10 14c-5-1-3 6-7 6 4 2 10 1 9-4"/>',
 'eraser':'<path d="m4 12 9-9 8 8-9 10H8l-6-6Z"/><path d="m9 7 8 8M12 21h10"/>',
 'circle-help':'<circle cx="12" cy="12" r="9"/><path d="M9 9c0-4 7-4 7 0 0 2-4 3-4 5M12 17v.3"/>',
 'settings-2':'<path d="M3 7h10m4 0h4M3 17h4m4 0h10"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 'sliders-horizontal':'<path d="M3 7h5m4 0h9M3 17h11m4 0h3"/><path d="M8 4h4v6H8ZM14 14h4v6h-4Z"/>',
 'cpu':'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
 'chevron-down':'<path d="m6 9 6 6 6-6"/>',
 'upload':'<path d="M12 15V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
 'download':'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
 'image':'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
 'plus':'<path d="M12 4v16M4 12h16"/>',
 'arrow-right':'<path d="M3 12h17m-6-6 6 6-6 6"/>',
 'arrow-up-right':'<path d="M5 19 19 5M5 5h14v14"/>',
 'check':'<path d="m5 12 4 4L20 5"/>',
 'x':'<path d="m5 5 14 14M5 19 19 5"/>',
 'rotate-ccw':'<path d="M4 8a9 9 0 1 1-1 8M4 3v5h5"/>',
 'history':'<path d="M4 8a9 9 0 1 1-1 8M4 3v5h5M12 7v6l4 2"/>',
 'shield-check':'<path d="m12 2 8 3v7c0 6-8 10-8 10S4 18 4 12V5Z"/><path d="m8 11 3 3 5-6"/>',
 'trash-2':'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 'mouse-pointer-2':'<path d="m4 3 16 9-7 2-2 7Z"/>',
 'loader-circle':'<path d="M21 12a9 9 0 1 1-9-9"/>',
}

def icon(match):
    name = match.group(1)
    path = ROOT/'vendor'/'lucide'/f'{name}.svg'
    if path.exists():
        raw = path.read_text(encoding='utf-8')
        body = re.search(r'<svg\b[^>]*>(.*?)</svg>', raw, re.S).group(1)
    else:
        body = FALLBACK[name]
    return f'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'

def build():
    source_id = source_content_id(ROOT.parent)
    if source_id is None:
        raise RuntimeError('Source content identity unavailable; refusing an unidentified build')
    font = ROOT.parent/FONT_SOURCE
    font_url = None
    css = (ROOT/'src'/'style.css').read_text(encoding='utf-8') + '\n' + (ROOT/'src'/'redesign.css').read_text(encoding='utf-8') + '\n' + (ROOT/'src'/'desktop-chat.css').read_text(encoding='utf-8') + '\n' + (ROOT/'src'/'photo-editor.css').read_text(encoding='utf-8')
    if font.exists():
        # Served by pankeki/server.py from FONT_SOURCE with a long immutable cache.
        # The hashed name changes with the bytes, so the no-store page never pins stale fonts.
        font_url = font_asset_path(font.read_bytes())
        css = css.replace('{{FONT_URL}}', 'url("' + font_url + '")')
    else:
        # Resolve nested template braces before removing the optional font rule.
        # Otherwise {{FONT_URL}} ends the regex early and breaks the :root rule.
        css = css.replace('{{FONT_URL}}', 'url("")')
        css = re.sub(r'@font-face\{[^}]+\}\s*', '', css, count=1)
    html = (ROOT/'src'/'index.template.html').read_text(encoding='utf-8')
    # User-provided 128px PNG, copied byte-for-byte; preserve its cream background.
    # Earlier logo originals and studies remain preserved as inactive assets.
    logo = ROOT/'assets'/'pankeki-user-20261025.png'
    logo_url = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
    # CharacterDesign must be available before application initialization.
    script_names = list(SCRIPT_MODULES)
    if (ROOT/'src'/'cubism-runtime.js').is_file():
        script_names.insert(script_names.index('cubism-workspace.js'), 'cubism-runtime.js')
    validate_script_order(script_names)
    scripts = '\n;\n'.join((ROOT/'src'/name).read_text(encoding='utf-8') for name in script_names)
    # Reference artwork is encoded once at a display-appropriate size. The
    # server can still deliver one portable HTML file without new asset routes.
    from PIL import Image
    artwork = {}
    for path in sorted((ROOT/'assets'/'redesign').glob('*.png')):
        with Image.open(path) as image:
            image.load()
            limit = 2048 if path.stem == 'home-honey-background' else 1200 if path.stem in ('pancake-cat', 'catgirl-hero') else 520
            image.thumbnail((limit,limit), Image.Resampling.LANCZOS)
            data = io.BytesIO()
            image.save(data, format='WEBP', quality=88, method=6)
            artwork[path.stem] = 'data:image/webp;base64,' + base64.b64encode(data.getvalue()).decode()
    library_icons = {}
    for path in sorted((ROOT/'vendor'/'lucide').glob('*.svg')):
        raw = path.read_text(encoding='utf-8')
        body = re.search(r'<svg\b[^>]*>(.*?)</svg>', raw, re.S).group(1)
        library_icons[path.stem] = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>'
    data_json = json.dumps({'images':artwork, 'icons':library_icons}, ensure_ascii=False, separators=(',', ':'))
    data_json = data_json.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = html.replace('</head>', '<script id="redesignAssets" type="application/json">' + data_json + '</script>\n</head>')
    # The original demo follows the same validated v2 load path as user projects.
    # Embed its own PNG bytes; never rely on an asset-serving route or remote URL.
    demo = json.loads((ROOT/'assets'/'motion-demo'/'project.json').read_text(encoding='utf-8'))
    demo_json = json.dumps(demo, ensure_ascii=False, separators=(',', ':'))
    demo_json = demo_json.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = html.replace('{{MOTION_DEMO_JSON}}', demo_json)
    html = html.replace('{{STYLE}}', css).replace('{{SCRIPT}}', scripts).replace('{{LOGO_URL}}', logo_url)
    html = re.sub(r'\{\{icon:([a-z0-9-]+)\}\}', icon, html)
    if font_url:
        html = html.replace('</head>', '<link rel="preload" href="' + font_url + '" as="font" type="font/woff2" crossorigin>\n</head>', 1)
    html = html.replace('</head>', '<meta name="pankeki-source-id" content="' + source_id + '">\n</head>', 1)
    # Nested JavaScript object literals may contain '{{' legitimately.
    unresolved = re.findall(r'\{\{(?:[A-Z_]+|icon:[a-z0-9-]+)\}\}', html)
    if unresolved: raise RuntimeError('Unresolved template token: ' + ', '.join(unresolved))
    if html_source_id(html.encode('utf-8')) != source_id:
        raise RuntimeError('Generated HTML has no unique source identity')
    if source_content_id(ROOT.parent) != source_id:
        raise RuntimeError('Source changed during build; previous HTML preserved')
    (ROOT/'index.html').write_text(html, encoding='utf-8')
    print(json.dumps({'file':str(ROOT/'index.html'),'bytes':len(html.encode()),'source_id':source_id,'logo_embedded':str(logo),'profiles_embedded':True,'pretendard_url':font_url,'lucide_downloaded':(ROOT/'vendor'/'lucide'/'LICENSE').exists()}))

if __name__ == '__main__': build()
