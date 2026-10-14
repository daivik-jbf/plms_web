import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverField } from './CoverField';

const drawn: { width: number; height: number; source: number[] }[] = [];

class LoadableImage {
  naturalWidth = 2000;
  naturalHeight = 1000;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function stubPictureSupport() {
  vi.stubGlobal('Image', LoadableImage);
  URL.createObjectURL = vi.fn(() => 'blob:cover');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return {
      fillRect: vi.fn(),
      drawImage: vi.fn((_image: unknown, ...source: number[]) => drawn.push({ width: this.width, height: this.height, source })),
    };
  }) as never;
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['x'], { type: 'image/jpeg' })));
}

const png = () => new File(['x'], 'cover.png', { type: 'image/png' });

describe('CoverField', () => {
  beforeEach(() => {
    drawn.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes the picture on as it is when it cannot be opened for framing', async () => {
    const onChange = vi.fn();
    render(<CoverField onChange={onChange} />);
    const file = png();
    await userEvent.upload(screen.getByLabelText('Cover image'), file);
    expect(onChange).toHaveBeenCalledWith(file);
    expect(screen.queryByRole('group', { name: 'Shape of the cover' })).toBeNull();
  });

  it('passes a file of the wrong kind on untouched, so the form can say what is wrong', async () => {
    stubPictureSupport();
    const onChange = vi.fn();
    render(<CoverField onChange={onChange} />);
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Cover image'), file);
    expect(onChange).toHaveBeenLastCalledWith(file);
    expect(screen.queryByRole('group', { name: 'Shape of the cover' })).toBeNull();
  });

  it('shows the editor for a picture and sends the framed JPEG, wide by default', async () => {
    stubPictureSupport();
    const onChange = vi.fn();
    render(<CoverField onChange={onChange} />);
    await userEvent.upload(screen.getByLabelText('Cover image'), png());
    expect(await screen.findByRole('group', { name: 'Shape of the cover' })).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom')).toHaveValue('1');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'cover.jpg', type: 'image/jpeg' })));
    expect(drawn.at(-1)).toMatchObject({ width: 1600, height: 900 });
  });

  it('frames again when the shape or the zoom changes', async () => {
    stubPictureSupport();
    const onChange = vi.fn();
    render(<CoverField onChange={onChange} />);
    await userEvent.upload(screen.getByLabelText('Cover image'), png());
    const shapes = await screen.findByRole('group', { name: 'Shape of the cover' });
    await userEvent.click(within(shapes).getByRole('button', { name: 'Square 1:1' }));
    expect(within(shapes).getByRole('button', { name: 'Square 1:1' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(drawn.at(-1)).toMatchObject({ width: 1000, height: 1000 }));
    const before = drawn.length;
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    await waitFor(() => expect(drawn.length).toBeGreaterThan(before));
    expect(drawn.at(-1)!.source[2]).toBe(500);
  });

  it('moves the picture with the arrow keys and puts it back with Reset', async () => {
    stubPictureSupport();
    render(<CoverField onChange={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Cover image'), png());
    await screen.findByRole('group', { name: 'Shape of the cover' });
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    const centred = drawn.at(-1)!.source[0];
    screen.getByRole('group', { name: /Cover preview/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(drawn.at(-1)!.source[0]).not.toBe(centred));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(drawn.at(-1)!.source[0]).toBe(centred));
  });
});
