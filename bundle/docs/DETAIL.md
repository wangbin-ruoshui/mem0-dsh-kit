# Mem0 长期记忆

把本机的 Mem0 记忆库接成三个原生 MCP 工具，让 Agent 在跨会话时能记住用户。

## 提供的能力

| 工具 | 作用 |
|---|---|
| `search_memories(query, limit)` | 按语义检索记忆，回答"我是谁 / 我偏好什么 / 上次决定了什么"之前调用 |
| `add_memory(text)` | 把一条长期有效的事实写回记忆库 |
| `list_memories(limit)` | 列出最近若干条记忆 |

工具在模型侧显示为 `mcp__mem0__search_memories` 等，与其他 MCP 服务并存。

## 后端要求

这个插件只是连接器，真正的实现在 `E:\mem0`：

```
E:\mem0\
├── .venv\                        Python 环境（mem0ai + mcp）
├── app\mem0_mcp.py               MCP 服务（本插件启动的就是它）
├── data\                         记忆本体：qdrant\ + history.db + META.json
├── export\memories.jsonl         文本真源
└── secrets.json                  API 密钥（不入库、不同步）
```

依赖的外部服务：

- DeepSeek `deepseek-chat`：写入时抽取事实
- 硅基流动 `Qwen/Qwen3-Embedding-0.6B`：计算 1024 维向量

## 使用

正常对话即可。想让记忆生效，可以显式说：

- "记住：我偏好 TypeScript"
- "我之前说过用什么语言？"

## 限制

- **单进程独占**：Qdrant 嵌入式有文件锁，同一时刻只允许一个进程打开 `data\qdrant`。若同时又跑脚本又跑 DSH，会报锁冲突。
- **需要本地 Python**：`E:\mem0\.venv` 不存在或依赖缺失时，工具会调用失败（插件本身不会阻止 DSH 启动）。
- **路径写死在插件配置里**：换机器要改 `cordis.patch.yml` 里的 `command`、`args`、`env.MEM0_HOME`。
- **只做语义检索**：未安装 `mem0ai[nlp]` 时不启用 BM25 关键词通道。
- **写入会消耗 API 额度**：每次 `add_memory` 调用一次 DeepSeek 抽取。

## 迁移

拷贝 `E:\mem0`（排除 `.venv`）到新机器，重建虚拟环境，把本插件目录也拷过去重新安装，然后运行：

```
E:\mem0\.venv\Scripts\python.exe E:\mem0\app\verify.py
```
