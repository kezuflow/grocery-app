// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHorizontalDragScroll } from "./use-horizontal-drag-scroll";

const onClick = vi.fn();
let host: HTMLDivElement;
let root: Root;
let rail: HTMLDivElement;
let link: HTMLAnchorElement;

function Rail() {
  const handlers = useHorizontalDragScroll<HTMLDivElement>();
  return (
    <div {...handlers}>
      <a
        href="/category"
        onClick={(event) => {
          event.preventDefault();
          onClick();
        }}
      >
        Category
      </a>
    </div>
  );
}

function pointer(type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    pointerId: { value: 1 },
  });
  act(() => link.dispatchEvent(event));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  onClick.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Rail />));
  rail = host.querySelector("div")!;
  link = host.querySelector("a")!;
  rail.setPointerCapture = vi.fn();
  rail.hasPointerCapture = vi.fn().mockReturnValue(true);
  rail.releasePointerCapture = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("waits for drag intent, follows the pointer, and suppresses only the dragged click", () => {
  pointer("pointerdown", 200);
  pointer("pointermove", 195);
  expect(rail.scrollLeft).toBe(0);
  expect(rail.setPointerCapture).not.toHaveBeenCalled();

  pointer("pointermove", 140);
  expect(rail.scrollLeft).toBe(60);
  expect(rail.setPointerCapture).toHaveBeenCalledWith(1);
  pointer("pointerup", 140);
  expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);

  const draggedClick = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  act(() => link.dispatchEvent(draggedClick));
  expect(draggedClick.defaultPrevented).toBe(true);
  expect(onClick).not.toHaveBeenCalled();

  pointer("pointerdown", 140);
  pointer("pointerup", 140);
  const ordinaryClick = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  act(() => link.dispatchEvent(ordinaryClick));
  expect(onClick).toHaveBeenCalledOnce();
});

it("cancels native link dragging and keeps keyboard clicks available", () => {
  const nativeDrag = new Event("dragstart", { bubbles: true, cancelable: true });
  act(() => link.dispatchEvent(nativeDrag));
  expect(nativeDrag.defaultPrevented).toBe(true);

  pointer("pointerdown", 200);
  pointer("pointermove", 140);
  pointer("pointerup", 140);
  const keyboardClick = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
  act(() => link.dispatchEvent(keyboardClick));
  expect(onClick).toHaveBeenCalledOnce();
});
