import { describe, expect, it } from 'vitest'
import { translate } from '../src/client/i18n.tsx'

describe('workspace translations', () => {
  it('defaults to complete Chinese and English message formatting', () => {
    expect(translate('zh-CN', 'workspaceSettings')).toBe('工作区设置')
    expect(translate('zh-CN', 'savedSize', { size: '12 B' })).toBe('已保存 12 B')
    expect(translate('en', 'workspaceSettings')).toBe('Workspace settings')
    expect(translate('en', 'trashConfirm', { path: 'src/app.ts' })).toContain('src/app.ts')
  })
})
