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

### 2. 让插件自己执行安装（当前由调用方代跑）

**现状**：`mem0_setup` 的 `venv` / `deps` / `verify` 会生成 `.ps1` 并返回执行命令，由调用方用自己的 shell 跑，跑完再用 `check` 看日志尾部。

**为什么没在插件里直接跑**：在 Electron Host 里 `spawn` 出来的 PowerShell 不执行脚本——相同脚本从普通 shell 运行完全正常（exit 0、日志完整）。已尝试并失败：

1. `detached: true` + fd 重定向
2. 非 detached + fd 重定向
3. `-Command` 加 `*>>` 自重定向（静默 exit 1，实为引号转义问题）
4. `-File` 直接执行（脚本生成正确，但仍无输出）
5. `cmd /c start /b powershell -File`

**下一步**：改用 DSH 自带的 `ctx.jobs` 后台任务服务（agent 的 `run_in_background` 走的就是它，已知可用），而不是自己 `spawn`。

### 3. `install.ps1` 在干净环境实测

脚本写好了但没在全新机器上跑过。要验证：Python 探测（`py -3` / `python` 两种）、pip 失败时的镜像提示、`MEM0_HOME` 写入、pnpm 缺省时的降级提示。

### 4. BM25 关键词检索

安装 `mem0ai[nlp]` 后开启混合检索。中文场景收益待实测（Mem0 的词形还原偏英文）；若收益不明显就不做。

### 5. 手机端接入

Claude 手机版支持自定义远程 MCP，但**从 Anthropic 云端发起连接**，要求公网 HTTPS + 443 + 证书。需要隧道（Cloudflare Tunnel / Tailscale Funnel），并把暴露面限制为只读 `search`。

### 6. 两个 API Key 轮换

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
- [x] 原生工具 `mem0_setup`：只读自检 + venv/deps/verify 生成可执行脚本
- [x] 环境未就绪时不注册 MCP 的门槛
- [x] README 解释「为什么需要两个 Key」
