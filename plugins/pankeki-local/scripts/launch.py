#!/usr/bin/env python3
"""Launch the owned MCP entry point without writing to protocol stdout."""
import os
from pathlib import Path
import sys

def main():
    plugin_root = Path(__file__).resolve().parents[1]
    app_value = os.environ.get("PANKEKI_APP_ROOT", "")
    python_value = os.environ.get("PANKEKI_PYTHON", "")
    app = Path(app_value) if app_value else None
    python = Path(python_value) if python_value else None
    if app is None or not app.is_absolute() or not (app / "pankeki/server.py").is_file():
        print("Pankeki app root is missing or not mounted; set PANKEKI_APP_ROOT.", file=sys.stderr)
        return 2
    if python is None or not python.is_absolute() or not python.is_file() or not os.access(python, os.X_OK):
        print("Pankeki MCP Python runtime is missing; install the dedicated runtime.", file=sys.stderr)
        return 2
    entry = plugin_root / "server/pankeki_mcp.py"
    if not entry.is_file():
        print("Pankeki MCP server entry point is missing: " + str(entry), file=sys.stderr)
        return 2
    command = [str(python), "-B", str(entry), "--app-root", str(app),
               "--api-url", os.environ.get("PANKEKI_API_URL", "http://127.0.0.1:8190"),
               *sys.argv[1:]]
    try:
        os.execv(str(python), command)
    except OSError as exc:
        print("Pankeki MCP startup failed: " + str(exc), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
