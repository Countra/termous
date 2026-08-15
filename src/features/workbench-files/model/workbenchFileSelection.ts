export interface WorkbenchFileSelectionModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  contextMenu?: boolean
}

export interface WorkbenchFileSelectionResult {
  selectedPaths: string[]
  anchorPath: string | null
}

export function resolveWorkbenchFileSelection(
  orderedPaths: readonly string[],
  selectedPaths: readonly string[],
  anchorPath: string | null,
  targetPath: string,
  modifiers: WorkbenchFileSelectionModifiers = {},
): WorkbenchFileSelectionResult {
  const orderedPathSet = new Set(orderedPaths)
  const selectedPathSet = new Set(selectedPaths)
  if (!orderedPathSet.has(targetPath)) {
    return {
      selectedPaths: orderedPaths.filter((path) => selectedPathSet.has(path)),
      anchorPath: orderedPathSet.has(anchorPath ?? '') ? anchorPath : null,
    }
  }

  const currentSelection = orderedPaths.filter((path) => selectedPathSet.has(path))
  const currentSelectionSet = new Set(currentSelection)
  if (modifiers.contextMenu) {
    return currentSelectionSet.has(targetPath)
      ? { selectedPaths: currentSelection, anchorPath: validAnchor(orderedPathSet, anchorPath, targetPath) }
      : { selectedPaths: [targetPath], anchorPath: targetPath }
  }

  const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey)
  if (modifiers.shiftKey) {
    const anchor = validAnchor(
      orderedPathSet,
      anchorPath,
      currentSelection[0] ?? targetPath,
    )
    const start = orderedPaths.indexOf(anchor)
    const end = orderedPaths.indexOf(targetPath)
    const range = orderedPaths.slice(Math.min(start, end), Math.max(start, end) + 1)
    if (!additive) {
      return { selectedPaths: range, anchorPath: anchor }
    }
    const additiveSelection = new Set([...currentSelection, ...range])
    const nextSelection = orderedPaths.filter((path) => additiveSelection.has(path))
    return { selectedPaths: nextSelection, anchorPath: anchor }
  }

  if (additive) {
    const nextSelection = new Set(currentSelection)
    if (nextSelection.has(targetPath)) {
      nextSelection.delete(targetPath)
    } else {
      nextSelection.add(targetPath)
    }
    return {
      selectedPaths: orderedPaths.filter((path) => nextSelection.has(path)),
      anchorPath: targetPath,
    }
  }

  return { selectedPaths: [targetPath], anchorPath: targetPath }
}

function validAnchor(
  orderedPaths: ReadonlySet<string>,
  anchorPath: string | null,
  fallback: string,
) {
  return anchorPath && orderedPaths.has(anchorPath) ? anchorPath : fallback
}
