#!/usr/bin/env python
"""Mem0 命令行：add / search / list / export / snapshot / doctor / delete

示例：
    python mem0_cli.py add "用户偏好 TypeScript"
    python mem0_cli.py search "我用什么语言"
    python mem0_cli.py list --limit 20
    python mem0_cli.py export
    python mem0_cli.py doctor
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import config


def _out(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def _uid(args) -> str:
    return getattr(args, "user", None) or config.USER_ID


def cmd_add(args) -> None:
    m = config.build_memory()
    res = m.add(args.text, user_id=_uid(args), infer=not args.raw)
    _out(res)


def cmd_search(args) -> None:
    m = config.build_memory()
    res = m.search(
        args.query,
        filters={"user_id": _uid(args)},
        top_k=args.top,
        threshold=args.threshold,
        explain=args.explain,
    )
    _out(res)


def cmd_list(args) -> None:
    m = config.build_memory()
    _out(m.get_all(filters={"user_id": _uid(args)}, top_k=args.limit))


def cmd_delete(args) -> None:
    m = config.build_memory()
    _out(m.delete(args.id))


def _all_items(memory, user_id: str) -> list:
    rows = memory.get_all(filters={"user_id": user_id}, top_k=100000)
    if isinstance(rows, dict):
        return rows.get("results", [])
    return rows or []


def cmd_export(args) -> None:
    m = config.build_memory()
    items = _all_items(m, _uid(args))
    config.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = Path(args.out) if args.out else (config.EXPORT_DIR / "memories.jsonl")
    with path.open("w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False, default=str) + "\n")
    _out({"exported": len(items), "path": str(path)})


def cmd_snapshot(args) -> None:
    """把 data 目录打成 zip（先停掉其它进程，避免拷到不一致状态）。"""
    config.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = config.SNAPSHOT_DIR / f"mem0-{ts}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in config.DATA.rglob("*"):
            if p.is_file():
                try:
                    z.write(p, p.relative_to(config.HOME))
                except Exception as e:  # 锁文件被占用时跳过
                    print(f"skip {p}: {e}", file=sys.stderr)
    _out({"snapshot": str(out), "size_mb": round(out.stat().st_size / 1048576, 2)})


def cmd_doctor(args) -> None:
    config.ensure_dirs()
    meta = config.write_meta()
    m = config.build_memory()
    items = _all_items(m, _uid(args))
    _out(
        {
            "ok": True,
            "home": str(config.HOME),
            "data": str(config.DATA),
            "user_id": _uid(args),
            "memory_count": len(items),
            "meta": meta,
            "api_keys_present": {k: bool(v) for k, v in config.api_keys().items()},
        }
    )


def main() -> int:
    p = argparse.ArgumentParser(prog="mem0_cli")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="写入一条记忆")
    a.add_argument("text")
    a.add_argument("--user", default=None)
    a.add_argument("--raw", action="store_true", help="跳过 LLM 抽取，原样存入")
    a.set_defaults(func=cmd_add)

    s = sub.add_parser("search", help="检索记忆")
    s.add_argument("query")
    s.add_argument("--top", type=int, default=5)
    s.add_argument("--threshold", type=float, default=0.1)
    s.add_argument("--user", default=None)
    s.add_argument("--explain", action="store_true")
    s.set_defaults(func=cmd_search)

    l = sub.add_parser("list", help="列出记忆")
    l.add_argument("--limit", type=int, default=20)
    l.add_argument("--user", default=None)
    l.set_defaults(func=cmd_list)

    e = sub.add_parser("export", help="导出 memories.jsonl")
    e.add_argument("--out", default=None)
    e.add_argument("--user", default=None)
    e.set_defaults(func=cmd_export)

    sn = sub.add_parser("snapshot", help="打包 data 目录")
    sn.set_defaults(func=cmd_snapshot)

    d = sub.add_parser("doctor", help="自检")
    d.add_argument("--user", default=None)
    d.set_defaults(func=cmd_doctor)

    rm = sub.add_parser("delete", help="按 id 删除")
    rm.add_argument("id")
    rm.set_defaults(func=cmd_delete)

    args = p.parse_args()
    try:
        args.func(args)
        return 0
    except Exception as e:
        print(json.dumps({"error": type(e).__name__, "detail": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
