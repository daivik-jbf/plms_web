process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/jbf_lms_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
process.env.THROTTLE_ENABLED = 'false';
