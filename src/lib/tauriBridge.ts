// Native transport preserves the existing frontend contract. No Node service is used.
type NativeApi = {
  core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>; convertFileSrc: (path: string) => string }
  event: { listen: (event: string, callback: (event: { payload: unknown[] }) => void) => Promise<() => void> }
}
const native = (window as unknown as { __TAURI__?: NativeApi }).__TAURI__
if (native) {
  const allowed = new Set(['chat:delta', 'term:data', 'term:exit', 'local:status', 'local:progress', 'local:error', 'update:state', 'update:done', 'tool:approve', 'data:changed', 'find:result'])
  const listen = (channel: string, callback: (...args: unknown[]) => void) => {
    if (!allowed.has(channel)) throw new Error(`Unsupported native event: ${channel}`)
    let disposed = false
    let stop: (() => void) | undefined
    native.event.listen(channel, (event) => { if (!disposed) callback(...event.payload) }).then((off) => { if (disposed) off(); else stop = off }).catch(console.error)
    return () => { disposed = true; stop?.() }
  }
  window.orbi = {
    platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : navigator.platform.toLowerCase().includes('win') ? 'win32' : 'linux',
    invoke: async (channel, ...args) => {
      const result = await native.core.invoke<any>('dispatch', { channel, args })
      const media = (item: any) => item && typeof item.file === 'string' && ['image', 'video', 'audio', 'file'].includes(item.kind) ? { ...item, url: native.core.convertFileSrc(item.file) } : item
      return Array.isArray(result) ? result.map(media) : media(result)
    },
    on: listen,
    onChatDelta: (callback) => listen('chat:delta', (...args) => callback(args[0] as string, args[1] as Parameters<typeof callback>[1])),
  }
}
