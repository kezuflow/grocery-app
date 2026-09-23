import { useRef, type DragEvent, type MouseEvent, type PointerEvent } from "react";

const DRAG_THRESHOLD_PX = 8;

/** Let a horizontal rail follow the pointer without turning a drag into a link click. */
export function useHorizontalDragScroll<T extends HTMLElement>() {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const finishDrag = (event: PointerEvent<T>, suppressClick: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = suppressClick && drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    onPointerDown: (event: PointerEvent<T>) => {
      if (event.button !== 0 || dragRef.current) return;
      suppressClickRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: event.currentTarget.scrollLeft,
        moved: false,
      };
    },
    onPointerMove: (event: PointerEvent<T>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = event.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(distance) <= DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
    },
    onPointerUp: (event: PointerEvent<T>) => finishDrag(event, true),
    onPointerCancel: (event: PointerEvent<T>) => finishDrag(event, false),
    onClickCapture: (event: MouseEvent<T>) => {
      if (!suppressClickRef.current || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    },
    onDragStartCapture: (event: DragEvent<T>) => event.preventDefault(),
  };
}
