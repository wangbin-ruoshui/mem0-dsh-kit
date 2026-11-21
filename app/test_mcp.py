#!/usr/bin/env python
"""用官方 MCP 客户端连一次 mem0_mcp.py，验证握手 / 工具列表 / 实际调用。

    python test_mcp.py            # 握手 + 工具列表 + 检索
    python test_mcp.py --no-call  # 只验证握手和工具列表
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

import config

PY = str(config.HOME / ".venv" / "Scripts" / "python.exe")
SERVER = str(config.HOME / "app" / "mem0_mcp.py")


async def main(no_call: bool) -> int:
    params = StdioServerParameters(command=PY, args=[SERVER], env={"MEM0_HOME": str(config.HOME)})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("[PASS] initialize")

            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print(f"[PASS] tools: {names}")

            if no_call:
                return 0

            try:
                res = await session.call_tool("search_memories", {"query": "我用什么语言写代码", "limit": 2})
                text = res.content[0].text if res.content else "{}"
                hits = json.loads(text).get("results", [])
                print(f"[PASS] search_memories -> {len(hits)} hits")
                for h in hits:
                    print(f"        {h.get('score'):.3f}  {h.get('memory')}")
            except Exception as e:
                print(f"[FAIL] search_memories: {type(e).__name__}: {e}")
                return 1

    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-call", action="store_true")
    raise SystemExit(asyncio.run(main(ap.parse_args().no_call)))
