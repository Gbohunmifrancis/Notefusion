/**
 * The small pill toggle used for chart grouping and the range presets — a grey track with
 * the active segment filled in brand blue.
 *
 * `aria-pressed` rather than a radiogroup: these are buttons that act immediately, and a
 * radiogroup would promise arrow-key navigation between options that this does not wire up.
 */

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
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-alt/60 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            disabled={Boolean(option.disabledReason)}
            {...(option.disabledReason ? { title: option.disabledReason } : {})}
            className={`rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-blue text-white" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
