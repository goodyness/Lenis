import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  title?: React.ReactNode
}

export function Card({ children, className = '', title }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-slate-200 bg-white p-6 shadow-sm',
        className,
      ].join(' ')}
    >
      {title && (
        <div className="mb-4 text-base font-semibold text-slate-900">{title}</div>
      )}
      {children}
    </div>
  )
}
