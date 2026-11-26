import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface OpenApiOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path as written in the spec, for example `/v1/campaigns/{campaignId}/stop`. */
  path: string;
}

const SPEC_URL = new URL('../../openapi/soundlink-public-api-v1.yaml', import.meta.url);

/**
 * Lists the operations under `paths:` in the OpenAPI file. Reads the file line by
 * line, so it needs no YAML dependency and relies on the spec's two-space layout.
 */
export function readOpenApiOperations(): OpenApiOperation[] {
  const lines = readFileSync(fileURLToPath(SPEC_URL), 'utf8').split('\n');
  const operations: OpenApiOperation[] = [];
  let inPaths = false;
  let currentPath: string | undefined;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) {
      break;
    }
    if (!inPaths) {
      continue;
    }
    const pathMatch = /^ {2}(\/v1\/\S+):\s*$/.exec(line);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch?.[1] && currentPath) {
      operations.push({
        method: methodMatch[1].toUpperCase() as OpenApiOperation['method'],
        path: currentPath,
      });
    }
  }
  return operations;
}

export function operationKey(operation: OpenApiOperation): string {
  return `${operation.method} ${operation.path}`;
}
