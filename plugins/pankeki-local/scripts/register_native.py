#!/usr/bin/env python3
"""Scoped native MCP registration using Codex CLI; never edit config.toml directly."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

NAME = "pankeki-local"
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
BINDING = json.loads((PACKAGE_ROOT / "mcp.json").read_text())["mcpServers"][NAME]
ROOT = Path(BINDING["env"]["PANKEKI_APP_ROOT"])
RELEASE = ROOT / "runtime/macos/pankeki-mcp-20261023/release"
CONFIG = Path.home() / ".codex/config.toml"
RECORD = RELEASE / "native-registration.json"

def config_data():
    try:
        import tomllib
    except ImportError as exc:
        raise ValueError('Run native registration with the dedicated MCP Python (3.11+).') from exc
    return tomllib.loads(CONFIG.read_text()) if CONFIG.exists() else {}

def without_ours(value):
    value = json.loads(json.dumps(value,default=str))
    servers = value.get("mcp_servers", {})
    servers.pop(NAME,None)
    if not servers:
        value.pop("mcp_servers",None)
    return value

def config_semantics_without_ours(value):
    value = without_ours(value)
    for server in value.get("mcp_servers", {}).values():
        if "command" in server:
            server.setdefault("args", [])
        for field in ("startup_timeout_sec", "tool_timeout_sec"):
            if field in server and isinstance(server[field], (int, float)):
                server[field] = float(server[field])
    return value

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str).encode()).hexdigest()

def save(value):
    RECORD.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")
    RECORD.chmod(0o600)

def run(command):
    result = subprocess.run(command,capture_output=True,text=True,timeout=30)
    if result.returncode:
        raise RuntimeError(repr(command)+"\n"+result.stderr+result.stdout)
    return {"command":command,"stdout":result.stdout,"stderr":result.stderr}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode",choices=["prepare","add","remove"])
    args = parser.parse_args()
    binding = json.loads((ROOT/"plugins/pankeki-local/mcp.json").read_text())["mcpServers"][NAME]
    codex = shutil.which("codex")
    command = [codex,"mcp","add",NAME]
    for key,value in sorted(binding["env"].items()):
        command.extend(["--env",key+"="+value])
    command += ["--",binding["command"],*binding["args"]]
    before = config_data()
    current = before.get("mcp_servers",{}).get(NAME)
    if args.mode == "prepare":
        if current is not None:
            raise ValueError("Native name already exists; refusing to replace it")
        record = {"server_name":NAME,"config":str(CONFIG),"prepared_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "command":command,"before_other_config_sha256":digest(without_ours(before)),
                  "before_other_semantic_sha256":digest(config_semantics_without_ours(before)),
                  "before_other_server_names":sorted(before.get("mcp_servers",{})),
                  "added":False,"removed":False}
        if RECORD.exists():
            raise ValueError("Native registration record already exists; preserve it")
        save(record)
    else:
        record = json.loads(RECORD.read_text())
        if record.get("server_name")!=NAME:
            raise ValueError("Native record ownership mismatch")
        if args.mode == "add":
            if current is not None or record["added"]:
                raise ValueError("Native entry already exists; inspect instead of repeating")
            if digest(without_ours(before))!=record["before_other_config_sha256"]:
                raise ValueError("Configuration changed since preparation; inspect before adding")
            record["add_result"] = run(record["command"])
            after = config_data()
            record["actual_entry"] = after.get("mcp_servers",{}).get(NAME)
            record["other_config_literal_preserved"] = without_ours(after)==without_ours(before)
            record["other_config_preserved"] = config_semantics_without_ours(after)==config_semantics_without_ours(before)
            record["added"] = record["actual_entry"] is not None
            record["get_result"] = json.loads(run([codex,"mcp","get",NAME,"--json"])["stdout"])
            entries = json.loads(run([codex,"mcp","list","--json"])["stdout"])
            record["list_matches"] = [v for v in entries if v.get("name")==NAME]
            save(record)
            if not record["added"] or not record["other_config_preserved"] or not record["list_matches"]:
                raise RuntimeError("Native registration verification failed; inspect record")
        else:
            if not record["added"] or record["removed"] or current!=record["actual_entry"]:
                raise ValueError("Native entry is absent or changed; refusing an unowned removal")
            record["remove_result"] = run([codex,"mcp","remove",NAME])
            record["removed"] = NAME not in config_data().get("mcp_servers",{})
            record["other_config_preserved_on_remove"] = config_semantics_without_ours(config_data())==config_semantics_without_ours(before)
            save(record)
    print(json.dumps({"mode":args.mode,"record":str(RECORD),"server_name":NAME,
                      "added":record["added"],"removed":record["removed"],
                      "other_config_preserved":record.get("other_config_preserved")},ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
        print(str(exc),file=sys.stderr)
        raise SystemExit(2)
