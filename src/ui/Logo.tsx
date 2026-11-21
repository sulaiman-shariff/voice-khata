/**
 * KhataBhai mark: a speech bubble (you speak) holding a rupee (your khata), with two ledger
 * rules under it. Drawn in the theme's colours; public/icon.svg is the same mark in fixed colours
 * for the browser tab, the PWA and the Capacitor app icon. Placeholder art: swap freely.
 */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="KhataBhai">
      <rect x="1" y="1" width="62" height="62" rx="15" fill="var(--primary)" />
      {/* speech bubble */}
      <path
        d="M17 12h30a7 7 0 0 1 7 7v17a7 7 0 0 1-7 7H31l-9 7.5V43h-5a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7z"
        fill="none" stroke="var(--primary-foreground)" strokeWidth="2.6" strokeLinejoin="round"
      />
      {/* rupee (lucide indian-rupee geometry, centred in the bubble) */}
      <g transform="translate(20 15.5)" fill="none" stroke="var(--gold)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12M6 8h12M6 13h3M9 13c6.667 0 6.667-10 0-10M6 13l8.5 8" />
      </g>
      {/* ledger rules */}
      <path d="M35 53.5h18M40 57.5h13" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" opacity=".85" />
    </svg>
  )
}

export function Wordmark({ size = 40 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <Logo size={size} className="shrink-0 drop-shadow-sm" />
      <div>
        <div className="text-2xl leading-tight font-semibold tracking-tight">KhataBhai</div>
        <div className="text-[10px] font-semibold tracking-[0.24em] text-gold uppercase">Voice khata · AI</div>
      </div>
    </div>
  )
}
