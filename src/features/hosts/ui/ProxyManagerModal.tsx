import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tooltip,
} from 'antd'
import {
  CirclePlus,
  Network,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  connectionProxyTypeLabelKey,
  createBlankConnectionProxyInput,
  normalizeConnectionProxyInput,
  validateConnectionProxyInput,
  type ConnectionProxy,
  type ConnectionProxyInput,
  type ConnectionProxyType,
} from '#entities/connection-proxy'
import { customSelectStyles, uiStyles } from '#shared/ui'
import hostManagementStyles from './HostManagement.module.scss'
import styles from './ProxyManagerModal.module.scss'

interface ProxyManagerModalProps {
  open: boolean
  proxies: ConnectionProxy[]
  actionBusy: boolean
  onClose: () => void
  onCreate: (input: ConnectionProxyInput) => Promise<ConnectionProxy | undefined>
  onUpdate: (
    id: string,
    input: ConnectionProxyInput,
  ) => Promise<ConnectionProxy | undefined>
  onDelete: (id: string) => Promise<boolean | undefined>
}

export function ProxyManagerModal({
  open,
  proxies,
  actionBusy,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: ProxyManagerModalProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ConnectionProxyInput>(
    createBlankConnectionProxyInput,
  )
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const operationRef = useRef(false)
  const editingProxy = proxies.find((proxy) => proxy.id === editingId)
  const filteredProxies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) {
      return proxies
    }
    return proxies.filter((proxy) => (
      proxy.name.toLocaleLowerCase().includes(normalizedQuery)
      || proxy.url.toLocaleLowerCase().includes(normalizedQuery)
      || t(connectionProxyTypeLabelKey(proxy.type)).toLocaleLowerCase().includes(normalizedQuery)
    ))
  }, [proxies, query, t])
  const errors = useMemo(
    () => validateConnectionProxyInput(draft, proxies, editingId ?? ''),
    [draft, editingId, proxies],
  )
  const hasErrors = Boolean(errors.name || errors.url)
  const busy = actionBusy || saving || deleting

  useEffect(() => {
    if (!open) {
      setQuery('')
      setEditingId(null)
      setDraft(createBlankConnectionProxyInput())
      setSubmitted(false)
      setSaving(false)
      setDeleting(false)
      operationRef.current = false
    }
  }, [open])

  useEffect(() => {
    if (!editingId || editingProxy) {
      return
    }
    setEditingId(null)
    setDraft(createBlankConnectionProxyInput())
    setSubmitted(false)
  }, [editingId, editingProxy])

  const selectProxy = (proxy: ConnectionProxy) => {
    if (busy) {
      return
    }
    setEditingId(proxy.id)
    setDraft({
      name: proxy.name,
      type: proxy.type,
      url: proxy.url,
    })
    setSubmitted(false)
  }

  const startCreate = () => {
    if (busy) {
      return
    }
    setEditingId(null)
    setDraft(createBlankConnectionProxyInput())
    setSubmitted(false)
  }

  const changeType = (type: ConnectionProxyType) => {
    setDraft((current) => {
      const currentScheme = current.type === 'http_connect' ? 'http://' : 'socks5://'
      const nextScheme = type === 'http_connect' ? 'http://' : 'socks5://'
      return {
        ...current,
        type,
        url: current.url.startsWith(currentScheme)
          ? `${nextScheme}${current.url.slice(currentScheme.length)}`
          : current.url,
      }
    })
  }

  const save = async () => {
    setSubmitted(true)
    if (busy || hasErrors || operationRef.current) {
      return
    }
    operationRef.current = true
    setSaving(true)
    try {
      const normalized = normalizeConnectionProxyInput(draft)
      const saved = editingId
        ? await onUpdate(editingId, normalized)
        : await onCreate(normalized)
      if (!saved) {
        return
      }
      setEditingId(saved.id)
      setDraft({
        name: saved.name,
        type: saved.type,
        url: saved.url,
      })
      setSubmitted(false)
    } catch {
      return
    } finally {
      operationRef.current = false
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editingProxy || editingProxy.bound_host_count > 0 || busy || operationRef.current) {
      return
    }
    operationRef.current = true
    setDeleting(true)
    try {
      const deleted = await onDelete(editingProxy.id)
      if (!deleted) {
        return
      }
      setEditingId(null)
      setDraft(createBlankConnectionProxyInput())
      setSubmitted(false)
    } catch {
      return
    } finally {
      operationRef.current = false
      setDeleting(false)
    }
  }

  return (
    <Modal
      centered
      width={840}
      open={open}
      footer={null}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      title={(
        <span className={styles['proxy-manager-title']}>
          <Network size={18} aria-hidden="true" />
          <span>{t('proxies.manage')}</span>
          <small>{proxies.length}</small>
        </span>
      )}
      rootClassName={styles['proxy-manager-modal']}
      onCancel={() => {
        if (!busy) {
          onClose()
        }
      }}
    >
      <div className={styles['proxy-manager-layout']}>
        <aside className={styles['proxy-manager-sidebar']}>
          <div className={styles['proxy-manager-search']}>
            <Input
              id="proxy-manager-search"
              name="proxy-manager-search"
              value={query}
              allowClear
              prefix={<Search size={15} aria-hidden="true" />}
              placeholder={t('proxies.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Tooltip title={t('proxies.add')}>
              <Button
                type="primary"
                icon={<Plus size={16} />}
                aria-label={t('proxies.add')}
                disabled={busy}
                onClick={startCreate}
              />
            </Tooltip>
          </div>
          <div className={styles['proxy-manager-list']} role="listbox" aria-label={t('proxies.list')}>
            {filteredProxies.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query ? t('proxies.noSearchResults') : t('proxies.empty')}
              />
            ) : filteredProxies.map((proxy) => (
              <button
                key={proxy.id}
                type="button"
                role="option"
                aria-selected={editingId === proxy.id}
                className={[
                  styles['proxy-manager-row'],
                  editingId === proxy.id ? styles['is-active'] : '',
                ].filter(Boolean).join(' ')}
                disabled={busy}
                onClick={() => selectProxy(proxy)}
              >
                <span className={styles['proxy-manager-row-icon']}>
                  <Network size={16} aria-hidden="true" />
                </span>
                <span className={styles['proxy-manager-row-copy']}>
                  <Tooltip title={proxy.name} rootClassName={uiStyles.tooltip}>
                    <strong>{proxy.name}</strong>
                  </Tooltip>
                  <Tooltip title={proxy.url} rootClassName={uiStyles.tooltip}>
                    <small>{proxy.url}</small>
                  </Tooltip>
                </span>
                <span className={styles['proxy-manager-row-meta']}>
                  <em>{t(connectionProxyTypeLabelKey(proxy.type))}</em>
                  <small>{t('proxies.boundHostCount', { count: proxy.bound_host_count })}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles['proxy-manager-editor']}>
          <header className={styles['proxy-manager-editor-heading']}>
            <span>
              {editingProxy
                ? <Pencil size={17} aria-hidden="true" />
                : <CirclePlus size={18} aria-hidden="true" />}
            </span>
            <div>
              <h3>{editingProxy ? t('proxies.edit') : t('proxies.new')}</h3>
              <p>{editingProxy ? editingProxy.name : t('proxies.newHint')}</p>
            </div>
          </header>
          <div className={styles['proxy-manager-form']}>
            <label className={styles['proxy-manager-field']}>
              <span>{t('proxies.name')}</span>
              <Input
                id="connection-proxy-name"
                name="connection-proxy-name"
                value={draft.name}
                maxLength={64}
                autoFocus={!editingProxy}
                status={submitted && errors.name ? 'error' : undefined}
                placeholder={t('proxies.namePlaceholder')}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))}
              />
              {submitted && errors.name ? (
                <small className={styles['proxy-manager-field-error']}>
                  {t(`proxies.validation.${errors.name}`)}
                </small>
              ) : null}
            </label>
            <label className={styles['proxy-manager-field']}>
              <span>{t('proxies.type')}</span>
              <Select
                id="connection-proxy-type"
                value={draft.type}
                className={customSelectStyles.select}
                classNames={{
                  popup: {
                    root: `${customSelectStyles['select-popup']} ${styles['proxy-manager-select-popup']}`,
                  },
                }}
                disabled={busy}
                options={[
                  {
                    value: 'http_connect',
                    label: t('proxies.types.httpConnect'),
                  },
                  {
                    value: 'socks5',
                    label: t('proxies.types.socks5'),
                  },
                ]}
                onChange={(value) => changeType(value as ConnectionProxyType)}
              />
            </label>
            <label className={styles['proxy-manager-field']}>
              <span>{t('proxies.url')}</span>
              <Input
                id="connection-proxy-url"
                name="connection-proxy-url"
                value={draft.url}
                maxLength={2048}
                status={submitted && errors.url ? 'error' : undefined}
                placeholder={draft.type === 'http_connect' ? 'http://127.0.0.1:8080' : 'socks5://127.0.0.1:1080'}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  url: event.target.value,
                }))}
                onPressEnter={() => void save()}
              />
              {submitted && errors.url ? (
                <small className={styles['proxy-manager-field-error']}>
                  {t(`proxies.validation.${errors.url}`)}
                </small>
              ) : (
                <small>{t('proxies.urlHint')}</small>
              )}
            </label>
          </div>
          <footer className={styles['proxy-manager-editor-footer']}>
            {editingProxy ? (
              <Tooltip
                title={editingProxy.bound_host_count > 0
                  ? t('proxies.deleteBlocked', { count: editingProxy.bound_host_count })
                  : t('proxies.delete')}
              >
                <span>
                  <Popconfirm
                    title={t('proxies.deleteTitle')}
                    description={t('proxies.deleteDescription')}
                    okText={t('app.delete')}
                    cancelText={t('app.cancel')}
                    okButtonProps={{ danger: true }}
                    disabled={editingProxy.bound_host_count > 0 || busy}
                    rootClassName={`host-popconfirm ${hostManagementStyles.popconfirm}`}
                    onConfirm={() => void remove()}
                  >
                    <Button
                      danger
                      icon={<Trash2 size={15} />}
                      disabled={editingProxy.bound_host_count > 0 || busy}
                      loading={deleting}
                    >
                      {t('app.delete')}
                    </Button>
                  </Popconfirm>
                </span>
              </Tooltip>
            ) : <span />}
            <Button type="primary" loading={saving} disabled={busy} onClick={() => void save()}>
              {editingProxy ? t('app.save') : t('app.create')}
            </Button>
          </footer>
        </section>
      </div>
    </Modal>
  )
}
