# Mem0 for DeepSeek Harness

把 [Mem0](https://github.com/mem0ai/mem0) 的本地长期记忆库接进 **DeepSeek Harness**（以及任何支持 MCP 的客户端），做成一个可以整包拷走、随时迁移的自托管记忆层。

- 记忆存在本地磁盘（Qdrant 嵌入式），不经过任何第三方记忆服务
- 对模型暴露 6 个 MCP 工具：`search` / `add` / `list` / `update` / `delete` / `export`
- 附带一个 DSH 插件包（configuration-only bundle），一键安装
- 文本真源 `memories.jsonl` 可读可 diff，向量索引随时可重建

## 它是什么 / 不是什么

**是**：一份把 Mem0 跑成本地服务、再通过 stdio MCP 暴露给 AI 客户端的**部署套件**。

**不是**：
- 不是 Mem0 官方项目（官方仓库见 [mem0ai/mem0](https://github.com/mem0ai/mem0)）
- 不含任何自动召回 / 自动捕获逻辑——工具由模型按需调用
- 不含 UI，管理靠 CLI 和 `memories.jsonl`

## 架构

```
DSH / Codex / Claude Code
        │  MCP (stdio, JSON-RPC)
        ▼
   mem0_mcp.py  ──►  Mem0 OSS (Python)  ──►  Qdrant 嵌入式（E:\mem0\data\qdrant）
        │                    │
        │                    ├── DeepSeek  deepseek-chat          （写入时抽取事实）
        │                    └── 硅基流动  Qwen3-Embedding-0.6B   （1024 维向量）
        ▼
  E:\mem0\export\memories.jsonl   ← 文本真源，可重建索引
```

## 目录

```
mem0-dsh-kit/
├── install.ps1              # 一键部署脚本
├── app/                     # 后端与 MCP 服务
│   ├── config.py            # 唯一配置入口（模型、路径、userId、指令前缀）
│   ├── mem0_mcp.py          # MCP stdio 服务，6 个工具
│   ├── mem0_cli.py          # 命令行：add/search/list/export/snapshot/doctor/delete
│   ├── mem0_service.py      # 可选 HTTP 服务（标准库实现，零额外依赖）
│   ├── verify.py            # 部署/迁移自检
│   ├── test_mcp.py          # MCP 握手测试
│   └── secrets.example.json # 密钥模板
└── bundle/                  # DSH 插件包
    ├── index.js             # Host 插件：Config 表单 + 注册 MCP 服务
    ├── package.json
    ├── cordis.patch.yml     # 只插入插件自身，服务由 index.js 注册
    ├── locale/{zh,en}.json
    ├── docs/DETAIL.md
    └── icon.svg
```

## 快速开始

### 0. 前置条件

- Windows（脚本按 Windows 写；改路径可用于其他平台）
- Python 3.10+
- 两个 API Key —— 原因见下一节

### 为什么需要两个 Key

记忆系统要做两件不同的事，而 DeepSeek 只提供其中一件：

| 环节 | 干什么 | 需要的模型 | DeepSeek 提供吗 |
|---|---|---|---|
| 写入 `add` | 把对话压成一句事实，判断"什么值得记" | **聊天模型** | ✅ `deepseek-chat` |
| 检索 `search` | 把文字变成向量，算"意思有多像" | **Embedding 模型** | ❌ 没有这个接口 |

DeepSeek 的 API 只卖"会说话"的模型（`/chat/completions`），不提供 `/embeddings` 端点。
而向量检索必须有 embedding，且**聊天模型替代不了**：让聊天模型吐一串数字很容易，
但那串数字不具备"距离 = 语义相似"的性质，拿它做检索等于随机排序。

所以第二个 Key 不是"为了兼容"，是**缺了就搜不出东西**。

推荐组合：

- 聊天：DeepSeek `deepseek-chat`
- 向量：硅基流动 `Qwen/Qwen3-Embedding-0.6B`（1024 维，有免费额度）

换别的 embedding 供应商也可以（OpenAI、阿里百炼等），改配置里的 `embedModel` 与 base URL 即可。

### 1. 部署后端

**一键**（推荐）：在仓库根目录运行 `.\install.ps1`，它把下面所有手动步骤一次做完
（检查 Python → 建 venv → 装依赖 → 建目录 → 复制代码与插件 → 提示输入两个 Key → 自检）。

自定义目录：`.\install.ps1 -Home 'D:\mem0'`；跳过自检：`-SkipVerify`。

**手动**：

```powershell
# 选一个不会被随手清掉的目录
$HOME_DIR = 'E:\mem0'
New-Item -ItemType Directory -Force -Path "$HOME_DIR\app","$HOME_DIR\data","$HOME_DIR\export","$HOME_DIR\snapshots" | Out-Null

Copy-Item .\app\* "$HOME_DIR\app\" -Recurse -Force

python -m venv "$HOME_DIR\.venv"
& "$HOME_DIR\.venv\Scripts\python.exe" -m pip install -r requirements.txt

# 填密钥
Copy-Item .\app\secrets.example.json "$HOME_DIR\secrets.json"
notepad "$HOME_DIR\secrets.json"
```

`secrets.json`：

```json
{
  "deepseek_api_key": "sk-...",
  "siliconflow_api_key": "sk-..."
}
```

### 2. 自检

```powershell
& "$HOME_DIR\.venv\Scripts\python.exe" "$HOME_DIR\app\verify.py"
```

期望看到目录、密钥、embedding 一致性、条数、抽样检索全部 `PASS`。

### 3. 装 DSH 插件

插件自身有一个依赖（`schemastery`，用于渲染设置表单）。`link:` 方式安装不会自动装它，先补上：

```powershell
cd .\bundle
pnpm add "@deepseek-ai/schemastery@~3.19.0"
```

然后在 DSH 里 **Plugins → Add plugin** 选择 `bundle` 目录，或用 `dsh plugin add <目录>`。

装好后工具会以 `mcp__mem0__search_memories` 等形式出现，**不需要改任何 YAML**。

### 4. 在设置页配置

插件详情页会出现这些字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mem0Home` | `E:\mem0` | Mem0 根目录（含 `app/`、`data/`、`.venv/`） |
| `userId` | `owner` | 记忆归属，检索与写入都按它隔离 |
| `pythonPath` | 空 | 留空则用 `<mem0Home>\.venv\Scripts\python.exe` |
| `llmModel` | `deepseek-chat` | 写入时抽取事实的模型 |
| `embedModel` | `Qwen/Qwen3-Embedding-0.6B` | 向量模型（换了要重建索引） |
| `embedDims` | `1024` | 向量维度，必须与 embedModel 一致 |
| `deepseekKey` | 空 | 留空则回落到 `secrets.json` / 环境变量 |
| `siliconflowKey` | 空 | 同上 |

这些值会作为环境变量传给 `mem0_mcp.py`，所以密钥填在表单里就不用再维护 `secrets.json`。

## 工具

| 工具 | 用途 |
|---|---|
| `search_memories(query, limit)` | 语义检索记忆 |
| `add_memory(text)` | 写入一条长期事实（触发 LLM 抽取） |
| `list_memories(limit)` | 列出最近的记忆 |
| `update_memory(memory_id, text)` | 原地改写（纠正过时事实） |
| `delete_memory(memory_id)` | 删除单条 |
| `export_memories()` | 导出 `memories.jsonl` |

## 接入其他客户端

**Codex**（`~/.codex/config.toml`）：

```toml
[mcp_servers.mem0]
command = 'E:\mem0\.venv\Scripts\python.exe'
args = ['E:\mem0\app\mem0_mcp.py']
startup_timeout_sec = 60

[mcp_servers.mem0.env]
MEM0_HOME = 'E:\mem0'
```

**Claude Code**：

```powershell
claude mcp add mem0 -- "E:\mem0\.venv\Scripts\python.exe" "E:\mem0\app\mem0_mcp.py"
```

## 迁移到另一台电脑

```powershell
# 旧机器（先用 export_memories 刷新 jsonl）
# 拷贝整个 E:\mem0，排除 .venv 与 data\qdrant

# 新机器
python -m venv E:\mem0\.venv
E:\mem0\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 放回 secrets.json
E:\mem0\.venv\Scripts\python.exe E:\mem0\app\verify.py
```

`data\qdrant` 可以不拷——它是可重建的缓存，只要 `export\memories.jsonl` 在，就能重新灌回去。

## 已知限制

- **单进程独占**：Qdrant 嵌入式有文件锁，同一时刻只能有一个进程打开 `data\qdrant`。多个客户端同时用会报 `Storage folder ... already accessed`。要么串行使用，要么改 Qdrant server / pgvector。
- **无自动记忆**：这是工具而不是钩子，模型不调用就什么都不发生。
- **关键词检索默认关闭**：未安装 `mem0ai[nlp]` 时只有语义通道，中文 BM25 收益本来也有限。
- **路径写死**：插件 patch 里是三处绝对路径，换机器要改。

## 安全

- `secrets.json` 是明文密钥，不要提交、不要放进同步盘
- `mem0_service.py` 默认只绑 `127.0.0.1`，且 `/add` 需显式开 `MEM0_HTTP_ALLOW_WRITE=1`
- 记忆内容会发给 DeepSeek（抽取）和 embedding 服务（向量化），敏感信息自行判断

## License

MIT
