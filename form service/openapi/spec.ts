/** OpenAPI 3.1 description of the Form API. tests/integration/openapi.test.ts checks it against the live routes. */

type Op = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; summary: string; public?: boolean };

export const OPERATIONS: Op[] = [
  { method: 'post', path: '/websites/{websiteId}/forms', summary: 'Create form' },
  { method: 'get', path: '/websites/{websiteId}/forms', summary: 'List forms' },
  { method: 'get', path: '/forms/{formId}', summary: 'Get form with fields' },
  { method: 'patch', path: '/forms/{formId}', summary: 'Update form' },
  { method: 'delete', path: '/forms/{formId}', summary: 'Soft-delete form' },
  { method: 'post', path: '/forms/{formId}/fields', summary: 'Create field' },
  { method: 'patch', path: '/forms/{formId}/fields/{fieldId}', summary: 'Update field' },
  { method: 'post', path: '/forms/{formId}/publish', summary: 'Publish immutable schema version' },
  { method: 'post', path: '/public/forms/{formId}/submissions', summary: 'Submit to published form', public: true },
  { method: 'get', path: '/forms/{formId}/submissions', summary: 'List submissions' },
  { method: 'get', path: '/forms/{formId}/submissions/{submissionId}', summary: 'Get submission' },
  { method: 'patch', path: '/forms/{formId}/submissions/{submissionId}', summary: 'Update submission status/metadata' },
  { method: 'get', path: '/forms/{formId}/automations', summary: 'List automations' },
  { method: 'post', path: '/forms/{formId}/automations', summary: 'Create automation' },
];

const pathParams = (path: string) =>
  [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' },
  }));

export function buildSpec() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    (paths[op.path] ??= {})[op.method] = {
      summary: op.summary,
      security: op.public ? [] : [{ bearerAuth: [] }],
      parameters: pathParams(op.path),
      responses: {
        '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '404': { $ref: '#/components/responses/Error' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Form API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: true },
            message: { type: 'string' },
            data: {},
            meta: { type: 'object', properties: { requestId: { type: 'string' } } },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: false },
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: {} } },
            },
            meta: { type: 'object', properties: { requestId: { type: 'string' } } },
          },
        },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}
