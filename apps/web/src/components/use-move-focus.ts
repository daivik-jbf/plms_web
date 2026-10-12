import { type MouseEvent, useLayoutEffect, useRef } from 'react';

// A browser drops the keyboard's place when the element that has it is moved in the page, and a list that has just
// been reordered has moved the row of the button that was pressed. Mark each Move button with data-move="<key>" and
// spread the result on the element that holds them: the button that was pressed gets the keyboard back once the new
// order is drawn, unless the keyboard has meanwhile gone somewhere on purpose.
export function useMoveFocus(busy: boolean) {
  const pending = useRef<string | null>(null);
  const root = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const key = pending.current;
    if (key === null) return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-move]') ?? []);
    const pressed = buttons.find((button) => button.dataset.move === key);
    const active = document.activeElement;
    if (!active || active === document.body) pressed?.focus();
    // The keyboard went somewhere else; leave it there.
    else if (active !== pressed) pending.current = null;
    // Keep following the button until the request has been answered and the new order is drawn.
    if (!busy) pending.current = null;
  });

  return {
    ref: (element: HTMLElement | null) => {
      root.current = element;
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-move]');
      // A move that is not available does nothing, so there is nothing to follow.
      pending.current = button && button.getAttribute('aria-disabled') !== 'true' ? (button.dataset.move ?? null) : null;
    },
  };
}
