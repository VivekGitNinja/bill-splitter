// Shared types for the bill splitter API and web app.
//
// Both sides import these from '@bill-splitter/shared' so the wire shapes
// cannot drift apart. Money is always whole cents (integers): 100 cents is
// one dollar, never decimals.

export const MAX_NAME_LENGTH = 200
export const MAX_TOTAL_CENTS = 100_000_000

export type Home = { id: string; name: string }

export type Member = { id: string; homeId: string; name: string }

export type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

export type Balance = { memberId: string; name: string; outstandingCents: number }
