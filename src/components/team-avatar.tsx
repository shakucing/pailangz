import styles from "./team-portal.module.css";

export function TeamAvatar({
  image,
  name,
  className = "",
}: {
  image: string | null;
  name: string;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase() || "PZ";
  return image ? (
    <img
      className={`${styles.avatar} ${className}`}
      src={image}
      alt=""
      width={64}
      height={64}
    />
  ) : (
    <span
      className={`${styles.avatar} ${styles.avatarFallback} ${className}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
