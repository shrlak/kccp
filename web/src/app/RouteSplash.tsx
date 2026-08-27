import { KccpMark } from '../areas/attend/checkin/KccpMark'

// Shown while a route's chunk is still arriving (see routes.tsx). Deliberately the same
// mark-in-a-rounded-tile as the admin panel's "verifying" screen, so a cold load and a
// session check look like one continuous wait rather than two different screens.
export function RouteSplash() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <span className="fx-pulse grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)]">
        <KccpMark size={36} />
      </span>
    </main>
  )
}
