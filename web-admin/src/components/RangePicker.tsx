import { addDays, reportingToday } from "@/lib/format";

/**
 * Range control for the overview.
 *
 * The values are reporting-local calendar dates, the same space `<input type="date">`
 * works in and the same space the API's `from`/`to` parameters expect, so nothing is
 * converted on the way through. "Today" is the server's today (from the response's
 * `reportingOffsetMinutes`), not the browser's, which is why the offset is a prop rather
 * than a constant here.
 *
 * The inputs bound each other with `min`/`max` so an inverted range cannot be submitted.
 * The server still rejects one with ANALYTICS_RANGE_INVERTED — this only spares the admin
 * a round trip to learn it.
 */

export interface Range {
  from: string;
  to: string;
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

interface RangePickerProps {
  value: Range;
  offsetMinutes: number;
  onChange: (range: Range) => void;
}

export function RangePicker({ value, offsetMinutes, onChange }: RangePickerProps) {
  const today = reportingToday(offsetMinutes);

  const presetRange = (days: number): Range => ({
    // Inclusive of both ends, so a 7-day window spans today and the six days before it.
    from: addDays(today, -(days - 1)),
    to: today,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-pill border border-border bg-surface">
        {PRESETS.map(({ label, days }) => {
          const range = presetRange(days);
          const active = range.from === value.from && range.to === value.to;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(range)}
              aria-pressed={active}
              className={`px-3 py-1.5 text-xs font-semibold transition ${
                active ? "bg-fusion-contrast text-white" : "text-muted hover:bg-surface-alt"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted">
        <input
          type="date"
          aria-label="Range start"
          value={value.from}
          max={value.to}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-blue"
        />
        <span aria-hidden="true">to</span>
        <input
          type="date"
          aria-label="Range end"
          value={value.to}
          min={value.from}
          max={today}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-blue"
        />
      </div>
    </div>
  );
}
