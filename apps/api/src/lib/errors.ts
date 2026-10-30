export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
    /** Extra fields of the JSON error body (e.g. chooseNumberUrl), next to error and message. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const notConfigured = (feature: string) => new HttpError(503, "not_configured", `${feature} is not configured on this server`);
export const unauthorized = (message = "Authentication required") => new HttpError(401, "unauthorized", message);
export const forbidden = (code = "forbidden", message?: string) => new HttpError(403, code, message);
export const notFound = (code = "not_found", message?: string) => new HttpError(404, code, message);
export const badRequest = (code = "invalid_request", message?: string) => new HttpError(400, code, message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
