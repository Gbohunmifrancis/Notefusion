/**
 * The small pill toggle used for chart grouping and the range presets — a grey track with
 * the active segment filled in brand blue.
 *
 * Wraps shadcn's `ToggleGroup`, which is Radix's roving-tabindex implementation: the group is
 * one tab stop and the arrow keys move between segments. The hand-rolled version this replaces
 * was a row of buttons with `aria-pressed`, which meant four tab stops for one control and no
 * arrow keys at all.
 */

"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Disabled when the underlying data cannot support the option, with the reason. */
  disabledReason?: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Chart grouping". */
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix reports "" when the active item is clicked again. Dropping it is deliberate:
      // these toggles pick which grouping or preset is shown, and there is no such thing as
      // a chart grouped by nothing. The range picker relies on the same behaviour — it passes
      // "" in when the dates have been hand-edited, and must not be able to *return* there.
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-[10px] border border-[color:var(--panel-line)] bg-muted/60 p-0.5"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          disabled={Boolean(option.disabledReason)}
          {...(option.disabledReason ? { title: option.disabledReason } : {})}
          className="h-auto min-w-0 rounded-[8px] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 data-[state=on]:nf-fusion data-[state=on]:text-white"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
