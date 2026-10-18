const toolNamePrefix = 'm_'

export function encodeMCPToolName(value: string) {
  let encoded = toolNamePrefix
  for (const character of value) {
    if (character === '_') {
      encoded += '_u'
    } else if (character === '.') {
      encoded += '_d'
    } else {
      encoded += character
    }
  }
  return encoded
}

export function decodeMCPToolName(value: string) {
  if (!value.startsWith(toolNamePrefix)) {
    return null
  }
  let decoded = ''
  for (let index = toolNamePrefix.length; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '_') {
      decoded += character
      continue
    }
    const escape = value[index + 1]
    if (escape === 'u') {
      decoded += '_'
    } else if (escape === 'd') {
      decoded += '.'
    } else {
      return null
    }
    index += 1
  }
  return decoded || null
}

