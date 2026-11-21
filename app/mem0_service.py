#!/usr/bin/env python
"""Mem0 本地 HTTP 服务（标准库实现，零额外依赖）。

用途：给手机、其他电脑、脚本等非 MCP 场景访问同一份记忆。

启动：
    set MEM0_HTTP_TOKEN=一个足够长的随机串
    python mem0_service.py            # 默认 127.0.0.1:8765

接口：
    GET  /health                     健康检查 + 条数
    POST /search  {"query": "...", "limit": 5}
    POST /add     {"text": "..."}    默认禁用，需 MEM0_HTTP_ALLOW_WRITE=1
    GET  /list?limit=20

鉴权：设置了 MEM0_HTTP_TOKEN 后，所有请求需带 Authorization: Bearer <token>。
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import config

HOST = os.environ.get("MEM0_HTTP_HOST", "127.0.0.1")
PORT = int(os.environ.get("MEM0_HTTP_PORT", "8765"))
TOKEN = os.environ.get("MEM0_HTTP_TOKEN", "")
ALLOW_WRITE = os.environ.get("MEM0_HTTP_ALLOW_WRITE", "0") == "1"

_lock = threading.Lock()
_memory = None


def memory():
    global _memory
    if _memory is None:
        _memory = config.build_memory()
    return _memory


class Handler(BaseHTTPRequestHandler):
    server_version = "mem0-local/1.0"

    def log_message(self, fmt, *args):  # noqa: A003
        print(f"{self.address_string()} - {fmt % args}", file=sys.stderr)

    # ---------- helpers ----------
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {TOKEN}"

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    # ---------- routes ----------
    def do_GET(self):  # noqa: N802
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})

        if self.path.startswith("/health"):
            try:
                with _lock:
                    rows = memory().get_all(filters={"user_id": config.USER_ID}, top_k=100000)
                items = rows.get("results", []) if isinstance(rows, dict) else rows
                return self._send(200, {"ok": True, "user_id": config.USER_ID, "count": len(items)})
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

        if self.path.startswith("/list"):
            limit = 20
            if "limit=" in self.path:
                try:
                    limit = int(self.path.split("limit=")[1].split("&")[0])
                except ValueError:
                    pass
            try:
                with _lock:
                    rows = memory().get_all(filters={"user_id": config.USER_ID}, top_k=limit)
                return self._send(200, rows)
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})

        return self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})

        data = self._body()

        if self.path.startswith("/search"):
            query = (data.get("query") or "").strip()
            if not query:
                return self._send(400, {"error": "query required"})
            limit = int(data.get("limit") or 5)
            try:
                with _lock:
                    res = memory().search(query, filters={"user_id": config.USER_ID}, top_k=limit)
                return self._send(200, res)
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})

        if self.path.startswith("/add"):
            if not ALLOW_WRITE:
                return self._send(403, {"error": "write disabled; set MEM0_HTTP_ALLOW_WRITE=1"})
            text = (data.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "text required"})
            try:
                with _lock:
                    res = memory().add(text, user_id=config.USER_ID)
                return self._send(200, res)
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})

        return self._send(404, {"error": "not found"})


def main() -> None:
    print(f"mem0 service on http://{HOST}:{PORT}  (write={'on' if ALLOW_WRITE else 'off'})", file=sys.stderr)
    if HOST != "127.0.0.1" and not TOKEN:
        print("拒绝启动：绑定非回环地址时必须设置 MEM0_HTTP_TOKEN", file=sys.stderr)
        raise SystemExit(2)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
