import React, { useId, useRef, useState } from 'react'

const DEFAULT_ACCEPT = ['application/pdf', 'image/jpeg', 'image/png']
const DEFAULT_MAX_SIZE_MB = 10

interface FileUploadProps {
  onFileSelect: (file: File) => void
  accept?: string[]
  maxSizeMb?: number
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
  id?: string
}

export function FileUpload({
  onFileSelect,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = DEFAULT_MAX_SIZE_MB,
  label,
  error: externalError,
  disabled = false,
  required = false,
  id: propId,
}: FileUploadProps) {
  const generatedId = useId()
  const id = propId ?? generatedId
  const errorId = `${id}-error`
  const inputRef = useRef<HTMLInputElement>(null)

  const [isDragActive, setIsDragActive] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Internal error takes priority over external error per spec
  const displayError = internalError ?? externalError ?? null

  function validateAndSelect(file: File): boolean {
    // MIME type check
    if (!accept.includes(file.type)) {
      const readableTypes = accept
        .map((t) => t.split('/')[1].toUpperCase())
        .join(', ')
      setInternalError(
        `Invalid file type "${file.type}". Accepted types: ${readableTypes}.`,
      )
      return false
    }

    // Size check
    const maxBytes = maxSizeMb * 1024 * 1024
    if (file.size > maxBytes) {
      setInternalError(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is ${maxSizeMb} MB.`,
      )
      return false
    }

    setInternalError(null)
    setSelectedFile(file)
    onFileSelect(file)
    return true
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      validateAndSelect(file)
    }
    // Reset input value so the same file can be re-selected after clearing
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragActive(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    if (disabled) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      validateAndSelect(file)
    }
  }

  function handleZoneClick() {
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  function handleZoneKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      inputRef.current?.click()
    }
  }

  function handleClear() {
    setSelectedFile(null)
    setInternalError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-slate-700"
        >
          {label}
          {required && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      {/* Hidden native file input */}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept.join(',')}
        disabled={disabled}
        aria-required={required}
        aria-invalid={!!displayError}
        aria-describedby={displayError ? errorId : undefined}
        className="sr-only"
        onChange={handleInputChange}
      />

      {selectedFile ? (
        /* Selected file preview */
        <div
          className={[
            'flex items-center justify-between rounded-md border px-3 py-2.5',
            displayError
              ? 'border-red-400 bg-red-50'
              : 'border-slate-300 bg-slate-50',
          ].join(' ')}
        >
          <div className="flex min-w-0 items-center gap-2">
            {/* File icon */}
            <svg
              className="h-5 w-5 shrink-0 text-slate-500"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 000 2h6a1 1 0 100-2H7z"
                clipRule="evenodd"
              />
            </svg>
            <span className="truncate text-sm text-slate-700">
              {selectedFile.name}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>

          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label={`Remove ${selectedFile.name}`}
            className="ml-2 shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        /* Drag-and-drop zone */
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={handleZoneClick}
          onKeyDown={handleZoneKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-0',
            disabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-50'
              : isDragActive
                ? 'border-slate-500 bg-slate-50'
                : displayError
                  ? 'border-red-400 bg-red-50'
                  : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50',
          ].join(' ')}
        >
          {/* Upload icon */}
          <svg
            className={[
              'mb-3 h-10 w-10',
              disabled ? 'text-slate-300' : isDragActive ? 'text-slate-600' : 'text-slate-400',
            ].join(' ')}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <p
            className={[
              'text-sm font-medium',
              disabled ? 'text-slate-400' : 'text-slate-700',
            ].join(' ')}
          >
            {isDragActive ? 'Drop file here' : 'Drag & drop or click to upload'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {accept
              .map((t) => t.split('/')[1].toUpperCase())
              .join(', ')}{' '}
            · max {maxSizeMb} MB
          </p>
        </div>
      )}

      {/* Error message — internal error takes priority */}
      {displayError && (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {displayError}
        </p>
      )}
    </div>
  )
}
