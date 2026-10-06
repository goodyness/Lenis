import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { Button } from '../ui/Button'

interface DocumentPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  documentUrl: string | null
}

export function DocumentPreviewModal({
  isOpen,
  onClose,
  title,
  documentUrl,
}: DocumentPreviewModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !documentUrl) {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        setBlobUrl(null)
      }
      setContentType(null)
      setError(null)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    // If it is a relative API path, fetch with apiClient so Authorization Bearer header is sent
    const isRelative = documentUrl.startsWith('/')

    if (isRelative) {
      apiClient
        .get(documentUrl, { responseType: 'blob' })
        .then((response) => {
          if (!isMounted) return
          const type = response.headers['content-type'] || response.data.type || ''
          const url = URL.createObjectURL(response.data)
          setBlobUrl(url)
          setContentType(type)
        })
        .catch((err) => {
          if (!isMounted) return
          console.error('Failed to load document:', err)
          setError('Failed to fetch document from server. Please check your connection or permissions.')
        })
        .finally(() => {
          if (isMounted) setLoading(false)
        })
    } else {
      // External S3 presigned URL
      setBlobUrl(documentUrl)
      const lower = documentUrl.toLowerCase()
      if (lower.includes('.pdf')) {
        setContentType('application/pdf')
      } else if (lower.includes('.png')) {
        setContentType('image/png')
      } else if (lower.includes('.jpg') || lower.includes('.jpeg')) {
        setContentType('image/jpeg')
      }
      setLoading(false)
    }

    return () => {
      isMounted = false
    }
  }, [isOpen, documentUrl])

  if (!isOpen) return null

  const isPdf =
    contentType?.includes('pdf') ||
    documentUrl?.toLowerCase().endsWith('.pdf') ||
    documentUrl?.toLowerCase().includes('.pdf?')
  const isImage =
    contentType?.startsWith('image/') ||
    documentUrl?.toLowerCase().match(/\.(png|jpe?g|webp|gif)(\?|$)/i)

  function handleDownload() {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function handleOpenInNewTab() {
    if (!blobUrl) return
    window.open(blobUrl, '_blank')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-preview-modal-title"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div>
            <h3 id="doc-preview-modal-title" className="text-base font-semibold text-slate-900">
              {title}
            </h3>
            {contentType && (
              <p className="text-xs text-slate-500 mt-0.5">Type: {contentType}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {blobUrl && !loading && (
              <>
                <Button variant="secondary" size="sm" onClick={handleOpenInNewTab}>
                  Open in New Tab ↗
                </Button>
                <Button variant="secondary" size="sm" onClick={handleDownload}>
                  Download
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors ml-2"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center min-h-[400px] bg-slate-100/50">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <svg className="h-8 w-8 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              <p className="text-sm">Loading document preview…</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center max-w-md">
              <p className="text-sm text-red-700 font-medium">{error}</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {!loading && !error && blobUrl && (
            <div className="w-full flex items-center justify-center">
              {isPdf ? (
                <iframe
                  src={blobUrl}
                  title={title}
                  className="h-[600px] w-full rounded-lg border border-slate-200 bg-white shadow-sm"
                />
              ) : isImage ? (
                <div className="flex flex-col items-center">
                  <img
                    src={blobUrl}
                    alt={title}
                    className="max-h-[600px] max-w-full rounded-lg object-contain border border-slate-200 shadow-md bg-white p-1"
                  />
                </div>
              ) : (
                <iframe
                  src={blobUrl}
                  title={title}
                  className="h-[600px] w-full rounded-lg border border-slate-200 bg-white shadow-sm"
                />
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-slate-200 px-6 py-3 bg-white">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
