#!/usr/bin/env python3
"""Official SDK stdio discovery/status probe; never submits or cancels a job."""
import argparse
import asyncio
import datetime
import json
import hashlib
from pathlib import Path
from mcp import Client
from mcp.client.stdio import StdioServerParameters

EXPECTED = {"pankeki_get_status","pankeki_generate_image","pankeki_edit_image",
            "pankeki_get_job","pankeki_get_result","pankeki_cancel_job"}

async def probe(config_path, mode, expected_error):
    config = json.loads(config_path.read_text())["mcpServers"]["pankeki-local"]
    params = StdioServerParameters(command=config["command"], args=config.get("args", []),
                                   env=config.get("env", {}), cwd=config.get("cwd"))
    async with Client(params, mode=mode, read_timeout_seconds=20) as client:
        tools = await client.list_tools()
        tool_names = {t.name for t in tools.tools}
        if tool_names != EXPECTED:
            raise ValueError("Unexpected tools: " + repr(sorted(tool_names)))
        status = await client.call_tool("pankeki_get_status", {})
        data = status.model_dump(mode="json", by_alias=True)
        if data.get("isError"):
            raise ValueError("Status tool error: " + json.dumps(data,ensure_ascii=False))
        negative = None
        if expected_error:
            failed = await client.call_tool('pankeki_get_result', {'job_id':'bad'})
            negative = failed.model_dump(mode='json', by_alias=True)
            text = ' '.join(v.get('text','') for v in negative.get('content',[]))
            if not negative.get('isError') or 'job_id must be exactly32 lowercase hex characters' not in text:
                raise ValueError('Expected adapter error details were not preserved: '+text)
        return {"protocol_version":client.session.protocol_version,
                "tools":tools.model_dump(mode="json", by_alias=True), "status":data,
                "expected_error":negative}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=["auto","legacy"], default="legacy")
    parser.add_argument('--expected-error', action='store_true')
    args = parser.parse_args()
    config = args.config or Path(__file__).resolve().parents[1] / "mcp.json"
    result = {"checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope":"standalone official MCP client; not Codex host tool exposure",
              "mode":args.mode,"config":str(config.resolve()),"gpu_submission":False}
    try:
        result.update(asyncio.run(probe(config,args.mode,args.expected_error)))
        binding = json.loads(config.read_text())['mcpServers']['pankeki-local']
        entry = Path(binding['env']['PANKEKI_APP_ROOT'])/'plugins/pankeki-local/server/pankeki_mcp.py'
        result['server_sha256'] = hashlib.sha256(entry.read_bytes()).hexdigest()
        result['expected_error_checked'] = args.expected_error
        result["passed"] = True
    except Exception as exc:
        result.update(passed=False,error_type=type(exc).__name__,error=str(exc))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"passed":result["passed"],"report":str(args.output)},ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)

if __name__ == "__main__":
    main()
