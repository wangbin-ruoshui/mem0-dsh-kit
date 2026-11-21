#!/usr/bin/env python
"""部署 / 迁移后的自检脚本。

检查项：
    1. 目录与配置存在
    2. META.json 与当前代码配置一致（embedding 模型/维度/指令开关）
    3. 记忆条数
    4. 抽样检索（会调用 embedding API，用 --no-api 跳过）

退出码 0 = 全部通过；1 = 有问题。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import config

OK = "PASS"
WARN = "WARN"
FAIL = "FAIL"

results: list[tuple[str, str, str]] = []


def check(name: str, status: str, detail: str = "") -> None:
    results.append((status, name, detail))
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--no-api", action="store_true", help="跳过需要调用 API 的检索测试")
    p.add_argument("--user", default=None)
    args = p.parse_args()
    uid = args.user or config.USER_ID

    # 1. 目录
    for d in (config.HOME, config.DATA, config.EXPORT_DIR, config.SNAPSHOT_DIR):
        check(f"目录存在 {d}", OK if d.exists() else FAIL)

    # 2. 密钥
    keys = config.api_keys()
    for k, v in keys.items():
        check(f"密钥 {k}", OK if v else FAIL, "已配置" if v else "缺失（secrets.json 或环境变量）")

    # 3. META 一致性
    if config.META_FILE.exists():
        meta = json.loads(config.META_FILE.read_text(encoding="utf-8"))
        same_model = meta.get("embed_model") == config.EMBED_MODEL
        same_dims = meta.get("embed_dims") == config.EMBED_DIMS
        same_instr = meta.get("query_instruction") == config.USE_QUERY_INSTRUCTION
        check(
            "embedding 配置一致",
            OK if (same_model and same_dims and same_instr) else FAIL,
            f"meta={meta.get('embed_model')}/{meta.get('embed_dims')}/{meta.get('query_instruction')} "
            f"now={config.EMBED_MODEL}/{config.EMBED_DIMS}/{config.USE_QUERY_INSTRUCTION}"
            + ("" if (same_model and same_dims and same_instr) else " → 需要 reindex"),
        )
    else:
        check("META.json", WARN, "尚未生成（首次运行会创建）")

    # 4. 条数 + 抽样检索
    try:
        memory = config.build_memory()
        rows = memory.get_all(filters={"user_id": uid}, top_k=100000)
        items = rows.get("results", []) if isinstance(rows, dict) else rows
        check("记忆条数", OK if items else WARN, f"{len(items)} 条（user_id={uid}）")

        if items and not args.no_api:
            sample = items[0].get("memory", "")
            query = sample[:40]
            hits = memory.search(query, filters={"user_id": uid}, top_k=3)
            got = hits.get("results", []) if isinstance(hits, dict) else hits
            check("抽样检索", OK if got else FAIL, f"查询「{query}」→ 命中 {len(got)} 条")
        elif not items:
            check("抽样检索", WARN, "库里还没有记忆，先 add 一条")
        else:
            check("抽样检索", WARN, "已跳过（--no-api）")
    except RuntimeError as e:
        if "already accessed" in str(e):
            check("加载 Memory", WARN, "另一个进程（通常是 DSH 的 MCP 服务）正占用 Qdrant；关闭 DSH 后再自检")
            fails = [r for r in results if r[0] == FAIL]
            print("\n" + ("全部通过（记忆库被占用，跳过检索检查）" if not fails else f"{len(fails)} 项失败"))
            return 0 if not fails else 1
        check("加载 Memory", FAIL, f"{type(e).__name__}: {e}")
    except Exception as e:
        check("加载 Memory", FAIL, f"{type(e).__name__}: {e}")

    # 汇总
    fails = [r for r in results if r[0] == FAIL]
    print("\n" + ("全部通过" if not fails else f"{len(fails)} 项失败"))
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
