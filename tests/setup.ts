import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server.js';

beforeAll(() => {
  server.listen({
    onUnhandledRequest(request, print) {
      // Emulator HTTP tests use real loopback fetch.
      const hostname = new URL(request.url).hostname;
      if (hostname === '127.0.0.1' || hostname === 'localhost') {
        return;
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
