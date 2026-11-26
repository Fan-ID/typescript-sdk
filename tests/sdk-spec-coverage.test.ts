import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { operationKey, readOpenApiOperations } from './helpers/openapi-operations.js';

const RESOURCES_URL = new URL('../src/resources/index.ts', import.meta.url);

/** Operations the SDK documents with a "Maps to `METHOD /v1/...`" comment. */
function documentedOperations(): Set<string> {
  const source = readFileSync(fileURLToPath(RESOURCES_URL), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(
    /Maps to `(GET|POST|PUT|PATCH|DELETE) (\/v1\/[^`\s]+)`/g,
  )) {
    keys.add(`${match[1] ?? ''} ${match[2] ?? ''}`);
  }
  return keys;
}

describe('SDK coverage of the Public API spec', () => {
  const operations = readOpenApiOperations();

  it('reads the operations from the spec', () => {
    expect(operations.length).toBeGreaterThan(40);
  });

  it('wraps every operation in the spec', () => {
    const documented = documentedOperations();

    const missing = operations.map(operationKey).filter((key) => !documented.has(key));

    expect(missing).toEqual([]);
  });

  it('documents no operation that is not in the spec', () => {
    const known = new Set(operations.map(operationKey));

    const unknown = [...documentedOperations()].filter((key) => !known.has(key));

    expect(unknown).toEqual([]);
  });
});
