export function prepareDevelopmentShell(): Promise<string>
export function shellExecutable(directory: string, platform?: NodeJS.Platform, arch?: string): string
export function shellFingerprint(root: string, version: string, platform: string, arch: string): Promise<string>
