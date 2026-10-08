import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import styles from './Badge.module.css';

describe('Badge', () => {
  it.each(['change', 'danger', 'warning', 'success', 'neutral'] as const)('shows its text label for the %s tone (color is never the only signal)', (tone) => {
    render(<Badge tone={tone}>Role changed</Badge>);
    expect(screen.getByText('Role changed')).toBeInTheDocument();
  });

  it.each(['change', 'danger', 'warning', 'success', 'neutral'] as const)('uses the %s tone style', (tone) => {
    render(<Badge tone={tone}>Label</Badge>);
    const badge = screen.getByText('Label');
    expect(badge).toHaveClass(styles.badge!, styles[tone]!);
    for (const other of ['change', 'danger', 'warning', 'success', 'neutral'].filter((name) => name !== tone)) {
      expect(badge).not.toHaveClass(styles[other]!);
    }
  });
});
