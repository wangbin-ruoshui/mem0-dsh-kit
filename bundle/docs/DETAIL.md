# Mem0 长期记忆

把本机的 Mem0 记忆库接成 MCP 工具，让 Agent 跨会话记住用户。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `search_memories(query, limit)` | 语义检索记忆 |
| `add_memory(text)` | 写入一条长期事实（触发 LLM 抽取） |
| `list_memories(limit)` | 列出最近的记忆 |
| `update_memory(memory_id, text)` | 原地改写，用于纠正过时事实 |
| `delete_memory(memory_id)` | 删除单条 |
| `export_memories()` | 导出 `memories.jsonl`（迁移用的文本真源） |

模型侧显示为 `mcp__mem0__search_memories` 等。

## 配置

配置页有**两个入口**，写的是同一份配置：

- **插件页**：打开本插件，在「包含的组件」那一行点「配置」
- **设置页**：设置 → 左栏「Mem0 记忆」

共 8 个字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| Mem0 目录 | 空 | 留空则用 `MEM0_HOME` 环境变量 |
| userId | `owner` | 记忆归属，检索与写入都按它隔离 |
| Python 路径 | 空 | 留空则用 `<目录>\.venv\Scripts\python.exe` |
| 聊天模型 | `deepseek-chat` | 写入时抽取事实 |
| 向量模型 | `Qwen/Qwen3-Embedding-0.6B` | 换模型后必须重建索引 |
| 向量维度 | `1024` | 必须与向量模型一致 |
| DeepSeek Key | 空 | 留空则回落到 `secrets.json` / 环境变量 |
| Embedding Key | 空 | 同上 |

**路径优先级**：配置页 > `MEM0_HOME` 环境变量 > 内置默认值。

## 后端要求

本插件只是连接器，真正的实现位于部署目录：

```
<Mem0 目录>\
├── .venv\                  Python 环境（mem0ai + mcp）
├── app\mem0_mcp.py         MCP 服务（本插件启动的就是它）
├── data\                   Qdrant 索引 + history.db + META.json
├── export\memories.jsonl   文本真源
└── secrets.json            API 密钥（可被配置页覆盖）
```

外部服务：DeepSeek（抽取）+ 一个 Embedding 服务（向量化，DeepSeek 不提供此接口）。

## 限制

- **单进程独占**：Qdrant 嵌入式有文件锁，同一时刻只允许一个进程打开 `data\qdrant`。多个客户端同时用会报 `Storage folder ... already accessed`。
- **没有自动记忆**：这是工具而非钩子，模型不调用就不会发生。
- **只做语义检索**：未安装 `mem0ai[nlp]` 时 BM25 关键词通道关闭。
- **写入消耗额度**：每次 `add_memory` 调用一次 DeepSeek 抽取。

## 迁移

拷贝整个部署目录（可排除 `.venv` 与 `data\qdrant`）到新机器，重建虚拟环境并安装依赖，然后在配置页把「Mem0 目录」指向新路径，或设置 `MEM0_HOME`。
