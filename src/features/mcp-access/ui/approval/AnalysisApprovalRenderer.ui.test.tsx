import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AnalysisApprovalRenderer } from './AnalysisApprovalRenderer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('删除审批展示确切分析 ID 和删除影响', () => {
  render(<AnalysisApprovalRenderer operation={{ domain: 'screen_analysis', action: 'delete', resource_id: 'analysis-1', remote_paths: [], local_paths: [], rename_mappings: [] }} />)
  expect(screen.getByText('analysis-1')).toBeVisible()
  expect(screen.getByText('settings.mcp.analysisDeleteTitle')).toBeVisible()
  expect(screen.getByText('settings.mcp.analysisDeleteDescription')).toBeVisible()
})
