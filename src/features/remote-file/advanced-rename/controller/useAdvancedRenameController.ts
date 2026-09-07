import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdvancedRenameExecutionResult,
  AdvancedRenameOrder,
  AdvancedRenamePreview,
  AdvancedRenameRule,
  AdvancedRenameVariableDefinition,
  FileRenamePreset,
} from '#entities/file'
import type { AdvancedRenameModalProps } from '../model/types'
import {
  advancedRenamePresetFingerprint,
  advancedRenameRuleDiagnostics,
  advancedRenameRuleLimit,
  type AdvancedRenameRuleChoice,
  advancedRenameVariableDefinitionErrors,
  buildAdvancedRenamePlanInput,
  cloneAdvancedRenameRules,
  createAdvancedRenameRule,
  defaultAdvancedRenameOrder,
  defaultAdvancedRenameRules,
  duplicateAdvancedRenameRule,
  fileRenamePresetInput,
  missingRequiredAdvancedRenameVariables,
  moveAdvancedRenameRule,
  presetFingerprint,
  resolveAdvancedRenameVariables,
} from '../model/advancedRenameModel'
import { useAdvancedRenameTaskWatcher } from './useAdvancedRenameTaskWatcher'

const previewDelayMs = 250

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useAdvancedRenameController({
  api,
  open,
  source,
  onCompleted,
  onDirectoryRefresh,
}: AdvancedRenameModalProps) {
  const [presets, setPresets] = useState<FileRenamePreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetSaving, setPresetSaving] = useState(false)
  const [presetError, setPresetError] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [rules, setRules] = useState<AdvancedRenameRule[]>(defaultAdvancedRenameRules)
  const [order, setOrder] = useState<AdvancedRenameOrder>(defaultAdvancedRenameOrder)
  const [variableDefinitions, setVariableDefinitions] = useState<AdvancedRenameVariableDefinition[]>([])
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set())
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<AdvancedRenamePreview | null>(null)
  const [previewInputKey, setPreviewInputKey] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [executionResult, setExecutionResult] = useState<AdvancedRenameExecutionResult | null>(null)
  const [executionError, setExecutionError] = useState('')
  const [executionSubmitting, setExecutionSubmitting] = useState(false)
  const previewSequenceRef = useRef(0)
  const previewControllerRef = useRef<AbortController | null>(null)
  const presetSequenceRef = useRef(0)
  const executionSequenceRef = useRef(0)
  const executionSubmittingRef = useRef(false)
  const draftBaselineFingerprintRef = useRef(advancedRenamePresetFingerprint({
    rules,
    order,
    variableDefinitions,
  }))
  const {
    task: executionTask,
    cancelling,
    watch: watchExecution,
    cancel: cancelExecution,
    reset: resetExecution,
  } = useAdvancedRenameTaskWatcher(api)

  useEffect(() => () => {
    executionSequenceRef.current += 1
  }, [])

  const resumePlanning = useCallback((executionSequence: number) => {
    if (executionSequenceRef.current !== executionSequence) {
      return
    }
    setPreview(null)
    setPreviewInputKey('')
    resetExecution()
  }, [resetExecution])

  const sourceIdentity = source
    ? `${source.fileSessionId}:${source.connectionGeneration}:${source.directory}:${source.entries.map((entry) => entry.path).join('\u0000')}`
    : ''

  const resetDraft = useCallback(() => {
    const nextRules = defaultAdvancedRenameRules()
    draftBaselineFingerprintRef.current = advancedRenamePresetFingerprint({
      rules: nextRules,
      order: defaultAdvancedRenameOrder,
      variableDefinitions: [],
    })
    executionSequenceRef.current += 1
    executionSubmittingRef.current = false
    setExecutionSubmitting(false)
    setSelectedPresetId('')
    setRules(nextRules)
    setOrder(defaultAdvancedRenameOrder)
    setVariableDefinitions([])
    setVariables({})
    setExcludedPaths(new Set())
    setManualOverrides({})
    setPreview(null)
    setPreviewInputKey('')
    setPreviewError('')
    setExecutionResult(null)
    setExecutionError('')
    resetExecution()
  }, [resetExecution])

  useEffect(() => {
    if (!open) {
      previewControllerRef.current?.abort()
      return
    }
    resetDraft()
  }, [open, resetDraft, sourceIdentity])

  useEffect(() => {
    if (!open) {
      return
    }
    const sequence = ++presetSequenceRef.current
    setPresetsLoading(true)
    setPresetError('')
    void api.fileRenamePresets()
      .then((items) => {
        if (presetSequenceRef.current === sequence) {
          setPresets(items)
        }
      })
      .catch((error) => {
        if (presetSequenceRef.current === sequence) {
          setPresetError(errorMessage(error))
        }
      })
      .finally(() => {
        if (presetSequenceRef.current === sequence) {
          setPresetsLoading(false)
        }
      })
  }, [api, open])

  const resolvedVariables = useMemo(
    () => resolveAdvancedRenameVariables(variableDefinitions, variables),
    [variableDefinitions, variables],
  )
  const variableDefinitionErrors = useMemo(
    () => advancedRenameVariableDefinitionErrors(variableDefinitions),
    [variableDefinitions],
  )
  const variableDefinitionsValid = variableDefinitionErrors.every((error) => error === null)
  const missingRequiredVariables = useMemo(
    () => missingRequiredAdvancedRenameVariables(variableDefinitions, resolvedVariables),
    [resolvedVariables, variableDefinitions],
  )
  const planInput = useMemo(() => source ? buildAdvancedRenamePlanInput({
    connectionGeneration: source.connectionGeneration,
    directory: source.directory,
    sourcePaths: source.entries.map((entry) => entry.path),
    excludedPaths,
    rules,
    variables: resolvedVariables,
    order,
    manualOverrides,
  }) : null, [excludedPaths, manualOverrides, order, resolvedVariables, rules, source])
  const planInputKey = useMemo(() => planInput ? JSON.stringify(planInput) : '', [planInput])

  useEffect(() => {
    previewControllerRef.current?.abort()
    if (
      !open
      || !source
      || !planInput
      || executionTask
      || executionSubmitting
      || executionResult
    ) {
      return
    }
    if (!variableDefinitionsValid) {
      previewSequenceRef.current += 1
      setPreview(null)
      setPreviewInputKey('')
      setPreviewLoading(false)
      setPreviewError('')
      return
    }
    const sequence = ++previewSequenceRef.current
    setPreviewLoading(true)
    setPreviewError('')
    const timer = window.setTimeout(() => {
      const controller = new AbortController()
      previewControllerRef.current = controller
      void api.previewFileSessionBatchRename(source.fileSessionId, planInput, controller.signal)
        .then((result) => {
          if (previewSequenceRef.current === sequence && !controller.signal.aborted) {
            setPreview(result)
            setPreviewInputKey(planInputKey)
          }
        })
        .catch((error) => {
          if (previewSequenceRef.current === sequence && !controller.signal.aborted) {
            setPreview(null)
            setPreviewInputKey('')
            setPreviewError(errorMessage(error))
          }
        })
        .finally(() => {
          if (previewSequenceRef.current === sequence && !controller.signal.aborted) {
            setPreviewLoading(false)
          }
        })
    }, previewDelayMs)
    return () => {
      window.clearTimeout(timer)
      previewControllerRef.current?.abort()
    }
  }, [
    api,
    executionResult,
    executionSubmitting,
    executionTask,
    open,
    planInput,
    planInputKey,
    source,
    variableDefinitionsValid,
  ])

  const applyPreset = useCallback((preset: FileRenamePreset | null) => {
    if (!preset) {
      resetDraft()
      return
    }
    setSelectedPresetId(preset.id)
    setRules(cloneAdvancedRenameRules(preset.rules))
    setOrder({ ...preset.order })
    setVariableDefinitions(preset.variable_definitions.map((definition) => ({ ...definition })))
    setVariables({})
    setExcludedPaths(new Set())
    setManualOverrides({})
  }, [resetDraft])

  const draftFingerprint = advancedRenamePresetFingerprint({ rules, order, variableDefinitions })
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null
  const presetDirty = draftFingerprint !== (selectedPreset
    ? presetFingerprint(selectedPreset)
    : draftBaselineFingerprintRef.current)
  const draftDirty = presetDirty
    || Object.keys(variables).length > 0
    || excludedPaths.size > 0
    || Object.keys(manualOverrides).length > 0

  const addRule = useCallback((kind: AdvancedRenameRuleChoice) => {
    setRules((current) => current.length >= advancedRenameRuleLimit
      ? current
      : [...current, createAdvancedRenameRule(kind)])
  }, [])
  const updateRule = useCallback((next: AdvancedRenameRule) => {
    setRules((current) => current.map((rule) => rule.id === next.id ? next : rule))
  }, [])
  const removeRule = useCallback((ruleId: string) => {
    setRules((current) => current.filter((rule) => rule.id !== ruleId))
  }, [])
  const duplicateRule = useCallback((ruleId: string) => {
    setRules((current) => {
      if (current.length >= advancedRenameRuleLimit) {
        return current
      }
      const index = current.findIndex((rule) => rule.id === ruleId)
      if (index < 0) return current
      const next = [...current]
      next.splice(index + 1, 0, duplicateAdvancedRenameRule(current[index]))
      return next
    })
  }, [])
  const moveRule = useCallback((ruleId: string, targetIndex: number) => {
    setRules((current) => moveAdvancedRenameRule(current, ruleId, targetIndex))
  }, [])

  const toggleExcluded = useCallback((path: string) => {
    setExcludedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  const setManualOverride = useCallback((path: string, value: string) => {
    setManualOverrides((current) => ({ ...current, [path]: value }))
  }, [])
  const clearManualOverride = useCallback((path: string) => {
    setManualOverrides((current) => {
      const next = { ...current }
      delete next[path]
      return next
    })
  }, [])

  const continueEditing = useCallback(() => {
    setExecutionResult(null)
    setExecutionError('')
    setPreview(null)
    setPreviewInputKey('')
    resetExecution()
  }, [resetExecution])

  const savePreset = useCallback(async (name: string, description: string) => {
    if (!variableDefinitionsValid) return null
    setPresetSaving(true)
    setPresetError('')
    try {
      const saved = await api.createFileRenamePreset(fileRenamePresetInput({
        name,
        description,
        rules,
        order,
        variableDefinitions,
      }))
      setPresets((current) => [...current.filter((item) => item.id !== saved.id), saved])
      setSelectedPresetId(saved.id)
      return saved
    } catch (error) {
      setPresetError(errorMessage(error))
      throw error
    } finally {
      setPresetSaving(false)
    }
  }, [api, order, rules, variableDefinitions, variableDefinitionsValid])

  const updatePreset = useCallback(async () => {
    if (!selectedPreset || !variableDefinitionsValid) return null
    setPresetSaving(true)
    setPresetError('')
    try {
      const saved = await api.updateFileRenamePreset(selectedPreset.id, selectedPreset.updated_at, fileRenamePresetInput({
        name: selectedPreset.name,
        description: selectedPreset.description,
        rules,
        order,
        variableDefinitions,
      }))
      setPresets((current) => current.map((item) => item.id === saved.id ? saved : item))
      return saved
    } catch (error) {
      setPresetError(errorMessage(error))
      throw error
    } finally {
      setPresetSaving(false)
    }
  }, [api, order, rules, selectedPreset, variableDefinitions, variableDefinitionsValid])

  const deletePreset = useCallback(async () => {
    if (!selectedPreset) return
    setPresetSaving(true)
    setPresetError('')
    try {
      await api.deleteFileRenamePreset(selectedPreset.id, selectedPreset.updated_at)
      setPresets((current) => current.filter((item) => item.id !== selectedPreset.id))
      resetDraft()
    } catch (error) {
      setPresetError(errorMessage(error))
      throw error
    } finally {
      setPresetSaving(false)
    }
  }, [api, resetDraft, selectedPreset])

  const execute = useCallback(async () => {
    if (
      executionSubmittingRef.current
      || executionTask
      || !source
      || !planInput
      || !preview
      || previewInputKey !== planInputKey
      || preview.summary.blocked > 0
      || !variableDefinitionsValid
    ) {
      return false
    }
    const sequence = ++executionSequenceRef.current
    executionSubmittingRef.current = true
    setExecutionSubmitting(true)
    setExecutionError('')
    setExecutionResult(null)
    try {
      const initialTask = await api.createFileSessionBatchRename(source.fileSessionId, {
        ...planInput,
        expected_plan_hash: preview.plan_hash,
      })
      if (executionSequenceRef.current !== sequence) {
        void api.cancelFileOperation(initialTask.id).catch(() => undefined)
        return false
      }
      const terminalTask = await watchExecution(initialTask)
      if (!terminalTask || executionSequenceRef.current !== sequence) {
        return false
      }
      let result: AdvancedRenameExecutionResult
      try {
        result = await api.fileOperationResult<AdvancedRenameExecutionResult>(terminalTask.id)
      } catch (error) {
        if (executionSequenceRef.current !== sequence) {
          return false
        }
        const resultError = errorMessage(error)
        setExecutionError(resultError)
        try {
          await onDirectoryRefresh?.()
        } catch (refreshError) {
          if (executionSequenceRef.current === sequence) {
            setExecutionError(`${resultError}; ${errorMessage(refreshError)}`)
          }
        } finally {
          resumePlanning(sequence)
        }
        return false
      }
      if (executionSequenceRef.current !== sequence) {
        return false
      }
      setExecutionResult(result)
      if (terminalTask.status === 'completed' && !result.partial && !result.uncertain) {
        await onCompleted(result)
        return true
      }
      const terminalError = terminalTask.error_message || terminalTask.error_code || 'FILE_OPERATION_FAILED'
      setExecutionError(terminalError)
      try {
        await onDirectoryRefresh?.(result)
      } catch (refreshError) {
        if (executionSequenceRef.current === sequence) {
          setExecutionError(`${terminalError}; ${errorMessage(refreshError)}`)
        }
      } finally {
        resumePlanning(sequence)
      }
      return false
    } catch (error) {
      if (executionSequenceRef.current === sequence) {
        setExecutionError(errorMessage(error))
      }
      return false
    } finally {
      if (executionSequenceRef.current === sequence) {
        executionSubmittingRef.current = false
        setExecutionSubmitting(false)
      }
    }
  }, [api, executionTask, onCompleted, onDirectoryRefresh, planInput, planInputKey, preview, previewInputKey, resumePlanning, source, variableDefinitionsValid, watchExecution])

  const canExecute = Boolean(
    preview
    && !executionResult
    && previewInputKey === planInputKey
    && preview.summary.changed > 0
    && preview.summary.blocked === 0
    && !previewLoading
    && !executionSubmitting
    && !executionTask
    && variableDefinitionsValid
    && missingRequiredVariables.length === 0
  )
  const ruleDiagnostics = useMemo(
    () => advancedRenameRuleDiagnostics(preview),
    [preview],
  )

  return {
    presets,
    presetsLoading,
    presetSaving,
    presetError,
    selectedPreset,
    selectedPresetId,
    presetDirty,
    draftDirty,
    applyPreset,
    savePreset,
    updatePreset,
    deletePreset,
    rules,
    addRule,
    updateRule,
    removeRule,
    duplicateRule,
    moveRule,
    order,
    setOrder,
    variableDefinitions,
    variableDefinitionErrors,
    variableDefinitionsValid,
    setVariableDefinitions,
    variables,
    missingRequiredVariables,
    setVariables,
    excludedPaths,
    toggleExcluded,
    manualOverrides,
    setManualOverride,
    clearManualOverride,
    preview,
    ruleDiagnostics,
    previewLoading,
    previewError,
    executionTask,
    executionResult,
    executionError,
    executionSubmitting,
    cancelling,
    cancelExecution,
    continueEditing,
    canExecute,
    execute,
  }
}
