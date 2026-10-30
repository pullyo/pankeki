"""Build the existing Apple SDK helper into project-local cache; no downloads."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.tools' / 'photo-tools'


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cache = OUTPUT / 'module-cache'
    cache.mkdir(exist_ok=True)
    temporary = OUTPUT / 'vision-foreground-mask.building'
    command = ['/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc',
               '-module-cache-path', str(cache),
               str(ROOT / 'pankeki' / 'native' / 'foreground-mask.swift'),
               '-o', str(temporary)]
    result = subprocess.run(command, cwd=ROOT, timeout=120, check=False)
    if result.returncode == 0:
        temporary.replace(OUTPUT / 'vision-foreground-mask')
    else:
        temporary.unlink(missing_ok=True)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
