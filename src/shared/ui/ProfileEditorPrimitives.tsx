import { useId, type ReactNode } from 'react'

interface ProfileEditorPrimitiveClassNames {
  readonly [className: string]: string
}

export interface ProfileEditorFieldControlProps {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

export function ProfileEditorField({
  classNames,
  className,
  label,
  error,
  children,
}: {
  classNames: ProfileEditorPrimitiveClassNames
  className?: string
  label: string
  error?: string
  children: (controlProps: ProfileEditorFieldControlProps) => ReactNode
}) {
  const controlId = useId()
  const feedbackId = useId()
  const controlProps: ProfileEditorFieldControlProps = {
    id: controlId,
    ...(error ? { 'aria-invalid': true, 'aria-describedby': feedbackId } : {}),
  }
  return (
    <div
      className={[classNames.field, className].filter(Boolean).join(' ')}
      data-invalid={error ? 'true' : 'false'}
    >
      <label htmlFor={controlId}>{label}</label>
      {children(controlProps)}
      <ProfileEditorFieldFeedback
        classNames={classNames}
        id={feedbackId}
        message={error}
      />
    </div>
  )
}

export function ProfileEditorFieldFeedback({
  classNames,
  id,
  message,
}: {
  classNames: ProfileEditorPrimitiveClassNames
  id?: string
  message?: string
}) {
  return (
    <small
      id={id}
      className={`${classNames.feedback} ${message ? classNames.error : ''}`}
      role={message ? 'alert' : undefined}
      aria-hidden={message ? undefined : 'true'}
    >
      {message || '\u00a0'}
    </small>
  )
}

export function ProfileEditorSectionHeading({
  classNames,
  id,
  icon,
  title,
  hint,
  action,
}: {
  classNames: ProfileEditorPrimitiveClassNames
  id: string
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <header className={classNames['section-heading']}>
      <span className={classNames['section-icon']} aria-hidden="true">{icon}</span>
      <div className={classNames['section-copy']}>
        <h3 id={id}>{title}</h3>
        {hint ? <small>{hint}</small> : null}
      </div>
      {action}
    </header>
  )
}
