import { useTranslation } from 'react-i18next'
import type { FileSession } from '#entities/file'
import type { FileGateway } from '#features/files'
import { FileDeleteOperationModal } from '#features/remote-file'

export interface WorkbenchFileDeleteTarget {
  fileSessionId: string
  connectionGeneration: number
  path: string
}

interface Props {
  api: FileGateway
  target: WorkbenchFileDeleteTarget
  currentSession: FileSession | null
  disabled: boolean
  onClose: () => void
  onRefresh: () => void
}

export function WorkbenchFileDeleteModal({ api, target, currentSession, disabled, onClose, onRefresh }: Props) {
  const { t } = useTranslation()
  const sessionCurrent = !disabled
    && currentSession?.status === 'connected'
    && currentSession.id === target.fileSessionId
    && currentSession.connection_generation === target.connectionGeneration

  return <FileDeleteOperationModal
    api={api}
    count={1}
    onClose={onClose}
    onStart={async () => {
      if (!sessionCurrent) throw new Error(t('files.connectionRequired'))
      return api.createFileSessionDeleteOperation(target.fileSessionId, target.connectionGeneration, [target.path])
    }}
    onFinished={(task) => {
      // 失败或取消也可能已删除部分条目，但不能刷新重连后或切换后的会话。
      if (sessionCurrent && task.file_session_id === target.fileSessionId) onRefresh()
    }}
  />
}
