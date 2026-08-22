import mark from "@/assets/brand/mark.png";
import { cn } from "@/lib/utils";

interface Props {
  /** Rendered height in px; width follows the artwork's aspect. */
  size?: number;
  /**
   * Mark colour. Defaults to `currentColor`, so a `text-*` class on the call site
   * drives it and the mark follows the theme without anyone passing a hex.
   */
  color?: string;
  /** Colour of the flanking waveform bars; defaults to `color`. */
  waveColor?: string;
  /** Draw the waveform bars either side of the ring, as on the app's login screen. */
  showWaves?: boolean;
  className?: string;
}

/** Aspect of the shipped artwork (331 × 438), matching mobile's BrandMark. */
const MARK_ASPECT = 331 / 438;

/**
 * The NoteFusion mark — the same asset the app ships, so the dashboard and the app
 * show one logo rather than two drawings of it. `mobile/assets/brand/mark.png` is the
 * source; `mobile/scripts/build-brand-assets.mjs` derives it from the design render.
 *
 * The glyph is a white silhouette with an alpha channel. Mobile recolours it with
 * `tintColor`, which has no CSS equivalent, so here it is used as a mask over a solid
 * fill — same one-mark-many-colours property, and it inherits `currentColor` so a
 * parent's text colour drives it.
 *
 * Imported rather than referenced from `public/`, so the URL carries a content hash and the
 * file is not fetched at all in the mask-unsupported case. A static import under Next resolves
 * to a `StaticImageData` object, hence `mark.src` where Vite handed back a bare string.
 *
 * The flanking bars stay vector, as on mobile, keeping their opacity ramp independent
 * of the mark's tint.
 */
export function BrandMark({
  size = 96,
  color = "currentColor",
  waveColor,
  showWaves = false,
  className,
}: Props) {
  const wave = waveColor ?? color;
  const markWidth = size * MARK_ASPECT;

  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      style={{ height: size }}
    >
      {showWaves && <SideWave size={size} color={wave} mirrored={false} />}

      <span
        aria-hidden="true"
        style={{
          width: markWidth,
          height: size,
          backgroundColor: color,
          WebkitMaskImage: `url(${mark.src})`,
          maskImage: `url(${mark.src})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          display: "block",
        }}
      />

      {showWaves && <SideWave size={size} color={wave} mirrored />}
    </span>
  );
}

/**
 * The five-bar waveform flanking the mark. Bars are symmetric about the middle so the
 * two sides mirror each other; `mirrored` reverses the order for the right-hand copy.
 * Heights and the opacity ramp are copied from mobile's SideWave.
 */
function SideWave({
  size,
  color,
  mirrored,
}: {
  size: number;
  color: string;
  mirrored: boolean;
}) {
  const bars = [0.32, 0.58, 0.86, 0.5, 0.24];
  const ordered = mirrored ? [...bars].reverse() : bars;

  return (
    <svg
      width={size * 0.36}
      height={size}
      viewBox="0 0 36 100"
      aria-hidden="true"
      focusable="false"
    >
      {ordered.map((h, i) => {
        const barH = h * 74;
        return (
          <rect
            key={i}
            x={i * 7.4}
            y={50 - barH / 2}
            width="4"
            height={barH}
            rx="2"
            fill={color}
            // Outer bars fade out, so the group reads as sound trailing off rather
            // than as a solid block competing with the mark.
            opacity={0.35 + h * 0.45}
          />
        );
      })}
    </svg>
  );
}
