import React, { useId } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  className?: string
}

export function Input({
  label,
  error,
  helperText,
  id: propId,
  className = '',
  required,
  disabled,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const id = propId ?? generatedId
  const errorId = `${id}-error`
  const helperId = `${id}-helper`

  const describedBy = [
    error ? errorId : null,
    helperText && !error ? helperId : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
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
      <input
        id={id}
        disabled={disabled}
        required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        className={[
          'w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
            : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
          disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400' : 'bg-white',
        ].join(' ')}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  )
}
