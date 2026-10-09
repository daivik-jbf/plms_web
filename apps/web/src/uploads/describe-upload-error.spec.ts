import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { describeUploadError } from './describe-upload-error';
import { PieceFailedError } from './engine';
import { HttpPieceError, MissingReceiptError } from './xhr';

describe('describeUploadError', () => {
  it('blames the connection when a piece kept failing', () => {
    expect(describeUploadError(new PieceFailedError(3, new HttpPieceError(500)))).toMatch(/connection kept failing/i);
  });

  it('points at the storage setup when receipts are missing', () => {
    expect(describeUploadError(new PieceFailedError(1, new MissingReceiptError()))).toMatch(/Ask an Admin/);
  });

  it('shows the server\'s own explanation for a refusal, and a generic one for anything else', () => {
    expect(describeUploadError(new ApiError(422, 'That file is not a valid MP4 video, so it was discarded.'))).toBe('That file is not a valid MP4 video, so it was discarded.');
    expect(describeUploadError(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});
