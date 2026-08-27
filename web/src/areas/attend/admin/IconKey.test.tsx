import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from '../../../lib/i18n'
import { IconKey } from './IconKey'

beforeAll(async () => { await i18n.init() })

describe('IconKey — status legend', () => {
  it('renders each translated status as a separate label', () => {
    render(<IconKey items={['newFamily', 'visitor']} />)
    expect(screen.getByText('새가족')).toBeInTheDocument()
    expect(screen.getByText('방문자')).toBeInTheDocument()
    expect(screen.getByLabelText('상태 안내')).toBeInTheDocument()
  })

  it('renders a single item with no separator', () => {
    const { container } = render(<IconKey items={['firstVisit']} />)
    expect(container.textContent).toBe('첫출석')
  })

  it('translates the 멤버 tab star legend in English too', async () => {
    await i18n.changeLanguage('en')
    const { container } = render(<IconKey items={['newMemberStar']} />)
    expect(container.textContent).toBe('New member')
    await i18n.changeLanguage('ko')
  })
})
