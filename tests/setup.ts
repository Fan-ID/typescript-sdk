import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server.js';

beforeAll(() => {
  server.listen({
    onUnhandledRequest(request, print) {
      // Emulator listen/smoke hits real loopback HTTP; do not fail the suite.
      try {
        const hostname = new URL(request.url).hostname;
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
          return;
        }
      } catch {
        // fall through to error
      }
      print.error();
    },
  });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
