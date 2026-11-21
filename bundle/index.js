/**
 * Mem0 长期记忆的 DSH 插件。
 *
 * 两个职责：
 *   1. mem0_setup —— 原生工具（纯 Node）：自检环境，并可分步安装后端
 *   2. 环境就绪后，把 MCP 服务注册进 mcp-manager
 *
 * 安装动作一律「后台启动 + 写日志」，立刻返回，避免工具调用因 pip 超时被掐断。
 */

import z from '@deepseek-ai/schemastery'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Cordis 插件名（用于诊断）。 */
export const name = 'mem0-memory'

/** 需要 mcp-manager 托管 MCP 服务，tools 用来注册诊断/安装工具。 */
export const inject = ['mcpManager', 'tools']

/** 部署根目录兜底：配置页 > MEM0_HOME > 这个常量。 */
const DEFAULT_HOME = process.env.MEM0_HOME || 'E:\\mem0'

/** defineTool 解析失败时退化为原样返回，保证插件仍能加载。 */
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

export const Config = z.object({
  mem0Home: z.string().description('Mem0 部署根目录（留空则用 MEM0_HOME 环境变量）').default('').volatile(),
  userId: z.string().description('记忆归属实体，检索与写入都按它隔离').default('owner').volatile(),
  pythonPath: z.string().description('Python 解释器路径；留空则用 <mem0Home>\\.venv\\Scripts\\python.exe').default('').volatile(),
  llmModel: z.string().description('写入时抽取事实用的聊天模型').default('deepseek-chat').volatile(),
  embedModel: z.string().description('向量化模型（换模型后必须重建索引）').default('Qwen/Qwen3-Embedding-0.6B').volatile(),
  embedDims: z.number().description('向量维度，必须与 embedModel 一致').default(1024).volatile(),
  deepseekKey: secretField('DeepSeek API Key（写入时抽取用）'),
  siliconflowKey: secretField('Embedding 服务的 API Key'),
})

function val(field, fallback) {
  let raw = field
  if (raw && typeof raw.get === 'function') raw = raw.get()
  if (raw === undefined || raw === null || raw === '') return fallback
  return raw
}

function compactEnv(entries) {
  const out = {}
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

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
    verifyScript: join(home, 'app', 'verify.py'),
    dataReady: existsSync(join(home, 'data')),
    secretsReady: existsSync(join(home, 'secrets.json')),
    logPath: join(home, 'setup.log'),
  }
}

/** PowerShell 单引号字符串：内部单引号翻倍。 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** 找可用的 Python 3.10+：先 py -3，再 python。 */
function findPython() {
  const candidates = [
    { cmd: 'py', args: ['-3'] },
    { cmd: 'python', args: [] },
  ]
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate.cmd, [...candidate.args, '--version'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      })
      const text = `${result.stdout || ''}${result.stderr || ''}`
      const match = text.match(/Python (3\.\d+\.\d+)/)
      if (result.status === 0 && match) return { ...candidate, version: match[1] }
    } catch {
      /* 换下一个候选 */
    }
  }
  return null
}

/** PowerShell 的绝对路径（Electron 进程的 PATH 可能不含 System32）。 */
function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  const abs = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(abs) ? abs : 'powershell.exe'
}

/**
 * 生成一个可执行的 .ps1，并返回给调用方。
 *
 * 为什么不在插件里直接 spawn：在 Electron Host 里 spawn 出来的 PowerShell
 * 进程不执行脚本（相同脚本从普通 shell 跑完全正常），几轮尝试都没有输出。
 * 因此改为「插件生成脚本 + 调用方用 shell 执行」，可靠且日志可见。
 */
function writeSetupScript(body, logPath, label) {
  const dir = join(logPath, '..')
  mkdirSync(dir, { recursive: true })
  const scriptPath = join(dir, `.mem0-setup-${label}.ps1`)

  const indented = body
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\r\n')

  const content = [
    `$ErrorActionPreference = 'Continue'`,
    `$log = ${psQuote(logPath)}`,
    `"=== ${label} @ " + (Get-Date -Format o) | Out-File -FilePath $log -Append -Encoding utf8`,
    `try {`,
    `  & {`,
    indented,
    `  } *>> $log`,
    `} catch { $_ | Out-File -FilePath $log -Append -Encoding utf8 }`,
    `"EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8`,
  ].join('\r\n')

  // 带 BOM，PowerShell 5.1 才不会把 UTF-8 当 ANSI 读
  writeFileSync(scriptPath, `\uFEFF${content}`, 'utf8')
  const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
  return { scriptPath, command, logPath }
}

/** 读日志尾部。 */
function tail(logPath, lines = 10) {
  try {
    const all = readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/)
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

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
    `${mark(info.secretsReady)} secrets.json（可选）`,
  ]

  if (!ready) {
    lines.push('', '修复顺序：mem0_setup(action="venv") → action="deps" → action="verify"')
    if (!info.appReady) lines.push(`- 还需要把仓库的 app/ 复制到 ${join(info.home, 'app')}`)
  }

  const log = tail(info.logPath)
  if (log) lines.push('', '最近日志（setup.log 尾部）：', log)
  return lines.join('\n')
}

export function apply(ctx, config) {
  const home = () => String(val(config.mem0Home, DEFAULT_HOME)).replace(/[\\/]+$/, '')

  // ---- 原生工具：自检 + 分步安装 ----
  try {
    ctx.tools.register(
      defineTool({
        name: 'mem0_setup',
        description:
          '检查或准备本地 Mem0 记忆后端。action=check 只读自检；venv / deps / verify 会生成一个 PowerShell 脚本并返回执行命令，' +
          '调用方需用自己的 shell 运行该命令，然后再用 check 查看结果与日志。' +
          '用户说“mem0 用不了”“装好 mem0”“检查 mem0 环境”时调用。',
        parameters: {
          action: {
            type: 'string',
            description: 'check（默认）/ venv / deps / verify',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { text: { type: 'string', required: true, description: '执行结果或状态。' } },
          },
          render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(args) {
          const action = String(args.action || 'check').toLowerCase()
          const current = home()
          const info = inspect(current)

          if (action === 'check') return { text: describe(info) }

          if (action === 'venv') {
            if (info.venvReady) return { text: `虚拟环境已存在，跳过。\n${info.venvPython}` }
            const python = findPython()
            if (!python) {
              return { text: '找不到 Python 3.10+。请先安装 Python（安装时勾选 Add python.exe to PATH），再重试。' }
            }
            mkdirSync(current, { recursive: true })
            const body = `& ${psQuote(python.cmd)} ${python.args.join(' ')} -m venv ${psQuote(join(current, '.venv'))}`
            const plan = writeSetupScript(body, info.logPath, 'venv')
            return {
              text: [
                `已生成虚拟环境创建脚本（Python ${python.version}）：`,
                plan.scriptPath,
                '',
                '请用 shell 执行下面这条命令，然后调用 action="check" 查看结果：',
                plan.command,
              ].join('\n'),
            }
          }

          if (action === 'deps') {
            if (!info.venvReady) {
              return { text: '虚拟环境还不存在。先运行 action="venv"。' }
            }
            const body =
              `& ${psQuote(info.venvPython)} -m pip install --upgrade pip --quiet\r\n` +
              `& ${psQuote(info.venvPython)} -m pip install mem0ai mcp --quiet`
            const plan = writeSetupScript(body, info.logPath, 'deps')
            return {
              text: [
                '已生成依赖安装脚本（pip，通常 1–3 分钟）：',
                plan.scriptPath,
                '',
                '请用 shell 执行下面这条命令，然后调用 action="check" 查看结果：',
                plan.command,
              ].join('\n'),
            }
          }

          if (action === 'verify') {
            if (!info.venvReady || !existsSync(info.verifyScript)) {
              return { text: '还不能自检：需要虚拟环境和 app/verify.py 都就位。' }
            }
            const body = `& ${psQuote(info.venvPython)} ${psQuote(info.verifyScript)}`
            const plan = writeSetupScript(body, info.logPath, 'verify')
            return {
              text: [
                '已生成自检脚本：',
                plan.scriptPath,
                '',
                '请用 shell 执行下面这条命令，然后调用 action="check" 查看结果：',
                plan.command,
              ].join('\n'),
            }
          }

          return { text: `未知 action：${action}。可用：check / venv / deps / verify。` }
        },
      }),
    )
  } catch (error) {
    console.warn('[mem0] mem0_setup 注册失败：', error && error.message)
  }

  // ---- 环境就绪才挂 MCP ----
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
