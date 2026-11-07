import { MAX_TOTAL_CENTS } from '@bill-splitter/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  createHome,
  formatCents,
  listBalances,
  listBills,
  listMembers,
  type Member,
  payShare,
} from '../api'
import { BillList } from '../components/BillList'
import { HomeForm } from '../components/HomeForm'
import { MemberList } from '../components/MemberList'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    home: typeof search.home === 'string' ? search.home : undefined,
  }),
  component: Home,
})

type HomeData = {
  members: Member[]
  bills: Bill[]
  balances: Balance[]
}

// The last opened home, so a reload or a shared link brings it back. The
// home id is also reflected in the URL (?home=<id>), which is the
// shareable form of the same state.
const HOME_STORAGE_KEY = 'bill-splitter-home-id'

const pageStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 760,
  margin: '0 auto',
}

function Home() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [homeIdInput, setHomeIdInput] = useState('')
  const [homeId, setHomeId] = useState<string | null>(null)
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newHomeName, setNewHomeName] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billTotal, setBillTotal] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // One busy flag per form, so submitting one form never disables the others.
  const [creatingHome, setCreatingHome] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [creatingBill, setCreatingBill] = useState(false)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})
  const restoredHomeRef = useRef<string | null>(null)

  const load = useCallback(async (id: string): Promise<HomeData | null> => {
    setLoading(true)
    setLoadError(null)
    try {
      const [membersRes, billsRes, balancesRes] = await Promise.all([
        listMembers(id),
        listBills(id),
        listBalances(id),
      ])
      const next: HomeData = {
        members: membersRes.members,
        bills: billsRes.bills,
        balances: balancesRes.balances,
      }
      setData(next)
      return next
    } catch (error) {
      // The page keeps whatever it already showed and reports the failure
      // instead of crashing, even if the API is down or very slow.
      setLoadError(error instanceof ApiError ? error.message : 'Failed to load this home.')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const openHome = useCallback(
    async (id: string) => {
      setHomeId(id)
      localStorage.setItem(HOME_STORAGE_KEY, id)
      void navigate({ search: { home: id }, replace: true })
      await load(id)
    },
    [load, navigate],
  )

  // On first mount, reopen the home from the URL (?home=<id>) or from the
  // last session. The ref guard keeps StrictMode's double effect from
  // loading twice.
  useEffect(() => {
    const initial = search.home ?? localStorage.getItem(HOME_STORAGE_KEY) ?? null
    if (initial !== null && restoredHomeRef.current !== initial) {
      restoredHomeRef.current = initial
      setHomeIdInput(initial)
      void openHome(initial)
    }
  }, [search.home, openHome])

  async function handleLoadHome() {
    const id = homeIdInput.trim()
    if (id === '') {
      setFormError('Enter a home ID first.')
      return
    }
    setFormError(null)
    await openHome(id)
  }

  async function handleCreateHome() {
    if (newHomeName.trim() === '') {
      setFormError('Enter a name for the new home.')
      return
    }
    setFormError(null)
    setCreatingHome(true)
    try {
      const home = await createHome(newHomeName.trim())
      setNewHomeName('')
      setHomeIdInput(home.id)
      await openHome(home.id)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Failed to create the home.')
    } finally {
      setCreatingHome(false)
    }
  }

  async function handleAddMember() {
    if (homeId === null || newMemberName.trim() === '') {
      setFormError('Enter a member name.')
      return
    }
    setFormError(null)
    setAddingMember(true)
    try {
      await addMember(homeId, newMemberName.trim())
      setNewMemberName('')
      await load(homeId)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Failed to add the member.')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleCreateBill() {
    if (homeId === null) return
    // Digits only: Number('1e3') is 1000 and Number('10.5') is 10.5, so a
    // plain Number() check would accept values the API rejects.
    const totalText = billTotal.trim()
    if (billTitle.trim() === '' || !/^\d+$/.test(totalText)) {
      setFormError('Enter a title and a positive whole number of cents.')
      return
    }
    const totalCents = Number(totalText)
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > MAX_TOTAL_CENTS) {
      setFormError(`Enter a total between 1 and ${MAX_TOTAL_CENTS} cents.`)
      return
    }
    setFormError(null)
    setCreatingBill(true)
    try {
      await createBill(homeId, billTitle.trim(), totalCents)
      setBillTitle('')
      setBillTotal('')
      await load(homeId)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Failed to create the bill.')
    } finally {
      setCreatingBill(false)
    }
  }

  async function handlePay(billId: string, shareId: string) {
    if (homeId === null) return
    setPayingShareId(shareId)
    setPayErrors((previous) => {
      const next = { ...previous }
      delete next[shareId]
      return next
    })
    try {
      await payShare(billId, shareId)
      await load(homeId)
    } catch (error) {
      // The payment may have landed server-side even though the request
      // failed (for example the network dropped after the API committed).
      // Reload first: if the share is now paid, the list shows Paid and no
      // error is shown for a payment that actually went through.
      const fresh = await load(homeId)
      const share = fresh?.bills.flatMap((bill) => bill.shares).find((s) => s.id === shareId)
      if (share === undefined || share.paidAt === null) {
        setPayErrors((previous) => ({
          ...previous,
          [shareId]: error instanceof ApiError ? error.message : 'Payment failed.',
        }))
      }
    } finally {
      setPayingShareId(null)
    }
  }

  const memberNames = new Map<string, string>()
  if (data !== null) {
    for (const member of data.members) {
      memberNames.set(member.id, member.name)
    }
  }

  return (
    <main style={pageStyle}>
      <h1>Bill Splitter</h1>
      <p>One home, shared bills, split in whole cents.</p>

      <HomeForm
        homeIdInput={homeIdInput}
        newHomeName={newHomeName}
        loading={loading}
        creatingHome={creatingHome}
        formError={formError}
        onHomeIdInputChange={setHomeIdInput}
        onNewHomeNameChange={setNewHomeName}
        onLoadHome={handleLoadHome}
        onCreateHome={handleCreateHome}
      />

      {loading && <p>Loading…</p>}
      {loadError !== null && (
        <p role="alert" style={{ color: 'darkred' }}>
          {loadError}
        </p>
      )}

      {homeId !== null && data !== null && (
        <>
          <MemberList
            members={data.members}
            newMemberName={newMemberName}
            addingMember={addingMember}
            onNewMemberNameChange={setNewMemberName}
            onAddMember={handleAddMember}
          />

          <section>
            <h2>Outstanding balances</h2>
            {data.balances.length === 0 ? (
              <p>No balances yet.</p>
            ) : (
              <ul>
                {data.balances.map((balance) => (
                  <li key={balance.memberId}>
                    {balance.name}: {formatCents(balance.outstandingCents)} outstanding
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Bills</h2>
            <div>
              <input
                aria-label="Bill title"
                placeholder="Bill title"
                value={billTitle}
                onChange={(event) => setBillTitle(event.target.value)}
              />{' '}
              <input
                aria-label="Bill total in cents"
                placeholder="Total in cents"
                inputMode="numeric"
                value={billTotal}
                onChange={(event) => setBillTotal(event.target.value)}
              />{' '}
              <button type="button" onClick={handleCreateBill} disabled={creatingBill}>
                Create bill
              </button>
            </div>
            <BillList
              bills={data.bills}
              memberNames={memberNames}
              payingShareId={payingShareId}
              payErrors={payErrors}
              onPay={handlePay}
            />
          </section>
        </>
      )}
    </main>
  )
}
