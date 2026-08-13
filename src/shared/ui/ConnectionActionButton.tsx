import { Button, type ButtonProps } from 'antd'
import { connectionActionButtonClassName } from './connectionActionButtonStyles'

type ConnectionActionButtonProps = Omit<ButtonProps, 'type'>

export function ConnectionActionButton({ className, ...props }: ConnectionActionButtonProps) {
  const classes = [connectionActionButtonClassName, 'connection-action-button', className].filter(Boolean).join(' ')
  return <Button {...props} type="primary" className={classes} />
}
