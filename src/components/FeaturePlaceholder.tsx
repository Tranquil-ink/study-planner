import type { Page } from '../navigation'

export function FeaturePlaceholder({ page }: { page: Page }) {
  return (
    <section className="placeholder" aria-labelledby="pending-title">
      <div className="placeholder-symbol" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="10" y="8" width="28" height="34" rx="4" />
          <path d="M18 8V5h12v3M17 19h14M17 25h14M17 31h8" />
        </svg>
      </div>
      <span className="status-label">尚未实现</span>
      <h2 id="pending-title">{page.pendingTitle}</h2>
      <p>{page.pendingDescription}</p>
    </section>
  )
}
