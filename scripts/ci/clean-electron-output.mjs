import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const electronOutputDirectoryName = 'dist-electron'
const scriptPath = fileURLToPath(import.meta.url)
const defaultWebDirectory = path.resolve(path.dirname(scriptPath), '..', '..')

export function requireElectronOutputPath(webDirectory, outputDirectory) {
  const resolvedWebDirectory = path.resolve(webDirectory)
  const resolvedOutputDirectory = path.resolve(outputDirectory)
  const relative = path.relative(
    resolvedWebDirectory,
    resolvedOutputDirectory,
  )

  if (relative !== electronOutputDirectoryName) {
    throw new Error(
      `Electron 构建输出目录必须是 Web 项目直属的 ${electronOutputDirectoryName}: ${resolvedOutputDirectory}`,
    )
  }
  return resolvedOutputDirectory
}

export async function cleanElectronOutput({
  webDirectory = defaultWebDirectory,
} = {}) {
  const resolvedWebDirectory = path.resolve(webDirectory)
  const outputDirectory = requireElectronOutputPath(
    resolvedWebDirectory,
    path.join(resolvedWebDirectory, electronOutputDirectoryName),
  )

  let outputInfo
  try {
    outputInfo = await lstat(outputDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return outputDirectory
    }
    throw new Error(`无法检查 Electron 构建输出目录: ${outputDirectory}`, {
      cause: error,
    })
  }
  if (outputInfo.isSymbolicLink()) {
    throw new Error(
      `Electron 构建输出目录不能是符号链接或目录联接: ${outputDirectory}`,
    )
  }

  await rm(outputDirectory, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 100,
  })
  return outputDirectory
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  cleanElectronOutput().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
