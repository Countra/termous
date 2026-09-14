import { FileUp } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import styles from './CredentialManagement.module.scss'

interface PrivateKeyDropTargetProps {
  children: ReactNode
  disabled: boolean
  activeLabel: string
  onFiles: (files: File[]) => void
}

export function PrivateKeyDropTarget({
  children,
  disabled,
  activeLabel,
  onFiles,
}: PrivateKeyDropTargetProps) {
  const [active, setActive] = useState(false)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    if (disabled) {
      dragDepthRef.current = 0
      setActive(false)
    }
  }, [disabled])

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (disabled) {
      return
    }
    dragDepthRef.current += 1
    setActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current <= 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current -= 1
    if (dragDepthRef.current === 0) {
      setActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setActive(false)
    if (!disabled) {
      onFiles(Array.from(event.dataTransfer.files))
    }
  }

  return (
    <div
      className={[
        styles['credential-key-drop-target'],
        active ? styles['is-active'] : '',
      ].filter(Boolean).join(' ')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {active ? (
        <div className={styles['credential-key-drop-overlay']} role="status">
          <FileUp size={18} aria-hidden="true" />
          <strong>{activeLabel}</strong>
        </div>
      ) : null}
    </div>
  )
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('Files') || dataTransfer.files.length > 0
}
