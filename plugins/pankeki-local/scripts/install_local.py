#!/usr/bin/env python3
"""Prepare a scoped marketplace; install/restore only through supported Codex CLI."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

PLUGIN = "pankeki-local"
MARKETPLACE = "pankeki-local-dev"
SELECTOR = PLUGIN + "@" + MARKETPLACE
DEFAULT_HELPER = Path.home() / ".codex/.tmp/plugins/.agents/skills/plugin-creator/scripts/create_basic_plugin.py"

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()
            and not any(v in {"__pycache__", ".DS_Store", ".venv"} for v in p.relative_to(root).parts)}

def write_record(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)

def run_json(command):
    result = subprocess.run(command, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("Command failed: " + repr(command) + "\n" + result.stderr + result.stdout)
    return {"command": command, "data": json.loads(result.stdout), "stderr": result.stderr}

def existing_plugins_preserved(before, after):
    current = {v["pluginId"]:v for v in after.get("installed", [])}
    return all(current.get(v["pluginId"]) == v for v in before.get("installed", [])
               if v["pluginId"] != SELECTOR)

def restore_commands(record, codex):
    if record.get("plugin_id") != SELECTOR or record.get("marketplace") != MARKETPLACE:
        raise ValueError("Installation record ownership mismatch")
    applied = record.get("applied", {})
    result = []
    if applied.get("plugin_installed"):
        result.append([codex, "plugin", "remove", SELECTOR, "--json"])
    if applied.get("marketplace_added"):
        result.append([codex, "plugin", "marketplace", "remove", MARKETPLACE, "--json"])
    return result

def prepare(plugin_root, release, helper, codex, record_path):
    for relative in ["plugin.json", ".codex-plugin/plugin.json", "mcp.json", ".mcp.json",
                     "scripts/launch.py", "server/pankeki_mcp.py", "skills/pankeki/SKILL.md", "README.ko.md"]:
        if not (plugin_root / relative).is_file():
            raise ValueError("Package component is missing: " + relative)
    portable = json.loads((plugin_root / "plugin.json").read_text())
    legacy = json.loads((plugin_root / ".codex-plugin/plugin.json").read_text())
    if portable["name"] != PLUGIN or legacy["name"] != PLUGIN or portable["version"] != legacy["version"]:
        raise ValueError("Portable/compatibility identity mismatch")
    before_plugins = run_json([codex, "plugin", "list", "--json"])
    before_marketplaces = run_json([codex, "plugin", "marketplace", "list", "--json"])
    if any(v["pluginId"] == SELECTOR for v in before_plugins["data"].get("installed", [])):
        raise ValueError("This plugin is already installed; preserve its prior record and restore before replacing")
    if any(v["name"] == MARKETPLACE for v in before_marketplaces["data"].get("marketplaces", [])):
        raise ValueError("Marketplace name already registered; refusing to replace it")
    source_hashes = hashes(plugin_root)
    token = hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest()[:12]
    stage = release / ("marketplace-" + token)
    staged_plugin = stage / "plugins" / PLUGIN
    if stage.exists():
        raise ValueError("Prepared stage already exists; use its existing installation record")
    shutil.copytree(plugin_root, staged_plugin, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
    marketplace_file = stage / ".agents/plugins/marketplace.json"
    spec = importlib.util.spec_from_file_location("codex_plugin_authoring_helper", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.update_marketplace_json(marketplace_file, PLUGIN, "AVAILABLE", "ON_INSTALL", "Productivity", False)
    market = json.loads(marketplace_file.read_text())
    market["name"] = MARKETPLACE
    market["interface"]["displayName"] = "Pankeki Local Development"
    marketplace_file.write_text(json.dumps(market, ensure_ascii=False, indent=2) + "\n")
    if hashes(staged_plugin) != source_hashes:
        raise ValueError("Staged package differs from source")
    record = {"schema":1,"prepared_at":stamp(),"plugin_id":SELECTOR,"marketplace":MARKETPLACE,
              "version":portable["version"],"plugin_root":str(plugin_root),"stage":str(stage),
              "marketplace_file":str(marketplace_file),"source_hashes":source_hashes,
              "codex":codex,"authoring_helper":str(helper),
              "before_plugins":before_plugins,"before_marketplaces":before_marketplaces,
              "applied":{"marketplace_added":False,"plugin_installed":False},
              "steps":[]}
    write_record(record_path, record)
    return record

def install(record_path):
    record = json.loads(record_path.read_text())
    restore_commands(record, record["codex"])
    root = Path(record["plugin_root"])
    stage = Path(record["stage"])
    if hashes(root) != record["source_hashes"] or hashes(stage / "plugins" / PLUGIN) != record["source_hashes"]:
        raise ValueError("Source/stage changed after preparation; do not install a stale package")
    if any(record["applied"].values()):
        raise ValueError("Installation already started; inspect the record instead of repeating")
    c = record["codex"]
    for command, flag in [([c,"plugin","marketplace","add",str(stage),"--json"],"marketplace_added"),
                          ([c,"plugin","add",SELECTOR,"--json"],"plugin_installed")]:
        result = run_json(command)
        record["steps"].append(result)
        record["applied"][flag] = True
        write_record(record_path, record)
    record["after_plugins"] = run_json([c,"plugin","list","--json"])
    record["after_marketplaces"] = run_json([c,"plugin","marketplace","list","--json"])
    record["existing_plugins_preserved"] = existing_plugins_preserved(record["before_plugins"]["data"], record["after_plugins"]["data"])
    after_market = {v["name"]:v for v in record["after_marketplaces"]["data"].get("marketplaces", [])}
    record["existing_marketplaces_preserved"] = all(after_market.get(v["name"]) == v for v in record["before_marketplaces"]["data"].get("marketplaces", []))
    record["installed_at"] = stamp()
    write_record(record_path, record)
    if not record["existing_plugins_preserved"] or not record["existing_marketplaces_preserved"]:
        raise RuntimeError("An unrelated plugin/marketplace changed; inspect the installation record")
    return record

def restore(record_path):
    record = json.loads(record_path.read_text())
    commands = restore_commands(record, record["codex"])
    record.setdefault("restore_steps", [])
    for command in commands:
        record["restore_steps"].append(run_json(command))
        key = "plugin_installed" if command[2] == "remove" else "marketplace_added"
        record["applied"][key] = False
        write_record(record_path, record)
    record["restored_at"] = stamp()
    write_record(record_path, record)
    return record

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare","install","restore"])
    parser.add_argument("--record", type=Path)
    parser.add_argument("--helper", type=Path, default=DEFAULT_HELPER)
    args = parser.parse_args()
    plugin_root = Path(__file__).resolve().parents[1]
    config = json.loads((plugin_root / "mcp.json").read_text())
    app_root = Path(config["mcpServers"][PLUGIN]["env"]["PANKEKI_APP_ROOT"])
    release = app_root / "runtime/macos/pankeki-mcp-20261023/release"
    record_path = args.record or release / "install-record.json"
    if args.mode == "prepare":
        if record_path.exists():
            raise ValueError("Installation record already exists; preserve it and select another --record")
        codex = shutil.which("codex")
        if not codex or not args.helper.is_file():
            raise ValueError("Supported Codex CLI or bundled authoring helper not found")
        record = prepare(plugin_root, release, args.helper, codex, record_path)
    elif args.mode == "install":
        record = install(record_path)
    else:
        record = restore(record_path)
    print(json.dumps({"mode":args.mode,"record":str(record_path),"plugin_id":SELECTOR,
                      "marketplace_file":record["marketplace_file"],"applied":record["applied"]},
                     ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print("Pankeki local installation: " + str(exc), file=sys.stderr)
        raise SystemExit(2)
