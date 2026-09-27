/**
 * Provider marks, drawn simply rather than lifted, and inheriting the current colour so they
 * sit in either theme. Each is recognisable at the size it is used and nothing more.
 */
export function ProviderLogo({ provider, className = "h-4 w-4" }: { provider: string; className?: string }) {
  if (provider === "slack") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <path d="M5.1 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1.1 0a2.1 2.1 0 0 1 4.2 0v5.2a2.1 2.1 0 0 1-4.2 0v-5.2Z" />
        <path d="M8.3 5.1a2.1 2.1 0 1 1 2.1-2.1v2.1H8.3Zm0 1.1a2.1 2.1 0 0 1 0 4.2H3.1a2.1 2.1 0 0 1 0-4.2h5.2Z" />
        <path d="M18.9 8.3a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.3Zm-1.1 0a2.1 2.1 0 0 1-4.2 0V3.1a2.1 2.1 0 0 1 4.2 0v5.2Z" />
        <path d="M15.7 18.9a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1.1a2.1 2.1 0 0 1 0-4.2h5.2a2.1 2.1 0 0 1 0 4.2h-5.2Z" />
      </svg>
    );
  }
  if (provider === "telegram") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <path d="M21.6 4.3 2.9 11.5c-1 .4-1 1.8 0 2.1l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.4 4.7 3.4c.7.5 1.7.1 1.9-.7l3-14.2c.2-1-.8-1.9-1.7-1.6ZM9.4 14.6l8.3-5.1c.3-.2.6.2.4.4l-6.6 6.2c-.2.2-.4.5-.4.8l-.2 1.9-1.5-4.2Z" />
      </svg>
    );
  }
  if (provider === "ntfy") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
        <path d="M13.7 20a2 2 0 0 1-3.4 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}
