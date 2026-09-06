import { expect, it } from 'vitest'
import { formatHostCreationEndpoint } from './hostCreationProjection.ts'

it('草稿端点区分 IPv6 地址和端口，保留已有括号及未填写端口', () => {
  expect(formatHostCreationEndpoint('2001:db8::8', 22)).toBe('[2001:db8::8]:22')
  expect(formatHostCreationEndpoint('::1', 5900)).toBe('[::1]:5900')
  expect(formatHostCreationEndpoint('[2001:db8::8]', 22)).toBe('[2001:db8::8]:22')
  expect(formatHostCreationEndpoint('192.0.2.1', 22)).toBe('192.0.2.1:22')
  expect(formatHostCreationEndpoint('server.internal', 22)).toBe('server.internal:22')
  expect(formatHostCreationEndpoint('::1', null)).toBe('[::1]:')
})
