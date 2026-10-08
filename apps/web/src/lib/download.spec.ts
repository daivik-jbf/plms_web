import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from './download';

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicks a temporary download link and revokes the object URL only after the click has been handled', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL, revokeObjectURL }));
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download, attached: this.isConnected });
    });

    const blob = new Blob(['a,b\r\n'], { type: 'text/csv' });
    saveBlob(blob, 'audit-log.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:test-url', download: 'audit-log.csv', attached: true }]);
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
