// The KCCP mark — a green "book/sanctuary" with a yellow open door and a white cross
// at the threshold (recreated as vector from the church's logo). Multi-color brand mark;
// `className` controls sizing/effects only, not color. Swap freely if an official asset
// is dropped in.
export function KccpMark({ size = 120, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} role="img" aria-label="KCCP">
      {/* green book / sanctuary wall */}
      <rect x="23" y="33" width="35" height="39" rx="1.5" fill="#54C083" />
      {/* yellow door opening in perspective (top-right lifted) */}
      <path d="M58 30 L78 22.5 L78 69 L58 72 Z" fill="#F2E52C" />
      {/* white cross at the threshold, near the top */}
      <rect x="55.5" y="36" width="5" height="21" rx="0.6" fill="#fff" />
      <rect x="49.5" y="43" width="20" height="5" rx="0.6" fill="#fff" />
    </svg>
  )
}
