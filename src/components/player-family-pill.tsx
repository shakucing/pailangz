import styles from "./player-family-pill.module.css";

export function PlayerFamilyPill({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className={styles.pill} title={label} data-family-label={label}>
      {label}
    </span>
  );
}
