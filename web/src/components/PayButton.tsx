type PayButtonProps = {
  paying: boolean
  error?: string
  onPay: () => void
}

// The button for one unpaid share. While a payment is in flight it is
// disabled so the same share cannot be paid twice from this page.
export function PayButton({ paying, error, onPay }: PayButtonProps) {
  return (
    <>
      <button type="button" onClick={onPay} disabled={paying}>
        {paying ? 'Paying…' : 'Pay'}
      </button>
      {error !== undefined && (
        <span role="alert" style={{ color: 'darkred' }}>
          {' '}
          {error}
        </span>
      )}
    </>
  )
}
