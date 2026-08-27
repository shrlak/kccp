import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from '../../../lib/i18n'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'

beforeAll(async () => { await i18n.init() })

describe('NewFamilyWeekChip', () => {
  it('labels the two 주일 cohorts', () => {
    const { container } = render(
      <>
        <NewFamilyWeekChip week="thisWeek" />
        <NewFamilyWeekChip week="lastWeek" />
      </>,
    )
    expect(screen.getByText('이번 주일 등록')).toBeInTheDocument()
    expect(screen.getByText('지난주 등록')).toBeInTheDocument()
    // The two are visually distinct, not just differently worded.
    const [fresh, prior] = [...container.querySelectorAll('span.rounded-full')]
    expect(fresh.className).not.toBe(prior.className)
  })

  it('renders a count when given one', () => {
    render(<NewFamilyWeekChip week="thisWeek" count={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders nothing for older registrations or a missing 등록일', () => {
    const { container } = render(
      <>
        <NewFamilyWeekChip week="earlier" />
        <NewFamilyWeekChip week={null} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
