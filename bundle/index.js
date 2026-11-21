/**
 * Mem0 长期记忆的 DSH 插件。
 *
 * 它不直接实现记忆逻辑，而是把自己的 MCP 服务注册进 mcp-manager：
 *   - 路径、userId、模型、密钥全部来自 Config（设置页可改）
 *   - 子进程通过环境变量收到这些值，mem0_mcp.py 直接读取
 *
 * 注意：DSH 的设置表单只渲染 `.volatile()` 字段，普通字段只在配置文件里生效。
 * volatile 字段解析后是引用对象，必须用 `.get()` 取值。
 */

import z from '@deepseek-ai/schemastery'

/** Cordis 插件名（用于诊断）。 */
export const name = 'mem0-memory'

/**
 * 部署根目录的兜底默认值。
 * 优先级：插件配置页的 mem0Home > MEM0_HOME 环境变量 > 这个常量。
 * install.ps1 会写 MEM0_HOME，所以正常安装后不需要手填。
 */
const DEFAULT_HOME = process.env.MEM0_HOME || 'E:\\mem0'

/** 需要 mcp-manager 来托管我们注册的服务。 */
export const inject = ['mcpManager']

/** 密码型字段：老版本 schemastery 没有 role 时退化为普通字符串。 */
function secretField(description) {
  let base
  try {
    base = z.string().role('secret')
  } catch {
    base = z.string()
  }
  return base.description(description).default('').volatile()
}

/** 设置页渲染的表单（只有 volatile 字段会出现在表单里）。 */
export const Config = z.object({
  mem0Home: z
    .string()
    .description('Mem0 部署根目录（留空则用 MEM0_HOME 环境变量）')
    .default('')
    .volatile(),
  userId: z
    .string()
    .description('记忆归属实体，检索与写入都按它隔离')
    .default('owner')
    .volatile(),
  pythonPath: z
    .string()
    .description('Python 解释器路径；留空则用 <mem0Home>\\.venv\\Scripts\\python.exe')
    .default('')
    .volatile(),
  llmModel: z
    .string()
    .description('写入时抽取事实用的聊天模型')
    .default('deepseek-chat')
    .volatile(),
  embedModel: z
    .string()
    .description('向量化模型（换模型后必须重建索引）')
    .default('Qwen/Qwen3-Embedding-0.6B')
    .volatile(),
  embedDims: z
    .number()
    .description('向量维度，必须与 embedModel 一致')
    .default(1024)
    .volatile(),
  deepseekKey: secretField('DeepSeek API Key（写入时抽取用）'),
  siliconflowKey: secretField('Embedding 服务的 API Key'),
})

/**
 * 取字段值：volatile 字段是引用对象（.get()），普通字段直接就是值。
 */
function val(field, fallback) {
  let raw = field
  if (raw && typeof raw.get === 'function') raw = raw.get()
  if (raw === undefined || raw === null || raw === '') return fallback
  return raw
}

/** 去掉 undefined / 空串，避免把空环境变量传给子进程。 */
function compactEnv(entries) {
  const out = {}
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

export function apply(ctx, config) {
  // 放在 ctx.effect 里：读取 volatile 值时会被追踪，配置一改就重新注册，
  // 从而用新值重启 MCP 子进程（否则只有重启插件才生效）。
  ctx.effect(() => {
    const home = String(val(config.mem0Home, DEFAULT_HOME)).replace(/[\\/]+$/, '')
    const python = String(val(config.pythonPath, '') || `${home}\\.venv\\Scripts\\python.exe`)

    const dispose = ctx.mcpManager.register('mem0', {
      transport: 'stdio',
      command: python,
      args: [`${home}\\app\\mem0_mcp.py`],
      env: compactEnv({
        MEM0_HOME: home,
        MEM0_USER_ID: val(config.userId, ''),
        MEM0_LLM_MODEL: val(config.llmModel, ''),
        MEM0_EMBED_MODEL: val(config.embedModel, ''),
        MEM0_EMBED_DIMS: val(config.embedDims, ''),
        DEEPSEEK_API_KEY: val(config.deepseekKey, ''),
        SILICONFLOW_API_KEY: val(config.siliconflowKey, ''),
      }),
      toolCallTimeoutMs: 120_000,
      startupTimeoutMs: 30_000,
    })

    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'mem0: mcp registration follows volatile config')
}
