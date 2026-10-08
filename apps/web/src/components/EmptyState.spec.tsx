import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

describe('EmptyState and Skeleton', () => {
  it('EmptyState shows a title and its explanation', () => {
    render(<EmptyState title="No activity matches these filters">Try clearing a filter.</EmptyState>);
    expect(screen.getByText('No activity matches these filters')).toBeInTheDocument();
    expect(screen.getByText('Try clearing a filter.')).toBeInTheDocument();
  });

  it('Skeleton announces loading politely', () => {
    render(<Skeleton rows={3} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
