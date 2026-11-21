"""Mem0 本地部署配置（唯一配置入口）。

LLM         : DeepSeek deepseek-chat
Embedding   : 硅基流动 Qwen/Qwen3-Embedding-0.6B（1024 维）
VectorStore : Qdrant 嵌入式（E:\\mem0\\data\\qdrant）
History     : E:\\mem0\\data\\history.db

所有路径都可以用环境变量覆盖：
    MEM0_HOME    默认 E:\\mem0
    MEM0_DIR     默认 <MEM0_HOME>\\data
    MEM0_USER_ID 默认 owner
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# 关掉 Mem0 自带遥测（会起 PostHog 线程并外联），必须在 import mem0 之前设置
os.environ.setdefault("MEM0_TELEMETRY", "false")

HOME = Path(os.environ.get("MEM0_HOME") or r"E:\mem0").resolve()
DATA = Path(os.environ.get("MEM0_DIR") or (HOME / "data")).resolve()
EXPORT_DIR = HOME / "export"
SNAPSHOT_DIR = HOME / "snapshots"
SECRETS_FILE = HOME / "secrets.json"
META_FILE = DATA / "META.json"

USER_ID = os.environ.get("MEM0_USER_ID") or "owner"

# ---- LLM（抽取事实） ----
LLM_PROVIDER = "deepseek"
LLM_MODEL = "deepseek-chat"
LLM_BASE_URL = "https://api.deepseek.com"

# ---- Embedding（向量化） ----
EMBED_PROVIDER = "openai"  # 走 OpenAI 兼容协议
EMBED_MODEL = "Qwen/Qwen3-Embedding-0.6B"
EMBED_DIMS = 1024
EMBED_BASE_URL = "https://api.siliconflow.cn/v1"

COLLECTION = "mem0"

# Qwen3-Embedding 是指令感知模型：查询侧加指令、文档侧不加。
# 一旦定下这个开关，索引就必须与之一致（改动后需要 reindex）。
USE_QUERY_INSTRUCTION = True
QUERY_INSTRUCTION = "Given a user question, retrieve relevant personal memories"

REQUIRED_DIRS = (HOME, DATA, EXPORT_DIR, SNAPSHOT_DIR, HOME / "app")


def ensure_dirs() -> None:
    for d in REQUIRED_DIRS:
        d.mkdir(parents=True, exist_ok=True)


def _read_secrets() -> dict:
    if not SECRETS_FILE.exists():
        return {}
    try:
        return json.loads(SECRETS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def api_keys() -> dict:
    s = _read_secrets()
    return {
        "deepseek": os.environ.get("DEEPSEEK_API_KEY") or s.get("deepseek_api_key"),
        "siliconflow": os.environ.get("SILICONFLOW_API_KEY") or s.get("siliconflow_api_key"),
    }


def build_config() -> dict:
    ensure_dirs()
    k = api_keys()
    return {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "path": str(DATA / "qdrant"),
                "collection_name": COLLECTION,
                "embedding_model_dims": EMBED_DIMS,
                "on_disk": True,
            },
        },
        "llm": {
            "provider": LLM_PROVIDER,
            "config": {
                "model": LLM_MODEL,
                "api_key": k["deepseek"],
                "deepseek_base_url": LLM_BASE_URL,
            },
        },
        "embedder": {
            "provider": EMBED_PROVIDER,
            "config": {
                "model": EMBED_MODEL,
                "api_key": k["siliconflow"],
                "openai_base_url": EMBED_BASE_URL,
                "embedding_dims": EMBED_DIMS,
            },
        },
        "history_db_path": str(DATA / "history.db"),
        # 让抽取结果保持中文，并把长期有效的信息挑出来
        "custom_instructions": (
            "始终用简体中文记录事实，保留用户的原始措辞与专有名词（如 TypeScript、DSH）。"
            "每条记忆一句话，只记录长期有效的信息（偏好、身份、项目、决定），忽略一次性的任务细节。"
        ),
        "version": "v1.1",
    }


class InstructedEmbedder:
    """给查询加指令前缀的包装器（Qwen3-Embedding 官方推荐用法）。"""

    def __init__(self, inner, instruction: str):
        self._inner = inner
        self._instruction = instruction

    @staticmethod
    def _is_search(memory_action) -> bool:
        return str(memory_action or "").lower() in {"search", "query"}

    def _wrap(self, text: str) -> str:
        return f"Instruct: {self._instruction}\nQuery: {text}"

    def embed(self, text, memory_action=None):
        if USE_QUERY_INSTRUCTION and self._is_search(memory_action) and isinstance(text, str):
            text = self._wrap(text)
        return self._inner.embed(text, memory_action=memory_action)

    def embed_batch(self, texts, memory_action=None):
        if USE_QUERY_INSTRUCTION and self._is_search(memory_action):
            texts = [self._wrap(t) if isinstance(t, str) else t for t in texts]
        return self._inner.embed_batch(texts, memory_action=memory_action)

    def __getattr__(self, item):
        return getattr(self._inner, item)


def write_meta() -> dict:
    import importlib.metadata as md

    try:
        version = md.version("mem0ai")
    except Exception:
        version = "unknown"

    meta = {
        "embed_provider": EMBED_PROVIDER,
        "embed_model": EMBED_MODEL,
        "embed_dims": EMBED_DIMS,
        "embed_base_url": EMBED_BASE_URL,
        "query_instruction": USE_QUERY_INSTRUCTION,
        "llm_model": LLM_MODEL,
        "collection": COLLECTION,
        "user_id": USER_ID,
        "mem0ai_version": version,
        "history_db": str(DATA / "history.db"),
        "qdrant_path": str(DATA / "qdrant"),
    }
    META_FILE.parent.mkdir(parents=True, exist_ok=True)
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def build_memory():
    """构造 Mem0 Memory 实例（含查询指令包装 + META 记录）。"""
    from mem0 import Memory

    memory = Memory.from_config(build_config())
    if USE_QUERY_INSTRUCTION:
        memory.embedding_model = InstructedEmbedder(memory.embedding_model, QUERY_INSTRUCTION)
    write_meta()
    return memory
