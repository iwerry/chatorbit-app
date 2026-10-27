const { contextBridge, ipcRenderer } = require('electron')

const listen = (channel) => (cb) => {
  const handler = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('orbi', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onChatDelta: listen('chat:delta'),
  on: (channel, cb) => {
    const allowed = ['term:data', 'term:exit', 'local:status', 'local:progress', 'local:error', 'update:state', 'update:done', 'tool:approve', 'data:changed', 'find:result']
    if (!allowed.includes(channel)) throw new Error('channel not allowed: ' + channel)
    return listen(channel)(cb)
  },
  platform: process.platform,
})
