import { AlertTriangle, ArrowLeft, Command, Save } from 'lucide-react'
import { Button, Checkbox, Form, Input, Tooltip, type FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { uiStyles } from '#shared/ui'
import styles from './AliasPanel.module.scss'

export interface AliasEditorValues {
  name: string
  command: string
  description: string
  enabled: boolean
}

interface AliasEditorViewProps {
  form: FormInstance<AliasEditorValues>
  controlScope: string
  editing: boolean
  saving: boolean
  onSave: (values: AliasEditorValues) => void
  onCancel: () => void
}

export function AliasEditorView({
  form,
  controlScope,
  editing,
  saving,
  onSave,
  onCancel,
}: AliasEditorViewProps) {
  const { t } = useTranslation()
  const aliasName = Form.useWatch('name', form)
  const hasRiskyName = /^(rm|sudo|ssh|cd)$/i.test(aliasName?.trim() ?? '')
  return (
    <section className={[styles['alias-panel'], styles['alias-editor-page']].join(' ')}>
      <header className={styles['alias-editor-page-header']}>
        <Tooltip
          title={t('workbench.aliases.backToList')}
          classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
        >
          <Button
            type="text"
            className={styles['alias-icon-button']}
            aria-label={t('workbench.aliases.backToList')}
            disabled={saving}
            icon={<ArrowLeft size={15} />}
            onClick={onCancel}
          />
        </Tooltip>
        <span className={styles['alias-panel-heading-icon']}>
          <Command size={16} aria-hidden="true" />
        </span>
        <div>
          <strong>
            {t(editing
              ? 'workbench.aliases.editTitle'
              : 'workbench.aliases.createTitle')}
          </strong>
          <span>{t('workbench.aliases.editorHint')}</span>
        </div>
      </header>

      <div className={styles['alias-editor-page-body']}>
        <Form
          id={`${controlScope}-form`}
          form={form}
          name={`${controlScope}-form`}
          layout="vertical"
          requiredMark={false}
          className={styles['alias-editor-form']}
          scrollToFirstError={{ block: 'nearest', focus: true }}
          onFinish={onSave}
        >
          <Form.Item
            name="name"
            htmlFor={`${controlScope}-name`}
            label={t('workbench.aliases.name')}
            validateStatus={hasRiskyName ? 'warning' : undefined}
            extra={hasRiskyName ? (
              <span className={styles['alias-editor-risk-warning']}>
                <AlertTriangle size={13} aria-hidden="true" />
                {t('workbench.aliases.riskyNameWarning')}
              </span>
            ) : undefined}
            rules={[
              { required: true, whitespace: true, message: t('workbench.aliases.nameRequired') },
              { max: 64, message: t('workbench.aliases.nameTooLong') },
              {
                pattern: /^(?!-)(?!__termous_)[A-Za-z0-9_.-]+$/i,
                message: t('workbench.aliases.nameInvalid'),
              },
            ]}
          >
            <Input
              id={`${controlScope}-name`}
              name={`${controlScope}-name`}
              autoFocus
              autoComplete="off"
              placeholder={t('workbench.aliases.namePlaceholder')}
            />
          </Form.Item>
          <Form.Item
            name="command"
            htmlFor={`${controlScope}-command`}
            label={t('workbench.aliases.command')}
            rules={[
              { required: true, message: t('workbench.aliases.commandRequired') },
              {
                validator: async (_, value: string | undefined) => {
                  if (value && /[\0\r\n]/.test(value)) {
                    throw new Error(t('workbench.aliases.commandInvalid'))
                  }
                  if (value && new TextEncoder().encode(value).length > 4096) {
                    throw new Error(t('workbench.aliases.commandTooLong'))
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              id={`${controlScope}-command`}
              name={`${controlScope}-command`}
              autoSize={{ minRows: 3, maxRows: 7 }}
              spellCheck={false}
              placeholder={t('workbench.aliases.commandPlaceholder')}
            />
          </Form.Item>
          <Form.Item
            name="description"
            htmlFor={`${controlScope}-description`}
            label={t('workbench.aliases.description')}
            rules={[{
              validator: async (_, value: string | undefined) => {
                if (value && Array.from(value).length > 256) {
                  throw new Error(t('workbench.aliases.descriptionTooLong'))
                }
              },
            }]}
          >
            <Input
              id={`${controlScope}-description`}
              name={`${controlScope}-description`}
              placeholder={t('workbench.aliases.descriptionPlaceholder')}
            />
          </Form.Item>
          <div className={styles['alias-editor-options']}>
            <Form.Item name="enabled" valuePropName="checked" noStyle>
              <Checkbox
                id={`${controlScope}-enabled`}
                name={`${controlScope}-enabled`}
              >
                {t('workbench.aliases.enabled')}
              </Checkbox>
            </Form.Item>
          </div>
        </Form>
      </div>

      <footer className={styles['alias-editor-page-footer']}>
        <Button disabled={saving} onClick={onCancel}>
          {t('app.cancel')}
        </Button>
        <Button
          form={`${controlScope}-form`}
          htmlType="submit"
          type="primary"
          loading={saving}
          icon={<Save size={14} />}
        >
          {t(editing ? 'app.save' : 'app.create')}
        </Button>
      </footer>
    </section>
  )
}
