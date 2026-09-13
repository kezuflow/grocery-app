// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TimeOfDayInput } from "./time-of-day-input";

vi.mock("../ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled: boolean;
    children: ReactNode;
  }) => (
    <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

it.each([
  { value: 0, endOfDay: false, period: "PM", expected: 720 },
  { value: 720, endOfDay: false, period: "AM", expected: 0 },
  { value: 720, endOfDay: true, period: "AM", expected: 1440 },
  { value: 1440, endOfDay: true, period: "PM", expected: 720 },
])(
  "converts noon/midnight without changing persisted semantics: $value to $expected",
  ({ value, endOfDay, period, expected }) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    try {
      act(() =>
        root.render(
          <TimeOfDayInput
            label="Closes"
            value={value}
            endOfDay={endOfDay}
            disabled={false}
            onChange={onChange}
          />,
        ),
      );
      const controls = host.querySelectorAll("select");
      expect(controls[0].value).toBe("12");
      act(() => {
        controls[2].value = period;
        controls[2].dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledWith(expected);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);
