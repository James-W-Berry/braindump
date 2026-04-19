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
      <defs>
        <clipPath id="braindump-plate-clip">
          <rect x="102" y="102" width="820" height="820" rx="180" ry="180" />
        </clipPath>
      </defs>
      {/* Gold-leaf plate — the primary form. */}
      <rect
        x="102"
        y="102"
        width="820"
        height="820"
        rx="180"
        ry="180"
        fill="#c49935"
      />
      {/* Moebius sun: a single pale celestial mark in the upper-left. */}
      <circle cx="350" cy="340" r="110" fill="#e6e2d8" />
      {/* Two diagonal teal bands in the bottom-right quadrant. Uses
          currentColor so the bands inherit the consumer's text color. */}
      <g
        clipPath="url(#braindump-plate-clip)"
        stroke="currentColor"
        strokeWidth="72"
        fill="none"
      >
        <line x1="480" y1="960" x2="1040" y2="400" />
        <line x1="640" y1="960" x2="1040" y2="560" />
      </g>
    </svg>
  );
}
