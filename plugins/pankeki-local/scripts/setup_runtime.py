#!/usr/bin/env python3
"""Install only the approved MCP dependencies into the dedicated plugin runtime."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline-wheelhouse", type=Path)
    args = parser.parse_args()
    plugin = Path(__file__).resolve().parents[1]
    config = json.loads((plugin / "mcp.json").read_text())["mcpServers"]["pankeki-local"]["env"]
    app = Path(config["PANKEKI_APP_ROOT"])
    runtime_python = Path(config["PANKEKI_PYTHON"])
    expected = app / "runtime/macos/pankeki-mcp-20261023/release/venv/bin/python"
    if runtime_python != expected or not (app / "pankeki/server.py").is_file():
        raise ValueError("Unexpected dedicated runtime or missing Pankeki app root")
    if not runtime_python.is_file():
        subprocess.run([str(app / ".venv-macos/bin/python"), "-m", "venv",
                        str(runtime_python.parent.parent)], check=True)
    command = [str(runtime_python), "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
               "-r", str(plugin / "server/requirements.txt")]
    if args.offline_wheelhouse:
        command.extend(["--no-index", "--find-links", str(args.offline_wheelhouse.resolve())])
    subprocess.run(command, check=True)
    subprocess.run([str(runtime_python), "-m", "pip", "check"], check=True)

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print("Pankeki MCP runtime setup: " + str(exc), file=sys.stderr)
        raise SystemExit(2)
