import type { ProblemDetail, Refusal } from "./types";

/** Base error for all Caged SDK errors. */
export class CagedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CagedError";
    // Restores the prototype chain when the package is consumed as CJS
    // compiled to ES5, where `instanceof` otherwise silently fails.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns a non-2xx response.
 *
 * The API answers errors with RFC 7807 problem details
 * (`{type, title, status, detail}`), which is where the human-readable
 * sentence lives. A handful of older handlers answer `{"error": "..."}`
 * instead; both are understood here so the caller always gets the server's
 * own sentence rather than a bare status code.
 */
export class CagedAPIError extends CagedError {
  /** HTTP status code. */
  public readonly status: number;
  /** Parsed problem detail, when the body was JSON. */
  public readonly problem: ProblemDetail | null;
  /** Raw response body, always retained. */
  public readonly body: string;
  /**
   * Machine-readable refusal reason, when the API classified this failure.
   * Branch on `reason.code`, never on the message text.
   */
  public readonly reason: Refusal | null;

  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(errorMessage(status, body, problem));
    this.name = "CagedAPIError";
    this.status = status;
    this.body = body;
    this.problem = problem;
    this.reason = extractReason(problem);
  }
}

/** Thrown for 401 and 403 — the API key is missing, invalid or unscoped. */
export class CagedAuthError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedAuthError";
  }
}

/** Thrown for 404 — the sandbox, snapshot or key does not exist. */
export class CagedNotFoundError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedNotFoundError";
  }
}

/** Thrown for 400 and 422 — the request was rejected by validation. */
export class CagedValidationError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedValidationError";
  }
}

/** Thrown for 429 — the account's rate limit or tier limit was hit. */
export class CagedRateLimitError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedRateLimitError";
  }
}

/**
 * Thrown when the account's plan does not allow the request.
 *
 * The API answers this with 403 and `reason.code === "plan_limit_reached"`.
 * Without this class it would arrive as a `CagedAuthError`, which reads as
 * "your key is wrong" when the key is fine and the plan is the problem.
 * `reason.action` is `"upgrade_plan"`.
 */
export class CagedPlanLimitError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedPlanLimitError";
  }
}

/** Thrown for 5xx — the API or a service behind it failed. */
export class CagedServerError extends CagedAPIError {
  constructor(status: number, body: string, problem: ProblemDetail | null) {
    super(status, body, problem);
    this.name = "CagedServerError";
  }
}

/** Thrown when a request exceeds the configured timeout. */
export class CagedTimeoutError extends CagedError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "CagedTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when the transport failed before a response arrived. */
export class CagedConnectionError extends CagedError {
  public readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "CagedConnectionError";
    this.cause = cause;
  }
}

function extractReason(problem: ProblemDetail | null): Refusal | null {
  const reason = problem?.reason;
  if (reason && typeof reason.code === "string" && reason.code !== "") {
    return reason;
  }
  return null;
}

function errorMessage(
  status: number,
  body: string,
  problem: ProblemDetail | null
): string {
  if (problem) {
    if (problem.detail) return problem.detail;
    if (problem.title) return `${problem.title} (HTTP ${status})`;
  }
  // Some handlers answer `{"error": "..."}` rather than problem details.
  const legacy = legacyErrorField(body);
  if (legacy) return legacy;
  const trimmed = body.trim();
  if (trimmed && trimmed.length <= 200) return `HTTP ${status}: ${trimmed}`;
  return `HTTP ${status}`;
}

function legacyErrorField(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return null;
}

/** Maps an HTTP status to the most specific error class for it. */
export function errorForStatus(
  status: number,
  body: string,
  problem: ProblemDetail | null
): CagedAPIError {
  // Checked before the status map: a plan limit and a bad key are both
  // 403, and telling a caller their key is invalid when it is not sends
  // them to the wrong fix.
  if (extractReason(problem)?.code === "plan_limit_reached") {
    return new CagedPlanLimitError(status, body, problem);
  }
  if (status === 401 || status === 403) {
    return new CagedAuthError(status, body, problem);
  }
  if (status === 404) return new CagedNotFoundError(status, body, problem);
  if (status === 400 || status === 422) {
    return new CagedValidationError(status, body, problem);
  }
  if (status === 429) return new CagedRateLimitError(status, body, problem);
  if (status >= 500) return new CagedServerError(status, body, problem);
  return new CagedAPIError(status, body, problem);
}
