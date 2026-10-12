import type { ReactNode } from 'react';
import { Button } from './Button';

interface MoveButtonProps {
  // Names the button for useMoveFocus; it stays the same when the row moves.
  moveKey: string;
  label: string;
  // The move is not possible, or another change is being sent.
  unavailable: boolean;
  onMove: () => void;
  tabIndex?: number;
  children: ReactNode;
}

// A Move button is dimmed with aria-disabled and not with disabled, which would take the keyboard off it.
export function MoveButton({ moveKey, label, unavailable, onMove, tabIndex, children }: MoveButtonProps) {
  return (
    <Button
      variant="secondary"
      size="small"
      tabIndex={tabIndex}
      data-move={moveKey}
      aria-label={label}
      aria-disabled={unavailable || undefined}
      onClick={() => {
        if (!unavailable) onMove();
      }}
    >
      {children}
    </Button>
  );
}
