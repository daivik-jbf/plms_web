import { Logger } from '@nestjs/common';
import { createPool } from './db.module';

describe('createPool', () => {
  it('logs idle client errors instead of crashing the process', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool({ connectionString: 'postgres://localhost:1/never_connected' });
    try {
      expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('terminating connection due to administrator command'));
    } finally {
      logged.mockRestore();
      await pool.end();
    }
  });
});
