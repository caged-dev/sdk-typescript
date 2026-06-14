/** Base error for all Caged SDK errors. */
export class CagedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CagedError";
  }
}

/** Thrown when the API returns a non-2xx response. */
export class CagedAPIError extends CagedError {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: string }).error)
        : `API error: ${status}`;
    super(message);
    this.name = "CagedAPIError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when a request exceeds the configured timeout. */
export class CagedTimeoutError extends CagedError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "CagedTimeoutError";
  }
}
