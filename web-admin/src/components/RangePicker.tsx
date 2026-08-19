import { CalendarDays } from "lucide-react";

import { Segmented } from "@/components/Segmented";
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

  // Empty when the dates have been edited by hand: no preset should read as selected when
  // the window is not one of them.
  const activePreset =
    PRESETS.find((preset) => {
      const range = presetRange(preset.days);
      return range.from === value.from && range.to === value.to;
    })?.label ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<string>
        label="Range preset"
        options={PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
        value={activePreset}
        onChange={(label) => {
          const preset = PRESETS.find((candidate) => candidate.label === label);
          if (preset) onChange(presetRange(preset.days));
        }}
      />

      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-1.5">
          <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-faint" />
          <input
            type="date"
            aria-label="Range start"
            value={value.from}
            max={value.to}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            className="bg-transparent text-xs text-ink outline-none"
          />
        </label>
        <span className="text-xs text-faint" aria-hidden="true">
          to
        </span>
        <label className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-1.5">
          <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-faint" />
          <input
            type="date"
            aria-label="Range end"
            value={value.to}
            min={value.from}
            max={today}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className="bg-transparent text-xs text-ink outline-none"
          />
        </label>
      </div>
    </div>
  );
}
