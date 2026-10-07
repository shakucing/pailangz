export function StaffLoading() {
  return (
    <div
      className="staff-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="loading-spinner" aria-hidden="true" />
      <p>Opening workspace…</p>
      <div className="loading-skeleton" />
      <div className="loading-skeleton" />
      <div className="loading-skeleton" />
    </div>
  );
}
