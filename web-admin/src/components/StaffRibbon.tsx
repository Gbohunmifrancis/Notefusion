interface Props {
  /** Whole-ribbon opacity — this is background texture, never content. */
  opacity?: number;
  className?: string;
}

/** Vertical gap between the five staff lines, in viewBox units. */
const GAP = 11;

/** One wavy staff line, offset down the stave by `y`. */
function StaffLine({ y }: { y: number }) {
  return (
    <path
      d={`M0 ${y} C 60 ${y - 14}, 120 ${y + 14}, 200 ${y} S 340 ${y - 14}, 400 ${y - 4}`}
      strokeWidth="1.4"
      fill="none"
    />
  );
}

/**
 * A quaver. `up` puts the stem on the right side of the head, as it is for notes
 * sitting low on the stave; `flag` adds the single tail of an unbeamed eighth.
 */
function Note({
  x,
  y,
  up = true,
  flag = false,
}: {
  x: number;
  y: number;
  up?: boolean;
  flag?: boolean;
}) {
  const stemX = up ? x + 5.4 : x - 5.4;
  const stemEnd = up ? y - 26 : y + 26;
  return (
    <g>
      {/* Heads are tilted, the way they are drawn by hand and in engraved scores. */}
      <ellipse cx={x} cy={y} rx="6.2" ry="4.6" transform={`rotate(-20 ${x} ${y})`} />
      <line x1={stemX} y1={y} x2={stemX} y2={stemEnd} strokeWidth="1.8" />
      {flag && (
        <path d={`M${stemX} ${stemEnd} c 7 3, 9 9, 5 15`} strokeWidth="1.8" fill="none" />
      )}
    </g>
  );
}

/** Two quavers under a beam — the pair shape that reads instantly as music. */
function BeamedPair({ x, y }: { x: number; y: number }) {
  const x2 = x + 17;
  return (
    <g>
      <ellipse cx={x} cy={y} rx="6.2" ry="4.6" transform={`rotate(-20 ${x} ${y})`} />
      <ellipse cx={x2} cy={y - 5} rx="6.2" ry="4.6" transform={`rotate(-20 ${x2} ${y - 5})`} />
      <line x1={x + 5.4} y1={y} x2={x + 5.4} y2={y - 27} strokeWidth="1.8" />
      <line x1={x2 + 5.4} y1={y - 5} x2={x2 + 5.4} y2={y - 32} strokeWidth="1.8" />
      <rect
        x={x + 5.4}
        y={y - 32}
        width={17}
        height="3.4"
        transform={`rotate(-8 ${x + 5.4} ${y - 32})`}
      />
    </g>
  );
}

/**
 * Decorative music-staff ribbon — the wavy stave along the bottom of the app's splash,
 * login, and onboarding screens, ported path-for-path from `mobile/src/components/
 * StaffRibbon.tsx` so the dashboard's sign-in reads as the same artwork.
 *
 * Colour comes from `currentColor`, so a parent's text colour drives it. Purely
 * ornamental, so it carries no accessibility role — there is nothing here for a screen
 * reader to announce.
 */
export function StaffRibbon({ opacity = 0.2, className }: Props) {
  return (
    <svg
      viewBox="0 0 400 90"
      preserveAspectRatio="none"
      opacity={opacity}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g stroke="currentColor" fill="none">
        {[0, 1, 2, 3, 4].map((i) => (
          <StaffLine key={i} y={20 + i * GAP} />
        ))}
      </g>

      {/* G clef — the spiral, the crossing stem, and the tail below the stave. */}
      <g stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round">
        <path d="M24 74 c -9 -3 -11 -14 -3 -19 c 9 -6 19 2 19 12 c 0 14 -14 22 -20 30" />
        <path d="M20 97 c 9 -14 21 -22 21 -40 c 0 -16 -6 -30 -13 -30 c -6 0 -9 8 -8 17 c 1 12 8 22 14 30" />
      </g>

      <g fill="currentColor" stroke="currentColor">
        <BeamedPair x={112} y={54} />
        <Note x={86} y={62} flag />
        <Note x={168} y={50} />
        <Note x={205} y={58} flag />
        <BeamedPair x={248} y={44} />
        <Note x={306} y={52} flag />
        <Note x={344} y={40} />
        <Note x={378} y={48} />
      </g>
    </svg>
  );
}
