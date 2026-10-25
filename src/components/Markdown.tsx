import { createContext, memo, useContext, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Play } from 'lucide-react'
import { api } from '../lib/api'

export const RunCodeContext = createContext<((code: string) => void) | null>(null)
const SHELL_LANGS = /^(bash|sh|shell|zsh|console|powershell|ps1|ps|pwsh|cmd|bat|batch|terminal)$/i

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const runCode = useContext(RunCodeContext)
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        {runCode && SHELL_LANGS.test(lang) && (
          <button className="md-run" onClick={() => runCode(code)} title="Run in terminal">
            <Play size={11} fill="currentColor" />
            Run in terminal
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) api.openExternal(href)
              }}
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const raw = String(children ?? '')
            const lang = /language-(\w+)/.exec(className || '')?.[1] ?? ''
            if (!className && !raw.includes('\n')) return <code className="md-inline">{children}</code>
            return <CodeBlock code={raw.replace(/\n$/, '')} lang={lang} />
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
