import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
  it('connects the label, hint and error to the control', () => {
    render(
      <Select label="Role" hint="Admins can manage people" error="Choose a role.">
        <option value="staff">Staff</option>
      </Select>,
    );
    const select = screen.getByLabelText('Role');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Admins can manage people Choose a role.');
  });

  it('describes the control with only the hint when there is no error', () => {
    render(
      <Select label="Role" hint="Admins can manage people">
        <option value="staff">Staff</option>
      </Select>,
    );
    const select = screen.getByLabelText('Role');
    expect(select).toHaveAccessibleDescription('Admins can manage people');
    expect(select).not.toHaveAttribute('aria-invalid');
  });

  it('describes the control with only the error when there is no hint', () => {
    render(
      <Select label="Role" error="Choose a role.">
        <option value="staff">Staff</option>
      </Select>,
    );
    const select = screen.getByLabelText('Role');
    expect(select).toHaveAccessibleDescription('Choose a role.');
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });

  it('is not invalid without an error', () => {
    render(
      <Select label="Role">
        <option value="staff">Staff</option>
      </Select>,
    );
    expect(screen.getByLabelText('Role')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
