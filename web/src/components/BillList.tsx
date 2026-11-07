import type { Bill } from '../api'
import { formatCents } from '../api'
import { PayButton } from './PayButton'

type BillListProps = {
  bills: Bill[]
  memberNames: Map<string, string>
  payingShareId: string | null
  payErrors: Record<string, string>
  onPay: (billId: string, shareId: string) => void
}

export function BillList({ bills, memberNames, payingShareId, payErrors, onPay }: BillListProps) {
  if (bills.length === 0) {
    return <p>No bills yet. Create the first bill above.</p>
  }
  return (
    <>
      {bills.map((bill) => (
        <article key={bill.id} style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
          <h3>
            {bill.title} — {formatCents(bill.totalCents)}
          </h3>
          <ul>
            {bill.shares.map((share) => {
              const payError = payErrors[share.id]
              return (
                <li key={share.id}>
                  {memberNames.get(share.memberId) ?? 'Unknown member'}:{' '}
                  {formatCents(share.amountCents)}{' '}
                  {share.paidAt !== null ? (
                    <span>Paid</span>
                  ) : (
                    <PayButton
                      paying={payingShareId === share.id}
                      error={payError}
                      onPay={() => onPay(bill.id, share.id)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </article>
      ))}
    </>
  )
}
