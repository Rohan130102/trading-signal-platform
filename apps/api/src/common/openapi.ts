import { z } from 'zod';

interface RouteDoc {
  summary?: string;
  body?: z.ZodType;
  query?: z.ZodType;
}

const docs = new Map<object, Map<string, RouteDoc>>();

export function registerRouteDoc(target: object, method: string, doc: RouteDoc): void {
  const controller = target.constructor;
  const methods = docs.get(controller) ?? new Map<string, RouteDoc>();
  methods.set(method, { ...methods.get(method), ...doc });
  docs.set(controller, methods);
}

const VERBS = ['get', 'post', 'put', 'delete', 'patch'];

function jsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });
}

/**
 * Builds the OpenAPI document from the controllers themselves and the Zod schemas that validate
 * requests, so the documentation cannot drift from what the server actually enforces.
 */
export function buildOpenApi(controllers: (new (...args: never[]) => object)[], globalPrefix: string): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata('path', controller) ?? '');
    const isClassPublic = Reflect.getMetadata('sd:public', controller) === true;
    const isClassAdmin = Reflect.getMetadata('sd:roles', controller) !== undefined;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name as keyof object] as unknown as object;
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const methodCode = Reflect.getMetadata('method', handler) as number | undefined;
      const route = Reflect.getMetadata('path', handler) as string | undefined;
      if (methodCode === undefined || route === undefined) continue;
      const verb = VERBS[methodCode];
      if (!verb) continue;

      // Health checks sit outside the versioned API prefix, for load balancers.
      const joined = [base === 'health' ? '' : globalPrefix, base, route]
        .filter((s) => s && s !== '/')
        .join('/')
        .replace(/\/+/g, '/')
        .replace(/:([a-zA-Z]+)/g, '{$1}');
      const path = `/${joined}`.replace(/\/+/g, '/');
      const doc = docs.get(controller)?.get(name) ?? {};
      const isPublic = isClassPublic || Reflect.getMetadata('sd:public', handler) === true;
      const isAdmin = isClassAdmin || Reflect.getMetadata('sd:roles', handler) !== undefined;
      const needsAccess =
        Reflect.getMetadata('sd:signal-access', controller) === true ||
        Reflect.getMetadata('sd:signal-access', handler) === true;

      const parameters: unknown[] = [...path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      if (doc.query) {
        const schema = jsonSchema(doc.query) as { properties?: Record<string, unknown>; required?: string[] };
        for (const [key, value] of Object.entries(schema.properties ?? {})) {
          parameters.push({ name: key, in: 'query', required: schema.required?.includes(key) ?? false, schema: value });
        }
      }
      (paths[path] ??= {})[verb] = {
        summary: doc.summary ?? name,
        tags: [String(controller.name).replace(/Controller$/, '')],
        security: isPublic ? [] : [{ session: [] }],
        'x-access': isPublic ? 'public' : isAdmin ? 'admin' : needsAccess ? 'active-subscription' : 'authenticated',
        parameters,
        ...(doc.body
          ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(doc.body) } } } }
          : {}),
        responses: {
          '2XX': { description: 'Success' },
          default: {
            description: 'Error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      };
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'SignalDesk API',
      version: '1.0.0',
      description:
        'Signal communication platform. It does not place orders. State-changing requests must carry an allowed Origin header.',
    },
    paths,
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'sd_session' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
