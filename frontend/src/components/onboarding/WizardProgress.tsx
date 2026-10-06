import React from 'react'

interface WizardProgressProps {
  currentStep: number
  totalSteps: number
}

export function WizardProgress({ currentStep, totalSteps }: WizardProgressProps) {
  return (
    <div
      className="flex flex-col items-center gap-4"
      aria-label={`Step ${currentStep} of ${totalSteps}`}
    >
      {/* Step counter label */}
      <p className="text-sm font-medium text-slate-500">
        Step{' '}
        <span className="text-slate-900 font-semibold">{currentStep}</span>{' '}
        of {totalSteps}
      </p>

      {/* Step dots row */}
      <div className="flex items-center gap-2" role="list" aria-label="Wizard steps">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNumber = i + 1
          const isCompleted = stepNumber < currentStep
          const isCurrent = stepNumber === currentStep

          return (
            <React.Fragment key={stepNumber}>
              {/* Circle */}
              <div
                role="listitem"
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={
                  isCompleted
                    ? `Step ${stepNumber}: completed`
                    : isCurrent
                      ? `Step ${stepNumber}: current`
                      : `Step ${stepNumber}: upcoming`
                }
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  isCompleted
                    ? 'bg-slate-900 text-white'
                    : isCurrent
                      ? 'border-2 border-slate-900 bg-white text-slate-900'
                      : 'border-2 border-slate-200 bg-white text-slate-400',
                ].join(' ')}
              >
                {isCompleted ? (
                  /* Checkmark for completed steps */
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 4.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  stepNumber
                )}
              </div>

              {/* Connector line between steps */}
              {stepNumber < totalSteps && (
                <div
                  aria-hidden="true"
                  className={[
                    'h-0.5 w-8 transition-colors',
                    isCompleted ? 'bg-slate-900' : 'bg-slate-200',
                  ].join(' ')}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
