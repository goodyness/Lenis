import { useState } from 'react'

interface CodeSampleProps {
  code: string
  language?: string
  title?: string
}

export function CodeSample({ code, language, title }: CodeSampleProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-slate-700">
      {/* Header bar */}
      {(title || language) && (
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2">
          <div className="flex items-center gap-2">
            {title && (
              <span className="text-xs font-medium text-slate-300">{title}</span>
            )}
            {language && (
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
                {language}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? 'Copied!' : 'Copy code to clipboard'}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {copied ? (
              <>
                <svg
                  className="h-3.5 w-3.5 text-emerald-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      )}

      {/* No header — show copy button floating top-right */}
      {!title && !language && (
        <div className="relative">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? 'Copied!' : 'Copy code to clipboard'}
            className="absolute right-3 top-3 flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {copied ? (
              <>
                <svg
                  className="h-3.5 w-3.5 text-emerald-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      )}

      <pre className="overflow-x-auto bg-slate-900 p-4 text-sm leading-relaxed text-slate-100">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}
