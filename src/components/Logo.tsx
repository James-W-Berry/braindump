export function Logo({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M 754.5 652 A 280 280 0 1 0 652 754.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="120"
        strokeLinecap="round"
      />
      <circle cx="639" cy="639" r="64" fill="var(--color-danger)" />
    </svg>
  );
}
