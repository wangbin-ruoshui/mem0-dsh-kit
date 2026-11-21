/**
 * Mem0 长期记忆的 DSH 插件。
 *
 * 两个职责：
 *   1. mem0_setup —— 纯 Node 的诊断工具，环境没装好时也能用
 *   2. 环境就绪后，把 MCP 服务注册进 mcp-manager（register 的生命周期随插件）
 *
 * 配置项都是 volatile，设置页与插件页共用同一份（见 client.js）。
 */

import z from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Cordis 插件名（用于诊断）。 */
export const name = 'mem0-memory'

/** 需要 mcp-manager 托管 MCP 服务，tools 用来注册诊断工具。 */
export const inject = ['mcpManager', 'tools']

/**
 * 部署根目录的兜底默认值。
 * 优先级：插件配置页的 mem0Home > MEM0_HOME 环境变量 > 这个常量。
 */
const DEFAULT_HOME = process.env.MEM0_HOME || 'E:\\mem0'

/**
 * defineTool 来自 dsh 自带的 @deepseek-ai/dsh-tools。
 * 用动态导入并保底退化，避免它解析失败时整块插件都起不来。
 */
let defineTool = (definition) => definition
try {
  const tools = await import('@deepseek-ai/dsh-tools')
  if (tools && typeof tools.defineTool === 'function') defineTool = tools.defineTool
} catch (error) {
  console.warn('[mem0] defineTool 不可用，使用退化实现：', error && error.message)
}

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

/** 取字段值：volatile 字段是引用对象（.get()），普通字段直接就是值。 */
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

/** 只读检查：目录、虚拟环境、服务脚本、密钥文件。 */
function inspect(home) {
  const venvPython = join(home, '.venv', 'Scripts', 'python.exe')
  const appScript = join(home, 'app', 'mem0_mcp.py')
  return {
    home,
    homeExists: existsSync(home),
    venvPython,
    venvReady: existsSync(venvPython),
    appScript,
    appReady: existsSync(appScript),
    dataReady: existsSync(join(home, 'data')),
    secretsReady: existsSync(join(home, 'secrets.json')),
  }
}

/** 把检查结果渲染成人能读的一段话。 */
function describe(info) {
  const mark = (ok) => (ok ? '✅' : '❌')
  const ready = info.venvReady && info.appReady
  const lines = [
    ready ? 'Mem0 后端已就绪。' : 'Mem0 后端尚未就绪。',
    `部署目录：${info.home}`,
    `${mark(info.homeExists)} 目录存在`,
    `${mark(info.venvReady)} 虚拟环境（${info.venvPython}）`,
    `${mark(info.appReady)} MCP 服务脚本（${info.appScript}）`,
    `${mark(info.dataReady)} 数据目录`,
    `${mark(info.secretsReady)} secrets.json（可选：密钥也可填在插件配置里）`,
  ]

  if (!ready) {
    lines.push('', '修复建议：')
    if (!info.homeExists) lines.push(`- 目录不存在。运行仓库里的 install.ps1，或手动建目录：${info.home}`)
    if (!info.venvReady) lines.push(`- 建虚拟环境：python -m venv "${join(info.home, '.venv')}"，再 pip install mem0ai mcp`)
    if (!info.appReady) lines.push(`- 把仓库的 app/ 复制到 ${join(info.home, 'app')}`)
    lines.push('- 也可以用仓库根目录的 install.ps1 一次做完以上所有步骤')
  }

  return { ready, text: lines.join('\n') }
}

export function apply(ctx, config) {
  const home = () => String(val(config.mem0Home, DEFAULT_HOME)).replace(/[\\/]+$/, '')

  // ---- 诊断工具：环境未就绪时它仍然可用 ----
  try {
    ctx.tools.register(
      defineTool({
        name: 'mem0_setup',
        description:
          '检查本地 Mem0 记忆后端是否装好（目录、虚拟环境、MCP 服务脚本、密钥文件）。' +
          '用户说“mem0 用不了”“检查 mem0 环境”“装好 mem0”时调用它。它只做只读检查，不改动任何文件。',
        parameters: {
          action: { type: 'string', description: '目前只支持 check。' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { text: { type: 'string', required: true, description: '检查结果。' } },
          },
          render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute() {
          const info = inspect(home())
          return { text: describe(info).text }
        },
      }),
    )
  } catch (error) {
    console.warn('[mem0] mem0_setup 注册失败：', error && error.message)
  }

  // ---- 环境就绪才挂 MCP；未就绪时只说一声，不阻断插件 ----
  ctx.effect(() => {
    const current = home()
    const info = inspect(current)
    if (!info.venvReady || !info.appReady) {
      console.warn(`[mem0] 后端未就绪，暂不注册 MCP 服务：${info.venvPython} / ${info.appScript}`)
      return () => {}
    }

    const python = String(val(config.pythonPath, '') || info.venvPython)
    const dispose = ctx.mcpManager.register('mem0', {
      transport: 'stdio',
      command: python,
      args: [info.appScript],
      env: compactEnv({
        MEM0_HOME: current,
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
  }, 'mem0: register the MCP server when the backend is ready')
}
