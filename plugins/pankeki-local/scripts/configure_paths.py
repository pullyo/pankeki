#!/usr/bin/env python3
"""Write mcp.json and .mcp.json for the location this checkout lives in now.

Hosts need absolute paths, so the declarations are generated rather than shared
between machines. `--check` reports drift without writing. Standard library only.
"""
import argparse
import json
from pathlib import Path
import sys

NAME = "pankeki-local"
PLUGIN = Path(__file__).resolve().parents[1]
RUNTIME_PYTHON = Path("runtime/macos/pankeki-mcp-20261023/release/venv/bin/python")


def binding(app_root, python, api_url):
    # Run the stdlib-only launcher with the dedicated runtime Python itself: macOS
    # /usr/bin/python3 is an Xcode shim that fails until the Xcode license is accepted.
    return {"type": "stdio", "command": str(python),
            "args": [str(PLUGIN / "scripts" / "launch.py")],
            "env": {"PANKEKI_APP_ROOT": str(app_root), "PANKEKI_PYTHON": str(python), "PANKEKI_API_URL": api_url}}


def documents(app_root, python, api_url):
    server = binding(app_root, python, api_url)
    return {"mcp.json": {"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {NAME: server}},
            ".mcp.json": {"mcpServers": {NAME: server}}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", type=Path, default=PLUGIN.parents[1], help="Pankeki project root (default: this checkout)")
    parser.add_argument("--python", type=Path, help="dedicated MCP runtime Python (default: <app-root>/" + str(RUNTIME_PYTHON) + ")")
    parser.add_argument("--api-url", default="http://127.0.0.1:8190")
    parser.add_argument("--check", action="store_true", help="exit 1 if the declarations differ; write nothing")
    args = parser.parse_args(argv)
    app_root = args.app_root.resolve()
    python = (args.python or app_root / RUNTIME_PYTHON).absolute()
    if not (app_root / "pankeki" / "server.py").is_file():
        print("Not a Pankeki app root: " + str(app_root), file=sys.stderr)
        return 2
    drift = []
    for name, data in documents(app_root, python, args.api_url).items():
        path = PLUGIN / name
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current == text:
            continue
        drift.append(name)
        if not args.check:
            path.write_text(text, encoding="utf-8")
    if not python.is_file():
        print("Note: MCP runtime Python is not installed yet: " + str(python) + " (run scripts/setup_runtime.py)", file=sys.stderr)
    if args.check:
        print("up to date" if not drift else "needs update: " + ", ".join(drift))
        return 1 if drift else 0
    print("updated: " + ", ".join(drift) if drift else "already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
