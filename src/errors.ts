import * as z from "zod/v4";

export const ToolErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_INVALID_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "INTERNAL_ERROR",
]);

export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export class ToolFailure extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, publicMessage: string, options?: ErrorOptions) {
    super(publicMessage, options);
    this.name = "ToolFailure";
    this.code = code;
  }
}

export function normalizeToolFailure(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error;
  return new ToolFailure("INTERNAL_ERROR", "An internal error occurred.", { cause: error });
}
