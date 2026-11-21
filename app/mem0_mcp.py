#!/usr/bin/env python
"""Mem0 的 stdio MCP 服务（兼容 mcp 2.x，MCPServer）。

被 DSH / Claude Code / Cursor 等客户端以子进程方式启动：
    python mem0_mcp.py

暴露三个工具：
    search_memories(query, limit, user_id)
    add_memory(text, user_id)
    list_memories(limit, user_id)

注意：stdout 是 JSON-RPC 专用通道，任何调试输出都必须走 stderr。
"""

from __future__ import annotations

import contextlib
import json
import sys

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import config

_memory = None


def _memory_instance():
    global _memory
    if _memory is None:
        with contextlib.redirect_stdout(sys.stderr):
            _memory = config.build_memory()
    return _memory


def _quiet(fn, *args, **kwargs):
    """执行时把任何 print 重定向到 stderr，避免污染协议流。"""
    with contextlib.redirect_stdout(sys.stderr):
        return fn(*args, **kwargs)


def _uid(user_id: str) -> str:
    return (user_id or "").strip() or config.USER_ID


def build_server():
    try:  # mcp 2.x
        from mcp.server.mcpserver import MCPServer as _Server
    except ImportError:  # mcp 1.x 回退
        from mcp.server.fastmcp import FastMCP as _Server

    server = _Server(
        "mem0",
        instructions=(
            "长时记忆库。回答涉及用户偏好、身份、项目、历史决定的问题之前，"
            "先调用 search_memories；对话中出现长期有效的事实时，调用 add_memory 存一条。"
        ),
    )

    @server.tool()
    def search_memories(query: str, limit: int = 5, user_id: str = "") -> str:
        """Search the user's long-term memories.

        Call this before answering anything about the user's preferences,
        ongoing projects, past decisions, or personal facts.
        """
        m = _memory_instance()
        res = _quiet(m.search, query, filters={"user_id": _uid(user_id)}, top_k=limit)
        return json.dumps(res, ensure_ascii=False, default=str)

    @server.tool()
    def add_memory(text: str, user_id: str = "") -> str:
        """Store one durable fact about the user.

        Keep it to a single short sentence, e.g. "用户偏好 TypeScript".
        Do not store transient task state or anything the user asked to forget.
        """
        m = _memory_instance()
        res = _quiet(m.add, text, user_id=_uid(user_id))
        return json.dumps(res, ensure_ascii=False, default=str)

    @server.tool()
    def list_memories(limit: int = 20, user_id: str = "") -> str:
        """List the most recent memories for the user."""
        m = _memory_instance()
        res = _quiet(m.get_all, filters={"user_id": _uid(user_id)}, top_k=limit)
        return json.dumps(res, ensure_ascii=False, default=str)

    @server.tool()
    def update_memory(memory_id: str, text: str) -> str:
        """Replace one memory's text in place.

        Use this when a stored fact became outdated and the correction keeps
        the same subject (for example a corrected name or path). Get the id
        from search_memories or list_memories first.
        """
        m = _memory_instance()
        res = _quiet(m.update, memory_id, text=text)
        return json.dumps(res, ensure_ascii=False, default=str)

    @server.tool()
    def delete_memory(memory_id: str) -> str:
        """Delete one memory by id.

        Use for facts the user explicitly retracted. Prefer update_memory when
        only the wording or a field changed.
        """
        m = _memory_instance()
        res = _quiet(m.delete, memory_id)
        return json.dumps(res, ensure_ascii=False, default=str)

    @server.tool()
    def export_memories(user_id: str = "") -> str:
        """Export every memory to E:\\mem0\\export\\memories.jsonl.

        That file is the text source of truth used when migrating to another
        machine or rebuilding the vector index with a different embedding model.
        """
        m = _memory_instance()
        rows = _quiet(m.get_all, filters={"user_id": _uid(user_id)}, top_k=100000)
        items = rows.get("results", []) if isinstance(rows, dict) else rows
        path = config.EXPORT_DIR / "memories.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False, default=str) + "\n")
        return json.dumps({"exported": len(items), "path": str(path)}, ensure_ascii=False)

    return server


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
