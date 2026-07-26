import assert from 'node:assert/strict'
import test from 'node:test'
import type { TransferTask } from '../types/domain.ts'
import {
  formatSeconds,
  transferDisplayName,
} from '../features/files/fileUtils.ts'

function transfer(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    id: 'transfer-1',
    host_id: 'host-1',
    type: 'upload_file',
    status: 'running',
    source_paths: ['local.txt'],
    target_path: '/tmp',
    total_bytes: 100,
    transferred_bytes: 20,
    remaining_bytes: 80,
    total_files: 1,
    completed_files: 0,
    progress_percent: 20,
    speed_bytes_per_sec: 10,
    average_speed_bytes_per_sec: 8,
    elapsed_seconds: 2,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-07-23T00:00:00Z',
    ...overrides,
  }
}

test('传输时间按秒、分和小时进位格式化', () => {
  assert.equal(formatSeconds(0.2), '1s')
  assert.equal(formatSeconds(59.2), '1m 0s')
  assert.equal(formatSeconds(146 * 60 + 44), '2h 26m 44s')
  assert.equal(formatSeconds(3599.2), '1h 0m 0s')
})

test('传输时间对缺失和无效值返回占位符', () => {
  assert.equal(formatSeconds(), '-')
  assert.equal(formatSeconds(0), '-')
  assert.equal(formatSeconds(-1), '-')
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), '-')
  assert.equal(formatSeconds(Number.NaN), '-')
})

test('上传传输使用本地源名称且不按远端路径解析', () => {
  assert.equal(transferDisplayName(transfer()), 'local.txt')
  assert.equal(transferDisplayName(transfer({
    source_paths: ['C:\\Users\\demo\\local.txt'],
  })), 'C:\\Users\\demo\\local.txt')
  assert.equal(transferDisplayName(transfer({
    current_file: 'active.txt',
  })), 'active.txt')
})

test('下载和远端传输安全提取远端文件名', () => {
  assert.equal(transferDisplayName(transfer({
    type: 'download_file',
    source_paths: ['/var/log/app.log'],
  })), 'app.log')
  assert.equal(transferDisplayName(transfer({
    type: 'remote_move',
    source_paths: ['/srv/releases/../current/app.zip'],
  })), 'app.zip')
})

test('异常传输路径返回占位符而不会中断渲染', () => {
  assert.equal(transferDisplayName(transfer({
    type: 'download_file',
    source_paths: ['relative.txt'],
    target_path: '',
  })), '-')
  assert.equal(transferDisplayName(transfer({
    source_paths: ['\u0000invalid'],
  })), '-')
})
