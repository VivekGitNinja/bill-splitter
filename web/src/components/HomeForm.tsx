type HomeFormProps = {
  homeIdInput: string
  newHomeName: string
  loading: boolean
  creatingHome: boolean
  formError: string | null
  onHomeIdInputChange: (value: string) => void
  onNewHomeNameChange: (value: string) => void
  onLoadHome: () => void
  onCreateHome: () => void
}

// Load an existing home by id, or create a new one. The home id is the only
// credential the API has: anyone who knows it can see and change the home,
// so treat it like a password and do not share it.
export function HomeForm({
  homeIdInput,
  newHomeName,
  loading,
  creatingHome,
  formError,
  onHomeIdInputChange,
  onNewHomeNameChange,
  onLoadHome,
  onCreateHome,
}: HomeFormProps) {
  return (
    <section>
      <h2>Home</h2>
      <div>
        <input
          aria-label="Home ID"
          placeholder="Home ID"
          value={homeIdInput}
          onChange={(event) => onHomeIdInputChange(event.target.value)}
        />{' '}
        <button type="button" onClick={onLoadHome} disabled={loading}>
          Load home
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <input
          aria-label="New home name"
          placeholder="New home name"
          value={newHomeName}
          onChange={(event) => onNewHomeNameChange(event.target.value)}
        />{' '}
        <button type="button" onClick={onCreateHome} disabled={creatingHome}>
          Create home
        </button>
      </div>
      {formError !== null && (
        <p role="alert" style={{ color: 'darkred' }}>
          {formError}
        </p>
      )}
    </section>
  )
}
