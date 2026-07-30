import { createAsyncApiDocument } from '@superliora/protocol';

import { transformOpenApiDocument } from './openapi/transforms';

/**
 * Minimal structural shape for the Fastify instance — avoids the strict
 * generic mismatch between Fastify's default `FastifyInstance` and the
 * server's pino-typed variant (`FastifyInstance<…, ServerLogger>`).
 */
interface OpenApiHost {
  register(
    plugin: unknown,
    opts: Record<string, unknown>,
  ): Promise<unknown>;
  get(
    path: string,
    handler: (
      req: unknown,
      reply: { type(contentType: string): { send(payload: unknown): unknown } },
    ) => unknown,
  ): unknown;
}

export async function registerServerOpenApi(
  app: OpenApiHost,
  serverVersion: string,
): Promise<void> {
  const { default: swagger } = await import('@fastify/swagger');
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SuperLiora Server API',
        description:
          'REST API for the SuperLiora local server. All JSON responses are wrapped in a uniform envelope `{ code, msg, data, request_id }`.',
        version: serverVersion,
      },
      tags: [
        { name: 'meta', description: 'Server metadata' },
        { name: 'auth', description: 'Auth readiness & login state' },
        { name: 'models', description: 'Configured model aliases' },
        { name: 'providers', description: 'Configured providers' },
        { name: 'sessions', description: 'Session lifecycle' },
        { name: 'workspaces', description: 'Workspace registry + folder picker' },
        { name: 'messages', description: 'Message history' },
        { name: 'prompts', description: 'Prompt submission & abort' },
        { name: 'approvals', description: 'Approval resolution' },
        { name: 'questions', description: 'Question resolution & dismiss' },
        { name: 'tools', description: 'Tool & MCP server management' },
        { name: 'tasks', description: 'Background tasks' },
        { name: 'terminals', description: 'PTY terminal sessions' },
        { name: 'fs', description: 'Filesystem operations' },
        { name: 'files', description: 'File upload & download' },
      ],
    },
    transformObject: (documentObject: Record<string, unknown>) => {
      if (!('openapiObject' in documentObject)) {
        return (documentObject as { swaggerObject: unknown }).swaggerObject;
      }
      return transformOpenApiDocument(documentObject.openapiObject as Record<string, unknown>);
    },
  });
}

export function registerMetaDocumentRoutes(
  app: OpenApiHost,
  serverVersion: string,
  boundHost: string,
): void {
  app.get('/asyncapi.json', async (_req, reply) => {
    // Reflect the bound host, never the caller-supplied `Host` header (PLAN
    // §3.6-3: Host-header reflection is an information-leak / SSRF-adjacent
    // hole once the server is reachable beyond localhost).
    return reply.type('application/json').send(
      createAsyncApiDocument({ version: serverVersion, serverHost: boundHost }),
    );
  });
  app.get('/openapi.json', async (_req, reply) => {
    const openApiDocument = (app as unknown as { swagger(): unknown }).swagger();
    return reply.type('application/json').send(openApiDocument);
  });
}
