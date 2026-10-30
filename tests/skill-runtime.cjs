const { test } = require('node:test')
const assert = require('node:assert/strict')
const jobs = require('../electron/command-jobs.cjs')
const { streamChat } = require('../electron/providers.cjs')

test('command results preserve Unicode, stderr, exit status and visible events', async () => {
  const events = []
  const origin = { isDestroyed: () => false, send: (_channel, event) => events.push(event) }
  const command = process.platform === 'win32' ? 'Write-Output "olá café"; [Console]::Error.WriteLine("diagnóstico"); exit 7' : "printf 'olá café\\n'; printf 'diagnóstico\\n' >&2; exit 7"
  const result = await jobs.run({ command, cwd: process.cwd() }, origin)
  assert.equal(result.exit_code, 7)
  assert.match(result.stdout, /olá café/)
  assert.match(result.stderr, /diagnóstico/)
  assert.match(result.error, /7/)
  assert.equal(events[0].phase, 'start')
  assert.equal(events.at(-1).phase, 'exit')
  assert.ok(events.some((event) => event.phase === 'data'))
})

test('only the owning window can stop a command; cancellation returns to chat', async () => {
  const started = Date.now()
  const other = { isDestroyed: () => false, send() {} }
  const origin = { isDestroyed: () => false, send(_channel, event) { if (event.phase === 'start') setTimeout(() => { assert.equal(jobs.stop(event.id, other), false); jobs.stop(event.id, origin) }, 200) } }
  const result = await jobs.run({ command: process.platform === 'win32' ? 'Start-Sleep -Seconds 60' : 'sleep 60', cwd: process.cwd() }, origin)
  assert.equal(result.cancelled, true)
  assert.match(result.error, /Stopped/)
  assert.ok(Date.now() - started < 7000, 'Cancellation must stop the process, not wait for it to finish')
})

test('a stopped chat does not launch another command', async () => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(jobs.run({ command: 'echo should-not-run', cwd: process.cwd() }, null, controller.signal), /Stopped/)
})

test('timeout is reported separately from a user cancellation', async () => {
  const result=await jobs.run({command:process.platform==='win32'?'Start-Sleep -Seconds 60':'sleep 60',cwd:process.cwd(),timeoutSeconds:1},null)
  assert.equal(result.timedOut,true); assert.equal(result.cancelled,false); assert.match(result.error,/timed out/)
})

test('goal mode continues beyond eight tool rounds and receives actual tool results', async () => {
  const originalFetch = global.fetch
  let round = 0, calls = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    if (round > 0) assert.match(body.messages.at(-1).content, /exit_code/)
    const delta = round++ < 10 ? { tool_calls: [{ index: 0, id: `call-${round}`, function: { name: 'check', arguments: '{}' } }] } : { content: 'Verified final result.' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  let output = ''
  try {
    await streamChat({ providerId: 'orbicloud', model: 'test', messages: [{ role: 'user', content: 'Finish the goal' }], goal: true }, { baseUrl: 'https://example.invalid/v1' }, (delta) => { output += delta.text || '' }, new AbortController().signal, { tools: [{ name: 'check', description: 'Check', parameters: { type: 'object', properties: {} } }], call: async () => { calls++; return { exit_code: 0, stdout: 'checked' } } })
    assert.equal(calls, 10)
    assert.match(output, /Verified final result/)
  } finally { global.fetch = originalFetch }
})

test('denying a command pauses goal mode instead of retrying or running another tool', async () => {
  const originalFetch = global.fetch
  let requests = 0, calls = 0
  global.fetch = async () => { requests++; return new Response(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'denied',function:{name:'run_command',arguments:'{}'}}]}}]})}\n\ndata: [DONE]\n\n`) }
  try {
    await streamChat({providerId:'orbicloud',model:'test',messages:[{role:'user',content:'Goal'}],goal:true},{baseUrl:'https://example.invalid/v1'},()=>{},new AbortController().signal,{tools:[{name:'run_command',description:'Run',parameters:{type:'object'}}],call:async()=>{calls++;return {error:'The user declined this action.'}}})
    assert.equal(requests,1); assert.equal(calls,1)
  } finally { global.fetch=originalFetch }
})
