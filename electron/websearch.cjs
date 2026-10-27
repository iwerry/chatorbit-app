// Keyless web search + page reading. Works for every model, including small local ones:
// results are fetched here and handed to the model as context.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36'

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function unwrapDdg(href) {
  try {
    const u = new URL(href.startsWith('//') ? 'https:' + href : href, 'https://duckduckgo.com')
    const target = u.searchParams.get('uddg')
    return target ? decodeURIComponent(target) : u.href
  } catch {
    return href
  }
}

// Parses html.duckduckgo.com result pages.
function parseDuckDuckGo(html) {
  const out = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1)
  for (const b of blocks) {
    if (/result--ad|badge--ad/i.test(b.slice(0, 400))) continue
    const a = b.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || b.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const snip = b.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i)
    const url = unwrapDdg(a[1].replace(/&amp;/g, '&'))
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue
    out.push({ title: decode(a[2]), url, snippet: decode(snip?.[1] || '') })
  }
  return out
}

async function duckDuckGo(q, signal) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    body: new URLSearchParams({ q, kl: 'wt-wt' }).toString(),
    signal,
  })
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  return parseDuckDuckGo(await res.text())
}

async function wikipedia(q, lang = 'en', signal) {
  const base = `https://${lang}.wikipedia.org/w/api.php`
  const u = `${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`
  const res = await fetch(u, { headers: { 'user-agent': 'Orbi/0.1 (https://orbix.com)' }, signal })
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const json = await res.json()
  return (json.query?.search || []).map((r) => ({
    title: r.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: decode(r.snippet),
  }))
}

function htmlToText(html) {
  const body = (html.match(/<(article|main)[\s\S]*?<\/\1>/i) || [html])[0]
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|p|div|li|h\d|tr|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

async function readPage(url, maxChars = 6000, signal) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, redirect: 'follow', signal: signal || AbortSignal.timeout(12000) })
  const type = res.headers.get('content-type') || ''
  if (!/text|html|json|xml/.test(type)) return ''
  const raw = await res.text()
  const text = type.includes('html') ? htmlToText(raw) : raw
  return text.slice(0, maxChars)
}

// search + read the top pages; returns { query, results: [{title,url,snippet,content}] }
async function search(q, { lang = 'en', read = 3, maxChars = 3500 } = {}) {
  const signal = AbortSignal.timeout(15000)
  let results = []
  let engine = 'duckduckgo'
  try {
    results = await duckDuckGo(q, signal)
  } catch {
    results = []
  }
  if (!results.length) {
    engine = 'wikipedia'
    const wl = /^[a-z]{2}/.exec(lang)?.[0] || 'en'
    results = await wikipedia(q, wl, signal).catch(() => [])
    if (!results.length && wl !== 'en') results = await wikipedia(q, 'en', signal).catch(() => [])
  }
  results = results.slice(0, 8)
  await Promise.all(
    results.slice(0, read).map(async (r) => {
      try {
        r.content = await readPage(r.url, maxChars)
      } catch {
        r.content = ''
      }
    }),
  )
  return { query: q, engine, results }
}

function toContext(res) {
  if (!res.results.length) return `Web search for "${res.query}" returned no results.`
  return [
    `Web search results for "${res.query}" (retrieved ${new Date().toISOString().slice(0, 10)}). Use them to answer, cite sources as [1], [2]… and say when they do not answer the question.`,
    ...res.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}${r.content ? `\n---\n${r.content}` : ''}`),
  ].join('\n\n')
}

module.exports = { search, readPage, toContext, parseDuckDuckGo, htmlToText }
