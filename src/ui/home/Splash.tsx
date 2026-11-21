import { Logo } from '../Logo'
import { Skeleton } from '../kit'

/** While the encrypted ledger opens: the mark breathing, and the shape of the home screen. */
export function Splash() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col" aria-busy="true">
      <span className="sr-only" role="status">KhataBhai…</span>
      <div className="flex h-16 items-center justify-between px-3" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <Skeleton className="size-11" />
        <div className="relative grid place-items-center">
          <span aria-hidden className="breathe absolute inset-0 rounded-2xl bg-primary/25" />
          <Logo size={40} className="relative" />
        </div>
        <Skeleton className="h-11 w-24" />
      </div>
      <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
        <Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="mx-4 mt-3 h-14 rounded-2xl" />
      <div className="mx-4 mt-3 space-y-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
      </div>
    </div>
  )
}
