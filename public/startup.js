(() => {
  const bridge = window.termousStartupBridge
  const elements = Object.fromEntries([
    'status', 'description', 'details', 'details-label', 'details-text',
    'actions', 'copy', 'logs', 'exit', 'feedback',
  ].map((key) => [key, document.getElementById(`startup-${key}`)]))
  const translations = {
    zh: {
      core: '正在启动…', checking: '正在准备…', workspace: '正在准备工作区…',
      preparing: '正在准备…', ready: '准备就绪',
      domains: { core: '配置库', agent: 'AI 助手', workflows: '桌面脚本', audit: '审计' },
      unavailable: '暂不可用：', separator: '、',
      upgradeRunning: '正在升级数据库…', upgradeCompleted: '数据库升级完成',
      error: '启动失败', databaseError: '无法准备本地数据',
      failureAdvice: '请查看日志或复制诊断信息，确认原因后再试。',
      failures: {
        DB_VERSION_TOO_NEW: ['需要更新 Termous', '本地数据来自较新版本，请更新后再打开。'],
        DB_LEGACY_UNSUPPORTED: ['数据版本过旧', '请先使用兼容版本升级数据，再打开当前版本。'],
        DB_HISTORY_INVALID: ['无法验证本地数据', '数据库版本记录异常，请查看日志或复制诊断信息。'],
        DB_SCHEMA_INVALID: ['无法读取本地数据', '数据库结构异常，请查看日志或复制诊断信息。'],
        DB_OPEN_FAILED: ['无法读取本地数据', '请检查数据目录的访问权限和可用磁盘空间。'],
        CORE_BINARY_NOT_FOUND: ['安装文件不完整', '请重新安装 Termous 后再试。'],
        CORE_BIND_FAILED: ['启动失败', '启动端口被占用，请查看日志确认冲突。'],
        CORE_START_TIMEOUT: ['启动超时', '请重新打开 Termous；若仍失败，请查看日志。'],
        LOCAL_API_UNAVAILABLE: ['无法加载工作区', '请重新打开 Termous；若仍失败，请查看日志。'],
        WORKSPACE_START_FAILED: ['无法加载工作区', '请重新打开 Termous；若仍失败，请查看日志。'],
      },
      upgradeFailed: '数据库升级失败',
      slow: '启动时间较长，请稍候。可查看日志了解进度。',
      unresponsive: '暂时无法确认启动状态，可继续等待或查看日志。',
      details: '技术详情', copy: '复制诊断', logs: '打开日志', exit: '退出',
      copied: '诊断信息已复制', opened: '已打开日志目录', actionFailed: '操作失败，请重试。',
      statusFailed: '无法读取启动状态，请查看日志。',
      code: '错误代码', reason: '错误信息', current: '起始版本', target: '目标版本', confirmed: '最后确认版本',
      migration: '失败迁移', file: '迁移文件', role: '数据库角色', version: 'Core 版本', attempt: '启动标识',
    },
    en: {
      core: 'Starting…', checking: 'Preparing…', workspace: 'Preparing workspace…',
      preparing: 'Preparing…', ready: 'Ready',
      domains: { core: 'Configuration', agent: 'AI assistant', workflows: 'Desktop workflows', audit: 'Audit' },
      unavailable: 'Unavailable: ', separator: ', ',
      upgradeRunning: 'Upgrading database…', upgradeCompleted: 'Database upgrade complete',
      error: 'Unable to start', databaseError: 'Unable to prepare local data',
      failureAdvice: 'Check the logs or copy diagnostics to identify the cause before retrying.',
      failures: {
        DB_VERSION_TOO_NEW: ['Termous update required', 'This data requires a newer version of Termous. Update the app and try again.'],
        DB_LEGACY_UNSUPPORTED: ['Data version is too old', 'Upgrade the data with a compatible release before opening this version.'],
        DB_HISTORY_INVALID: ['Unable to verify local data', 'Database version records are invalid. Check the logs or copy diagnostics.'],
        DB_SCHEMA_INVALID: ['Unable to read local data', 'The database structure is invalid. Check the logs or copy diagnostics.'],
        DB_OPEN_FAILED: ['Unable to read local data', 'Check data folder permissions and available disk space.'],
        CORE_BINARY_NOT_FOUND: ['Installation files are missing', 'Reinstall Termous and try again.'],
        CORE_BIND_FAILED: ['Unable to start', 'The startup port is in use. Check the logs to identify the conflict.'],
        CORE_START_TIMEOUT: ['Startup timed out', 'Reopen Termous. If it still fails, check the logs.'],
        LOCAL_API_UNAVAILABLE: ['Unable to load workspace', 'Reopen Termous. If it still fails, check the logs.'],
        WORKSPACE_START_FAILED: ['Unable to load workspace', 'Reopen Termous. If it still fails, check the logs.'],
      },
      upgradeFailed: 'Database upgrade failed',
      slow: 'Startup is taking longer than usual. Please wait or check the logs.',
      unresponsive: 'Startup status is unavailable. Keep waiting or check the logs.',
      details: 'Technical details', copy: 'Copy diagnostics', logs: 'Open logs', exit: 'Exit',
      copied: 'Diagnostics copied', opened: 'Log directory opened', actionFailed: 'The action failed. Please try again.',
      statusFailed: 'Unable to read startup status. Please check the logs.',
      code: 'Error code', reason: 'Error message', current: 'Starting version', target: 'Target version', confirmed: 'Last confirmed version',
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
      rows.push([text.code, failure.code], [text.reason, failure.message], [text.current, failure.fromVersion],
        [text.target, failure.targetVersion], [text.confirmed, failure.confirmedVersion],
        [text.migration, failure.migrationVersion], [text.file, failure.migrationFile],
        [text.role, failure.databaseRole])
    }
    for (const database of view.databases || []) {
      rows.push([`${text.domains[database.domain] || database.domain} / ${database.role} / ${database.id}`,
        `${database.status}; ${database.fromVersion ?? '?'} → ${database.targetVersion ?? '?'}; ${text.confirmed}: ${database.confirmedVersion ?? '?'}${database.code ? `; ${database.code}` : ''}`])
    }
    const fields = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => `${label}: ${value}`)
    if (failure?.details && failure.details !== failure.message) fields.push('', failure.details)
    return fields.join('\n')
  }

  function isDatabaseUpgrade(database) {
    // prepare 也用于每次启动的检查；只有已知版本上升才把它展示为升级。
    return Boolean(database
      && (database.operation === 'upgrade' || database.operation === 'adopt'
        || (database.operation === 'prepare' && database.fromVersion > 0 && database.targetVersion > database.fromVersion)))
  }

  function hasDatabaseUpgrade(view) {
    return !initializingStorage(view) && [view.database, ...(view.databases || [])].some(isDatabaseUpgrade)
  }

  function initializingStorage(view) {
    // 当前源库首次创建时也会执行版本脚本；恢复过程中新建的回滚库不能代表当前数据。
    return [view.database, ...(view.databases || [])].some((database) => database?.domain === 'core'
      && database.role === 'source' && database.operation === 'initialize')
  }

  function failureCopy(view, text) {
    const code = view.failure?.code || ''
    if (Object.hasOwn(text.failures, code)) return text.failures[code]
    // 失败归因使用该错误的版本或当前操作，不能借用其他库已完成的升级。
    const database = [view.database, ...(view.databases || [])].find((candidate) => candidate
      && (candidate.status === 'failed' || candidate.status === 'running')
      && (!candidate.code || candidate.code === code)
      && ['fromVersion', 'targetVersion'].every((field) => view.failure?.[field] === undefined || candidate[field] === view.failure[field])
      && (!view.failure?.databaseRole || candidate.role === view.failure.databaseRole))
    const upgrading = !initializingStorage(view) && (isDatabaseUpgrade(database)
      || (view.failure?.fromVersion > 0 && view.failure.targetVersion > view.failure.fromVersion))
    const title = code === 'DB_MIGRATION_FAILED' && upgrading ? text.upgradeFailed
      : code.startsWith('DB_') ? text.databaseError : text.error
    return [title, text.failureAdvice]
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
    const upgrading = hasDatabaseUpgrade(view)
    const failure = failed ? failureCopy(view, text) : null
    const unavailable = [...new Set((view.databases || []).filter((database) => database.status === 'failed').map((database) => text.domains[database.domain] || database.domain))]
    const completedUpgrade = upgrading && !unavailable.length
    const preparingWorkspace = view.phase === 'database-completed' && !completedUpgrade
    const ready = view.ready && (preparingWorkspace || view.phase === 'workspace')
    document.body.dataset.phase = ready ? 'ready' : preparingWorkspace ? 'workspace' : view.phase
    document.body.dataset.attention = String(Boolean(view.attention) || unavailable.length > 0)
    elements.status.textContent = view.phase === 'database-running' ? (upgrading ? text.upgradeRunning : text.preparing)
      : ready ? text.ready
        : view.phase === 'database-completed' ? (completedUpgrade ? text.upgradeCompleted : text.workspace)
        : failure ? failure[0]
          : (text[view.phase] || text.core)
    let description = view.attention ? text[view.attention] : ''
    if (!failed && unavailable.length) description = [description, text.unavailable + unavailable.join(text.separator)].filter(Boolean).join('\n')
    // 面向用户只展示一次原因和建议；原始消息与版本信息完整保留在技术详情中。
    if (failure) description = failure[1]
    elements.description.hidden = !description
    elements.description.textContent = description
    elements.actions.hidden = !failed && !view.attention && !unavailable.length
    elements.details.hidden = !failed && !unavailable.length
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
