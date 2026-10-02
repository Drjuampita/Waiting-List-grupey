export type ApiCode =
  | 'registered'
  | 'invalid_email'
  | 'invalid_request'
  | 'forbidden_origin'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal_error'
  | 'service_unavailable'
  | 'timeout';

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      ...headers,
    },
  });
}

export function apiResponse(
  status: number,
  code: ApiCode,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { ok: status === 200, code, request_id: requestId }, requestId, headers);
}

/** Fallback sin JavaScript: el formulario nativo termina en una página, nunca en JSON. */
export function redirectResponse(location: string, requestId: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  });
}

export function requestIdOf(request: Request): string {
  const vercelId = request.headers.get('x-vercel-id');
  // Solo se refleja si tiene el formato de Vercel (p. ej. "iad1::abc12-123"); nunca texto arbitrario.
  return vercelId && /^[a-z0-9]{1,10}(::[a-z0-9-]{1,64}){1,4}$/i.test(vercelId) ? vercelId : crypto.randomUUID();
}
