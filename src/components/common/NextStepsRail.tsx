import type { ReactNode } from 'react'

export interface NextStepItem {
  title: string
  description: string
  icon: ReactNode
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
}

interface NextStepsRailProps {
  label: string
  items: NextStepItem[]
}

export function NextStepsRail({ label, items }: NextStepsRailProps) {
  return (
    <ol className="next-steps-rail" aria-label={label}>
      {items.map((item, index) => (
        <li key={item.title} className={item.actionLabel ? 'actionable' : ''}>
          <span className="next-step-number" aria-hidden="true">
            {index + 1}
          </span>
          <span className="next-step-icon" aria-hidden="true">
            {item.icon}
          </span>
          <strong>{item.title}</strong>
          <p>{item.description}</p>
          {item.actionLabel && (
            <button
              type="button"
              className="primary-button"
              disabled={item.actionDisabled}
              onClick={item.onAction}
            >
              {item.actionLabel}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
