/**
 * Mem0 配置页（浏览器端）。
 *
 * 注册到 Plugins 页的 `plugins.row.config` 槽位，key 为「包名#行 id」。
 * 页面自身负责暂存与保存；Host 侧通过 form.state / form.mutate 提供数据。
 */

window.__ModuleLoader__.load({
  id: '@local/mem0-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const FIELDS = [
      { key: 'mem0Home', label: 'Mem0 目录', hint: '留空则用安装脚本写入的 MEM0_HOME 环境变量', placeholder: '' },
      { key: 'userId', label: 'userId', hint: '记忆归属实体，按它隔离', placeholder: 'owner' },
      { key: 'pythonPath', label: 'Python 路径', hint: '留空则用 <目录>\\.venv\\Scripts\\python.exe', placeholder: '' },
      { key: 'llmModel', label: '聊天模型', hint: '写入时抽取事实', placeholder: 'deepseek-chat' },
      { key: 'embedModel', label: '向量模型', hint: '换模型后需重建索引', placeholder: 'Qwen/Qwen3-Embedding-0.6B' },
      { key: 'embedDims', label: '向量维度', hint: '必须与向量模型一致', placeholder: '1024', numeric: true },
      { key: 'deepseekKey', label: 'DeepSeek Key', hint: '留空则回落到 secrets.json / 环境变量', placeholder: 'sk-...', secret: true },
      { key: 'siliconflowKey', label: 'Embedding Key', hint: '留空则回落到 secrets.json / 环境变量', placeholder: 'sk-...', secret: true },
    ]

    /** 从 form.state 里取一个字段的当前值；兼容裸值与 {value} 两种形态。 */
    function readValue(state, key) {
      const bag = state && state.value
      if (!bag || typeof bag !== 'object') return ''
      const raw = bag[key]
      if (raw && typeof raw === 'object' && 'value' in raw) return raw.value == null ? '' : raw.value
      return raw == null ? '' : raw
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 8px' },
      field: { display: 'flex', flexDirection: 'column', gap: 4 },
      label: { fontSize: 13, fontWeight: 600 },
      hint: { fontSize: 11, opacity: 0.65 },
      input: {
        padding: '7px 10px', fontSize: 13, borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.35)', background: 'transparent',
        color: 'inherit', width: '100%', boxSizing: 'border-box',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center' },
      button: {
        padding: '7px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
        border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit',
      },
      primary: { background: '#4F46E5', borderColor: '#4F46E5', color: '#fff' },
      error: { color: '#d33', fontSize: 12 },
      ok: { color: '#2a8a4a', fontSize: 12 },
    }

    function Mem0Config(props) {
      const form = props && props.form
      const view = props && props.view
      const state = (form && form.state) || {}
      const [draft, setDraft] = React.useState({})
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      if (view === 'summary') {
        return h('div', { style: { fontSize: 12, opacity: 0.8 } }, '配置目录、模型与密钥')
      }

      const valueOf = (key) => (key in draft ? draft[key] : readValue(state, key))

      function onChange(key, val) {
        setSaved(false)
        setDraft((prev) => ({ ...prev, [key]: val }))
      }

      async function onSave() {
        if (!form || typeof form.mutate !== 'function') {
          setError('当前页面没有提供可写的表单接口')
          return
        }
        const ops = []
        for (const field of FIELDS) {
          if (!(field.key in draft)) continue
          let value = draft[field.key]
          if (field.numeric) {
            const n = Number(value)
            if (!Number.isFinite(n) || n <= 0) {
              setError(`${field.label} 必须是正整数`)
              return
            }
            value = n
          }
          ops.push({ op: 'set', path: [field.key], value })
        }
        if (ops.length === 0) {
          setError('没有改动')
          return
        }
        setBusy(true)
        setError('')
        try {
          await form.mutate(ops, state.revision)
          setDraft({})
          setSaved(true)
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: styles.wrap },
        FIELDS.map((field) =>
          h(
            'div',
            { key: field.key, style: styles.field },
            h('label', { style: styles.label }, field.label),
            h('input', {
              type: field.secret ? 'password' : 'text',
              style: styles.input,
              placeholder: field.placeholder,
              value: valueOf(field.key),
              onChange: (e) => onChange(field.key, e.target.value),
              spellCheck: false,
            }),
            h('span', { style: styles.hint }, field.hint),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'button',
            {
              type: 'button',
              style: { ...styles.button, ...styles.primary, opacity: busy ? 0.6 : 1 },
              disabled: busy,
              onClick: onSave,
            },
            busy ? '保存中…' : '保存',
          ),
          error ? h('span', { style: styles.error }, error) : null,
          saved ? h('span', { style: styles.ok }, '已保存，重启插件后生效') : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: '@local/mem0-memory#mem0-memory',
            },
            Mem0Config,
          ),
        )
      },
    }
  },
})
