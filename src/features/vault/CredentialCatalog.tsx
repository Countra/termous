import { Button, Input, Tabs, Tooltip } from 'antd'
import { Link2, Plus, Search, ShieldCheck, Wand2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ManagementPanel } from '../../components/management/ManagementWorkspace'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import type { CredentialType, CredentialView } from '../../types/domain'
import { credentialTypeIcon } from './credentialIcons'
import { filterCredentials, type CredentialCatalogFilter } from './credentialManagementUtils'

interface CredentialCatalogProps {
  credentials: CredentialView[]
  selectedCredentialId: string | null
  actionBusy: boolean
  onSelect: (credentialId: string) => void
  onCreate: () => void
  onGenerateKey: () => void
}

export function CredentialCatalog({
  credentials,
  selectedCredentialId,
  actionBusy,
  onSelect,
  onCreate,
  onGenerateKey,
}: CredentialCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CredentialCatalogFilter>('all')
  const typeLabels = useMemo<Record<CredentialType, string>>(() => ({
    password: t('vault.typeName.password'),
    private_key: t('vault.typeName.private_key'),
    private_key_passphrase: t('vault.typeName.private_key_passphrase'),
  }), [t])
  const filtered = useMemo(
    () => filterCredentials(credentials, query, filter, typeLabels),
    [credentials, filter, query, typeLabels],
  )
  const hasFilters = Boolean(query.trim()) || filter !== 'all'

  return (
    <ManagementPanel
      className="credential-catalog"
      bodyClassName="credential-catalog-body"
      header={(
        <div className="credential-panel-heading">
          <span className="credential-panel-heading-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
          <div><h2>{t('vault.list')}</h2><span>{t('vault.credentialCount', { count: credentials.length })}</span></div>
        </div>
      )}
      footer={<span className="credential-catalog-result">{t('vault.filterResult', { count: filtered.length, total: credentials.length })}</span>}
    >
      <div className="credential-catalog-toolbar">
        <Input
          className="termous-search-input"
          value={query}
          allowClear
          variant="borderless"
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('vault.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Tabs
          className="credential-filter-tabs"
          activeKey={filter}
          animated={{ inkBar: true, tabPane: false }}
          items={[
            { key: 'all', label: t('vault.filterAll') },
            { key: 'password', label: t('vault.filterPasswords') },
            { key: 'private_key', label: t('vault.filterKeys') },
            { key: 'private_key_passphrase', label: t('vault.filterPassphrases') },
          ]}
          onChange={(value) => setFilter(value as CredentialCatalogFilter)}
        />
        <div className="credential-catalog-actions">
          <Button icon={<Wand2 size={15} />} disabled={actionBusy} onClick={onGenerateKey}>{t('vault.generateKey')}</Button>
          <ConnectionActionButton icon={<Plus size={16} />} disabled={actionBusy} onClick={onCreate}>{t('vault.addCredential')}</ConnectionActionButton>
        </div>
        {hasFilters ? (
          <Button type="text" size="small" className="credential-clear-filter" icon={<X size={13} />} onClick={() => { setQuery(''); setFilter('all') }}>
            {t('vault.clearFilters')}
          </Button>
        ) : null}
      </div>
      <div className="credential-catalog-list">
        {credentials.length === 0 ? <EmptyState title={t('vault.empty')} description={t('vault.emptyHint')} /> : null}
        {credentials.length > 0 && filtered.length === 0 ? <EmptyState title={t('vault.noFilterResults')} description={t('vault.noFilterResultsHint')} /> : null}
        {filtered.map((credential) => (
          <CredentialCatalogRow
            key={credential.id}
            credential={credential}
            active={credential.id === selectedCredentialId}
            typeLabel={typeLabels[credential.type]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </ManagementPanel>
  )
}

function CredentialCatalogRow({ credential, active, typeLabel, onSelect }: {
  credential: CredentialView
  active: boolean
  typeLabel: string
  onSelect: (credentialId: string) => void
}) {
  const { t } = useTranslation()
  const Icon = credentialTypeIcon(credential.type)
  const bindingLabel = credential.bound_host_count > 0
    ? t('vault.boundHostCount', { count: credential.bound_host_count })
    : t('vault.unbound')
  return (
    <button
      type="button"
      className={`credential-catalog-row ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(credential.id)}
    >
      <span className={`credential-type-icon is-${credential.type}`}><Icon size={17} aria-hidden="true" /></span>
      <span className="credential-catalog-row-copy">
        <Tooltip title={credential.name}><strong>{credential.name}</strong></Tooltip>
        <small>{typeLabel}</small>
      </span>
      <Tooltip title={bindingLabel}>
        <span className={`credential-binding ${credential.bound_host_count > 0 ? 'is-bound' : ''}`}>
          <Link2 size={12} aria-hidden="true" /><span>{credential.bound_host_count}</span>
        </span>
      </Tooltip>
    </button>
  )
}
