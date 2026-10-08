import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('connects the label, hint and error to the input for assistive technology', () => {
    render(<TextField label="Email" hint="Use your work email" error="Enter a valid email address." />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use your work email Enter a valid email address.');
  });

  it('is not marked invalid without an error', () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
