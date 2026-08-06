import { VaultWorkspace, type VaultWorkspaceProps } from '#features/vault'
import styles from './VaultPage.module.scss'

export type VaultPageProps = Omit<VaultWorkspaceProps, 'className'>

export function VaultPage(props: VaultPageProps) {
  return <VaultWorkspace {...props} className={styles.root} />
}
