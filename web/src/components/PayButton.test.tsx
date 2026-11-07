import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PayButton } from './PayButton'

// Plain DOM assertions are used here (no jest-dom matchers installed).
describe('PayButton', () => {
  it('calls onPay when clicked', () => {
    const onPay = vi.fn()
    render(<PayButton paying={false} onPay={onPay} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))

    expect(onPay).toHaveBeenCalledTimes(1)
  })

  it('is disabled and says Paying… while a payment is in flight', () => {
    render(<PayButton paying onPay={() => {}} />)

    const button = screen.getByRole('button', { name: 'Paying…' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('shows the payment error next to the button', () => {
    render(<PayButton paying={false} error="Payment failed." onPay={() => {}} />)

    expect(screen.getByRole('alert').textContent).toContain('Payment failed.')
  })
})
