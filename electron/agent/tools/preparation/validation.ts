import type { TLocalizedValidationError } from 'typebox/error'
import { fail } from './contracts.ts'

interface ArgumentValidator {
  Check(value: unknown): boolean
  Errors(value: unknown): TLocalizedValidationError[]
}

export function validateArguments(validator: ArgumentValidator, value: unknown, message: string) {
  if (validator.Check(value)) return
  // 只返回有界字段位置与校验类别，不复制错误中的参数值、命令或正文。
  const parameterErrors: { path: string; rule: string }[] = []
  for (const error of validator.Errors(value)) {
    const paths = error.keyword === 'required'
      ? error.params.requiredProperties.slice(0, 8).map((field) => `${error.instancePath}/${field.replace(/~/gu, '~0').replace(/\//gu, '~1')}`)
      : [error.instancePath || '/']
    for (const path of paths) {
      parameterErrors.push({ path: path.slice(0, 512), rule: error.keyword })
      if (parameterErrors.length === 8) break
    }
    if (parameterErrors.length === 8) break
  }
  fail('AGENT_PARAMETER_INVALID', message, 'correct_parameters', { parameter_errors: parameterErrors })
}
