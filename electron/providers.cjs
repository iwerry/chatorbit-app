// AI providers: one place that knows how to talk to every API.
// Chat and Creative only ask "stream a reply" / "generate an image".

const PROVIDERS = [
  { id: 'orbi', name: 'Orbi Local', kind: 'openai', baseUrl: 'http://127.0.0.1/v1', needsKey: false, mode: 'Local', hint: 'Free tiny models that run on this PC — downloaded on demand.', builtin: true },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, mode: 'API', hint: 'One key for GPT, Claude, Gemini, DeepSeek, Llama… and image models.' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, mode: 'API', hint: 'GPT models and gpt-image for images.' },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true, mode: 'API', hint: 'Claude models.' },
  { id: 'gemini', name: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, mode: 'API', hint: 'Gemini models via Google AI Studio key.' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, mode: 'API', hint: 'DeepSeek chat and reasoner.' },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, mode: 'API', hint: 'Very fast open models, plus Whisper speech-to-text.' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, mode: 'API', hint: 'Mistral Large and friends.' },
  { id: 'ollama', name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', needsKey: false, mode: 'Local', hint: 'Local models running in Ollama on this PC.' },
  { id: 'lmstudio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234/v1', needsKey: false, mode: 'Local', hint: 'Local models served by LM Studio.' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: 'http://localhost:8080/v1', needsKey: false, mode: 'Local', hint: 'llama.cpp server, sd.cpp server, vLLM or any OpenAI-compatible endpoint.' },
]

function def(id) {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}

function headersFor(p, cfg) {
  const h = { 'Content-Type': 'application/json' }
  if (p.kind === 'anthropic') {
    h['x-api-key'] = cfg.apiKey || ''
    h['anthropic-version'] = '2023-06-01'
  } else if (cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`
  }
  if (p.id === 'openrouter') {
    h['HTTP-Referer'] = 'https://orbix.com'
    h['X-Title'] = 'Orbi'
  }
  return h
}

function base(p, cfg) {
  return (cfg.baseUrl || p.baseUrl).replace(/\/+$/, '')
}

async function readError(res) {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return j.error?.message || j.message || j.error || text
  } catch {
    return text || res.statusText
  }
}

async function listModels(id, cfg) {
  const p = def(id)
  const res = await fetch(`${base(p, cfg)}/models${p.kind === 'anthropic' ? '?limit=100' : ''}`, {
    headers: headersFor(p, cfg),
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`${p.name}: ${res.status} ${await readError(res)}`)
  const json = await res.json()
  const rows = json.data || json.models || []
  return rows
    .map((m) => {
      const mid = (m.id || m.name || '').replace(/^models\//, '')
      const out = m.architecture?.output_modalities || []
      const image =
        out.includes('image') || /^(gpt-image|dall-e|imagen)/i.test(mid) || /flux|stable-diffusion|sdxl|z-image/i.test(mid)
      return { id: mid, name: m.name || m.display_name || mid, image }
    })
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function toOpenAIMessages(messages, system) {
  const out = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.images?.length && m.role === 'user') {
      out.push({
        role: 'user',
        content: [{ type: 'text', text: m.content }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))],
      })
    } else out.push({ role: m.role, content: m.content })
  }
  return out
}

function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.images?.length && m.role === 'user') {
      return {
        role: 'user',
        content: [
          ...m.images.map((url) => {
            const [, mime, data] = url.match(/^data:([^;]+);base64,(.*)$/) || []
            return { type: 'image', source: { type: 'base64', media_type: mime, data } }
          }),
          { type: 'text', text: m.content },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })
}

// Parses a Server-Sent Events body and calls onEvent with each JSON payload.
async function readSSE(res, onEvent) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue // partial or non-JSON line
      }
      onEvent(parsed)
    }
  }
}

function isToolError(msg) {
  return /tool|function|unsupported|not support/i.test(msg)
}

function resultText(r) {
  const t = typeof r === 'string' ? r : JSON.stringify(r)
  return t.length > 16000 ? t.slice(0, 16000) + '\n…(truncated)' : t
}

// Streams a reply. When `toolkit` has tools, runs the tool-calling loop (max 8 rounds).
async function streamChat({ providerId, model, messages, system, thinking, effort, maxTokens }, cfg, onDelta, signal, toolkit) {
  const p = def(providerId)
  if (p.needsKey && !cfg.apiKey) throw new Error(`Add your ${p.name} API key in Settings → Providers.`)
  let tools = toolkit?.tools?.length ? toolkit.tools : null
  let wroteText = false
  const emitText = (t) => {
    if (!t) return
    wroteText = true
    onDelta({ text: t })
  }

  const runTool = async (id, name, rawArgs) => {
    let args = {}
    try {
      args = typeof rawArgs === 'string' ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs || {}
    } catch {
      args = {}
    }
    onDelta({ tool: { id, name, status: 'running', args } })
    try {
      const r = await toolkit.call(name, args)
      const text = resultText(r)
      onDelta({ tool: { id, name, status: r && r.error ? 'error' : 'done', result: text.slice(0, 4000) } })
      return text
    } catch (e) {
      onDelta({ tool: { id, name, status: 'error', result: String(e.message || e) } })
      return JSON.stringify({ error: String(e.message || e) })
    }
  }

  if (p.kind === 'anthropic') {
    if (thinking) tools = null
    const msgs = toAnthropicMessages(messages)
    for (let round = 0; round < 8; round++) {
      const body = { model, max_tokens: maxTokens || 8192, stream: true, messages: msgs }
      if (system) body.system = system
      if (tools) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
      if (thinking) {
        const budget = { Fast: 2048, Medium: 6000, High: 16000 }[effort] || 6000
        body.thinking = { type: 'enabled', budget_tokens: budget }
        body.max_tokens = budget + 8192
      }
      const res = await fetch(`${base(p, cfg)}/messages`, { method: 'POST', headers: headersFor(p, cfg), body: JSON.stringify(body), signal })
      if (!res.ok) {
        const err = await readError(res)
        if (tools && round === 0 && isToolError(err)) {
          tools = null
          round--
          continue
        }
        throw new Error(`${p.name}: ${res.status} ${err}`)
      }
      const blocks = []
      let stop = null
      if (round > 0 && wroteText) emitText('\n\n')
      await readSSE(res, (ev) => {
        if (ev.type === 'content_block_start') {
          const b = ev.content_block
          blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, json: '' } : { type: b.type, text: '' }
        }
        if (ev.type === 'content_block_delta') {
          const b = blocks[ev.index]
          if (ev.delta?.type === 'text_delta') {
            if (b) b.text += ev.delta.text
            emitText(ev.delta.text)
          }
          if (ev.delta?.type === 'thinking_delta') onDelta({ reasoning: ev.delta.thinking })
          if (ev.delta?.type === 'input_json_delta' && b) b.json += ev.delta.partial_json
        }
        if (ev.type === 'message_delta') stop = ev.delta?.stop_reason
        if (ev.type === 'error') throw new Error(ev.error?.message || 'Stream error')
      })
      const uses = blocks.filter((b) => b && b.type === 'tool_use')
      if (stop !== 'tool_use' || !uses.length) return
      msgs.push({
        role: 'assistant',
        content: blocks
          .filter((b) => b && (b.type === 'text' ? b.text : b.type === 'tool_use'))
          .map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.json ? JSON.parse(b.json) : {} } : { type: 'text', text: b.text })),
      })
      const results = []
      for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(u.id, u.name, u.json) })
      msgs.push({ role: 'user', content: results })
    }
    return
  }

  const msgs = toOpenAIMessages(messages, system)
  for (let round = 0; round < 8; round++) {
    const body = { model, stream: true, messages: msgs }
    if (tools) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    if (thinking && p.id === 'openrouter') body.reasoning = { effort: (effort || 'Medium').toLowerCase().replace('fast', 'low') }
    const res = await fetch(`${base(p, cfg)}/chat/completions`, { method: 'POST', headers: headersFor(p, cfg), body: JSON.stringify(body), signal })
    if (!res.ok) {
      const err = await readError(res)
      if (tools && round === 0 && isToolError(String(err))) {
        tools = null
        round--
        continue
      }
      throw new Error(`${p.name}: ${res.status} ${err}`)
    }
    if (round > 0 && wroteText) emitText('\n\n')
    let text = ''
    const calls = []
    await readSSE(res, (ev) => {
      if (ev.error) throw new Error(ev.error.message || 'Stream error')
      const d = ev.choices?.[0]?.delta
      if (!d) return
      if (d.reasoning || d.reasoning_content) onDelta({ reasoning: d.reasoning || d.reasoning_content })
      if (d.content) {
        text += d.content
        emitText(d.content)
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? calls.length
        calls[i] = calls[i] || { id: '', name: '', args: '' }
        if (tc.id) calls[i].id = tc.id
        if (tc.function?.name) calls[i].name += tc.function.name
        if (tc.function?.arguments) calls[i].args += tc.function.arguments
      }
    })
    const real = calls.filter((c) => c && c.name)
    if (!real.length) return
    real.forEach((c, i) => (c.id = c.id || `call_${round}_${i}`))
    msgs.push({ role: 'assistant', content: text || null, tool_calls: real.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) })
    for (const c of real) msgs.push({ role: 'tool', tool_call_id: c.id, content: await runTool(c.id, c.name, c.args) })
  }
}

async function dataFromUrl(url) {
  if (url.startsWith('data:')) {
    const [, mime, data] = url.match(/^data:([^;]+);base64,(.*)$/)
    return { buffer: Buffer.from(data, 'base64'), mime }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download image: ${res.status}`)
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' }
}

async function generateImage({ providerId, model, prompt, size }, cfg) {
  const p = def(providerId)
  if (p.needsKey && !cfg.apiKey) throw new Error(`Add your ${p.name} API key in Settings → Providers.`)

  if (p.id === 'openrouter') {
    const res = await fetch(`${base(p, cfg)}/chat/completions`, {
      method: 'POST',
      headers: headersFor(p, cfg),
      body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`${p.name}: ${res.status} ${await readError(res)}`)
    const json = await res.json()
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
    if (!url) throw new Error('This model did not return an image. Pick a model with image output.')
    return dataFromUrl(url)
  }

  if (p.kind === 'anthropic') throw new Error('Anthropic does not generate images. Use OpenRouter, OpenAI or a local sd.cpp server.')

  const body = { model, prompt, n: 1, size: size || '1024x1024' }
  const res = await fetch(`${base(p, cfg)}/images/generations`, { method: 'POST', headers: headersFor(p, cfg), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${p.name}: ${res.status} ${await readError(res)}`)
  const json = await res.json()
  const item = json.data?.[0]
  if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' }
  if (item?.url) return dataFromUrl(item.url)
  throw new Error('No image returned by the provider.')
}

module.exports = { PROVIDERS, listModels, streamChat, generateImage }
