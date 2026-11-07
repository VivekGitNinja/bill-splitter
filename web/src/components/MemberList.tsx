import type { Member } from '../api'

type MemberListProps = {
  members: Member[]
  newMemberName: string
  addingMember: boolean
  onNewMemberNameChange: (value: string) => void
  onAddMember: () => void
}

export function MemberList({
  members,
  newMemberName,
  addingMember,
  onNewMemberNameChange,
  onAddMember,
}: MemberListProps) {
  return (
    <section>
      <h2>Members</h2>
      {members.length === 0 ? (
        <p>No members yet. Add the first member below.</p>
      ) : (
        <ul>
          {members.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ul>
      )}
      <div>
        <input
          aria-label="New member name"
          placeholder="Member name"
          value={newMemberName}
          onChange={(event) => onNewMemberNameChange(event.target.value)}
        />{' '}
        <button type="button" onClick={onAddMember} disabled={addingMember}>
          Add member
        </button>
      </div>
    </section>
  )
}
