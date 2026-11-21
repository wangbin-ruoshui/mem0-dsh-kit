# TODO

## 待办

### 1. 配置改完即时生效（不切开关、不重启）

**诉求**：在插件页或设置页保存配置后，MCP 子进程立刻用新值重启，而不是要手动把插件开关关一次再打开。

**当前行为**（2026-11-21 实测）：保存会正确写入 `profile/cordis.patch.yml`，但运行中的 MCP 服务仍用旧值。切一次插件开关后才生效。

**已尝试**：把 `ctx.mcpManager.register()` 包进 `ctx.effect`，在 effect 内读取 volatile 配置（`config.userId.get()` 等），期望依赖变化时自动 dispose + 重建。**未生效**——推测是配置写入走 `ConfigEditor → Loader`，整个 config 对象被替换而非原地修改，effect 的追踪失效。未在 Cordis 源码中确认。

**可能的解法**：

1. 订阅 `settings/document-updated` 事件，在回调里自行 dispose + 重新 register（需处理去抖，避免保存过程中反复重建）
2. 查 `@deepseek-ai/cordis-plugin-loader` 是否提供配置变更钩子（如 `update(config)` 导出约定）
3. 让 MCP 子进程每次调用时读配置（代价大，且 MCP 工具签名固定，暂不考虑）

**验收标准**：改 `userId` 保存后，直接调用 `list_memories` 就能看到新 scope 的结果，无需任何手动重载。

### 2. `install.ps1` 在干净环境实测

脚本写好了但没在全新机器上跑过。要验证：Python 探测（`py -3` / `python` 两种）、pip 失败时的镜像提示、`MEM0_HOME` 写入、pnpm 缺省时的降级提示。

### 3. BM25 关键词检索

安装 `mem0ai[nlp]` 后开启混合检索。中文场景收益待实测（Mem0 的词形还原偏英文）；若收益不明显就不做。

### 4. 手机端接入

Claude 手机版支持自定义远程 MCP，但**从 Anthropic 云端发起连接**，要求公网 HTTPS + 443 + 证书。需要隧道（Cloudflare Tunnel / Tailscale Funnel），并把暴露面限制为只读 `search`。

### 5. 两个 API Key 轮换

Issue：两个 key 曾以明文出现在对话里。若要轮换，正确做法是**自己改 `secrets.json`，不要把新 key 发进对话**——否则新 key 又进入同一份日志，等于没换。

## 已完成

- [x] 本地 Mem0 部署（Qdrant 嵌入式 + DeepSeek 抽取 + 硅基流动 embedding）
- [x] MCP stdio 服务，6 个工具（search / add / list / update / delete / export）
- [x] DSH 插件：`plugins.row.config` 配置页
- [x] DSH 插件：`settings.section` 设置页左栏入口
- [x] 配置项 volatile 化并注入 `configForms`
- [x] `MEM0_HOME` 作为部署路径的唯一来源
- [x] Codex 接入（`~/.codex/config.toml`）
- [x] 一键安装脚本 `install.ps1`
- [x] README 解释「为什么需要两个 Key」
