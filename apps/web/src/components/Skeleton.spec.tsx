import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('is a status region named Loading that also carries the word as text for screen readers', () => {
    render(<Skeleton rows={2} />);
    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status).toHaveTextContent('Loading');
  });
});
