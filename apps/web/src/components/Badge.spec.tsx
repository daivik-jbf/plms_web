import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it.each(['change', 'danger', 'warning', 'success', 'neutral'] as const)('shows its text label for the %s tone (color is never the only signal)', (tone) => {
    render(<Badge tone={tone}>Role changed</Badge>);
    expect(screen.getByText('Role changed')).toBeInTheDocument();
  });
});
