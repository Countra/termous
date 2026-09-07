(() => {
  const bridge = window.termousStartupBridge
  const elements = Object.fromEntries([
    'status', 'description', 'details', 'details-label', 'details-text',
    'actions', 'copy', 'logs', 'exit', 'feedback',
  ].map((key) => [key, document.getElementById(`startup-${key}`)]))
  const translations = {
    zh: {
      core: '正在启动…', checking: '正在检查本地数据…', workspace: '正在准备工作区…',
      initializeRunning: '正在初始化数据库…', initializeCompleted: '数据库初始化完成',
      adoptRunning: '正在更新数据库…', adoptCompleted: '数据库更新完成',
      upgradeRunning: '正在升级数据库…', upgradeCompleted: '数据库升级完成',
      error: '应用启动未完成', databaseError: '数据库处理未完成',
      completedBeforeError: '数据库处理已完成，但应用启动失败。',
      slow: '处理时间较长，请继续等待。您也可以查看日志了解当前状态。',
      unresponsive: '暂时无法确认启动状态。您可以继续等待，或查看日志了解详情。',
      details: '技术详情', copy: '复制诊断', logs: '打开日志', exit: '退出',
      copied: '诊断信息已复制', opened: '已打开日志目录', actionFailed: '操作未完成，请重试。',
      statusFailed: '无法读取启动状态，请查看日志。',
      versionTooNew: '此数据库由较新版本创建，请更新 Termous 后再试。',
      legacyUnsupported: '此旧版本数据需要先使用兼容版本升级。',
      historyInvalid: '数据库版本记录不一致，已停止启动。',
      schemaInvalid: '数据库结构与当前版本要求不一致，已停止启动。',
      code: '错误代码', current: '起始版本', target: '目标版本', confirmed: '最后确认版本',
      migration: '失败迁移', file: '迁移文件', role: '数据库角色', version: 'Core 版本', attempt: '启动标识',
    },
    en: {
      core: 'Starting…', checking: 'Checking local data…', workspace: 'Preparing workspace…',
      initializeRunning: 'Initializing database…', initializeCompleted: 'Database initialized',
      adoptRunning: 'Updating database…', adoptCompleted: 'Database updated',
      upgradeRunning: 'Upgrading database…', upgradeCompleted: 'Database upgrade complete',
      error: 'Application startup did not complete', databaseError: 'Database setup did not complete',
      completedBeforeError: 'Database setup completed, but application startup failed.',
      slow: 'This is taking longer than usual. Please keep waiting, or check the logs for details.',
      unresponsive: 'Startup status cannot currently be confirmed. You can keep waiting or check the logs.',
      details: 'Technical details', copy: 'Copy diagnostics', logs: 'Open logs', exit: 'Exit',
      copied: 'Diagnostics copied', opened: 'Log directory opened', actionFailed: 'The action failed. Please try again.',
      statusFailed: 'Unable to read startup status. Please check the logs.',
      versionTooNew: 'This database requires a newer version. Update Termous and try again.',
      legacyUnsupported: 'Upgrade this older database using a compatible release first.',
      historyInvalid: 'Database version records do not match. Startup has stopped.',
      schemaInvalid: 'The database structure does not match this version. Startup has stopped.',
      code: 'Error code', current: 'Starting version', target: 'Target version', confirmed: 'Last confirmed version',
      migration: 'Failed migration', file: 'Migration file', role: 'Database role', version: 'Core version', attempt: 'Startup ID',
    },
  }
  const query = new URLSearchParams(window.location.search)
  let locale = query.get('locale') || navigator.language
  let state = null
  let acknowledgementFrame = null
  let acknowledgedPresentation = null
  const messages = () => translations[locale.toLowerCase().startsWith('zh') ? 'zh' : 'en']

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
  }

  function setFeedback(message) {
    elements.feedback.hidden = !message
    elements.feedback.textContent = message
  }

  function acknowledgeVisiblePhase() {
    if (!bridge || !state?.view.windowVisible || document.visibilityState !== 'visible') return
    const view = state.view
    const key = `${view.attemptId}:${view.presentationId}`
    if (key === acknowledgedPresentation || acknowledgementFrame !== null) return
    acknowledgementFrame = requestAnimationFrame(() => {
      acknowledgementFrame = requestAnimationFrame(() => {
        acknowledgementFrame = null
        if (!state?.view.windowVisible || document.visibilityState !== 'visible'
          || view.presentationId !== state.view.presentationId || view.attemptId !== state.view.attemptId) {
          acknowledgeVisiblePhase()
          return
        }
        acknowledgedPresentation = key
        bridge.presented({ attemptId: view.attemptId, presentationId: view.presentationId })
      })
    })
  }

  function diagnosticText(view, text) {
    const failure = view.failure
    const rows = [[text.attempt, view.attemptId], [text.version, view.coreVersion]]
    if (failure) {
      rows.push([text.code, failure.code], [text.current, failure.fromVersion],
        [text.target, failure.targetVersion], [text.confirmed, failure.confirmedVersion],
        [text.migration, failure.migrationVersion], [text.file, failure.migrationFile],
        [text.role, failure.databaseRole])
    }
    const fields = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => `${label}: ${value}`)
    if (failure?.details && failure.details !== failure.message) fields.push('', failure.details)
    return fields.join('\n')
  }

  function render(next) {
    if (!next?.view || (state && next.view.sequence < state.view.sequence)) return
    const previous = state
    state = next
    locale = next.locale || locale
    setTheme(next.theme)
    const text = messages()
    const view = next.view
    const failed = view.phase === 'error'
    document.documentElement.lang = locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
    document.body.dataset.phase = view.phase
    document.body.dataset.attention = String(Boolean(view.attention))
    const operation = view.database?.operation || 'upgrade'
    elements.status.textContent = view.phase === 'database-running' ? text[`${operation}Running`]
      : view.phase === 'database-completed' ? text[`${operation}Completed`]
        : failed ? (view.failure?.code.startsWith('DB_') ? text.databaseError : text.error)
          : (text[view.phase] || text.core)
    let description = view.attention ? text[view.attention] : ''
    if (failed) {
      const adviceKey = {
        DB_VERSION_TOO_NEW: 'versionTooNew', DB_LEGACY_UNSUPPORTED: 'legacyUnsupported',
        DB_HISTORY_INVALID: 'historyInvalid', DB_SCHEMA_INVALID: 'schemaInvalid',
      }[view.failure?.code]
      description = [view.database?.status === 'completed' ? text.completedBeforeError : '',
        adviceKey ? text[adviceKey] : '', view.failure?.message || ''].filter(Boolean).join('\n')
    }
    elements.description.hidden = !description
    elements.description.textContent = description
    elements.actions.hidden = !failed && !view.attention
    elements.details.hidden = !failed
    elements['details-label'].textContent = text.details
    elements['details-text'].textContent = diagnosticText(view, text)
    elements.copy.textContent = text.copy
    elements.logs.textContent = text.logs
    elements.exit.textContent = text.exit
    if (previous?.view.presentationId !== view.presentationId) {
      setFeedback('')
      if (failed) elements.copy.focus({ preventScroll: true })
    }
    acknowledgeVisiblePhase()
  }

  async function performAction(button, action, successMessage) {
    if (!bridge || button.disabled) return
    button.disabled = true
    setFeedback('')
    try {
      await action()
      if (successMessage) setFeedback(messages()[successMessage])
    } catch {
      setFeedback(messages().actionFailed)
    } finally {
      button.disabled = false
    }
  }

  elements.copy.addEventListener('click', () => {
    void performAction(elements.copy, () => bridge.copyDiagnostics(), 'copied')
  })
  elements.logs.addEventListener('click', () => {
    void performAction(elements.logs, () => bridge.openLogs(), 'opened')
  })
  elements.exit.addEventListener('click', () => {
    void performAction(elements.exit, () => bridge.exit())
  })
  document.addEventListener('visibilitychange', acknowledgeVisiblePhase)
  elements.status.textContent = messages().core
  document.documentElement.lang = locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'

  if (bridge) {
    const unsubscribe = bridge.onChanged(render)
    void bridge.status().then(render).catch(() => {
      // 后续推送仍可恢复状态，不让一次查询失败覆盖已经收到的有效事件。
      if (!state) {
        setFeedback(messages().statusFailed)
        elements.actions.hidden = false
      }
    })
    window.addEventListener('beforeunload', () => {
      unsubscribe()
      if (acknowledgementFrame !== null) cancelAnimationFrame(acknowledgementFrame)
    }, { once: true })
  }
})()
