import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

/** Presentation only: values remain minutes since midnight (1440 for an end-of-day close). */
export function TimeOfDayInput({
  label,
  value,
  onChange,
  disabled,
  endOfDay = false,
}: {
  label: string;
  value: number;
  onChange: (minutes: number) => void;
  disabled: boolean;
  endOfDay?: boolean;
}) {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  const period = hour >= 12 ? "PM" : "AM";
  function update(nextHour: number, nextMinute: number, nextPeriod: string) {
    const next = ((nextHour % 12) + (nextPeriod === "PM" ? 12 : 0)) * 60 + nextMinute;
    onChange(endOfDay && next === 0 ? 1440 : next);
  }
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <Select
        disabled={disabled}
        value={String(hour % 12 || 12)}
        onValueChange={(v) => update(Number(v), minute, period)}
      >
        <SelectTrigger aria-label={`${label} hour`} className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
            <SelectItem key={v} value={String(v)}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-hidden="true">:</span>
      <Select
        disabled={disabled}
        value={String(minute)}
        onValueChange={(v) => update(hour % 12 || 12, Number(v), period)}
      >
        <SelectTrigger aria-label={`${label} minute`} className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 60 }, (_, i) => (
            <SelectItem key={i} value={String(i)}>
              {String(i).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={disabled}
        value={period}
        onValueChange={(v) => update(hour % 12 || 12, minute, v)}
      >
        <SelectTrigger aria-label={`${label} AM or PM`} className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
