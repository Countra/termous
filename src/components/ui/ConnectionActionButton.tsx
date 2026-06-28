import { Button, type ButtonProps } from 'antd'

type ConnectionActionButtonProps = Omit<ButtonProps, 'type'>

export function ConnectionActionButton({ className, ...props }: ConnectionActionButtonProps) {
  const classes = ['connection-action-button', className].filter(Boolean).join(' ')
  return <Button {...props} type="primary" className={classes} />
}
