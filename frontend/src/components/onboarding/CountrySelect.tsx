import React, { useEffect, useId, useRef, useState } from 'react'
import { AFRICAN_COUNTRIES } from '../../data/africanCountries'
import type { CountryOption } from '../../data/africanCountries'

interface CountrySelectProps {
  value?: string
  onChange: (country: string, dialCode: string) => void
  error?: string
  disabled?: boolean
  required?: boolean
  label?: string
}

export function CountrySelect({
  value,
  onChange,
  error: externalError,
  disabled = false,
  required = false,
  label,
}: CountrySelectProps) {
  const id = useId()
  const listboxId = `${id}-listbox`
  const errorId = `${id}-error`

  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const filteredCountries = searchQuery
    ? AFRICAN_COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : AFRICAN_COUNTRIES

  const hasError = !!externalError

  function handleInputFocus() {
    if (!disabled) {
      setIsOpen(true)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value)
    setIsOpen(true)
  }

  function handleSelect(country: CountryOption) {
    setSearchQuery('')
    setIsOpen(false)
    onChange(country.name, country.dialCode)
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }

  const inputDisplayValue = isOpen ? searchQuery : (value ?? '')

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
          {required && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          type="text"
          autoComplete="off"
          disabled={disabled}
          aria-required={required}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          placeholder="Select a country"
          value={inputDisplayValue}
          onFocus={handleInputFocus}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          className={[
            'w-full rounded-md border px-3 py-2 pr-10 text-sm outline-none transition-colors',
            'focus:ring-2 focus:ring-slate-400 focus:ring-offset-0',
            disabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
              : hasError
                ? 'border-red-400 bg-white text-slate-900'
                : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400',
          ].join(' ')}
        />

        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            className={[
              'h-4 w-4 transition-transform',
              isOpen ? 'rotate-180 text-slate-600' : 'text-slate-400',
            ].join(' ')}
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="African countries"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {filteredCountries.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-400">
                No countries match &ldquo;{searchQuery}&rdquo;
              </li>
            ) : (
              filteredCountries.map((country) => {
                const isSelected = country.name === value
                return (
                  <li
                    key={country.cca2}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(country)
                    }}
                    className={[
                      'flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors',
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100',
                    ].join(' ')}
                  >
                    <span>{country.name}</span>
                    {country.dialCode && (
                      <span
                        className={[
                          'ml-2 shrink-0 text-xs',
                          isSelected ? 'text-slate-300' : 'text-slate-400',
                        ].join(' ')}
                      >
                        {country.dialCode}
                      </span>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      {externalError && (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {externalError}
        </p>
      )}
    </div>
  )
}
