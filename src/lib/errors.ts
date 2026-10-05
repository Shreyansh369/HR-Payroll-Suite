export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_STATE"
  | "ENTITLEMENT"
  | "RATE_LIMITED"
  | "INTERNAL";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_STATE: 409,
  ENTITLEMENT: 402,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export interface FieldIssue {
  path: string;
  message: string;
}

/** An error that is safe to show to the user and to serialise across the RPC boundary. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly issues?: FieldIssue[];

  constructor(code: AppErrorCode, message: string, issues?: FieldIssue[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.issues = issues;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { code: this.code, message: this.message, issues: this.issues };
  }

  static from(value: unknown): AppError {
    if (value instanceof AppError) return value;
    if (value && typeof value === "object" && "code" in value && "message" in value) {
      const v = value as { code: AppErrorCode; message: string; issues?: FieldIssue[] };
      if (v.code in HTTP_STATUS) return new AppError(v.code, v.message, v.issues);
    }
    return new AppError("INTERNAL", "Something went wrong. Please try again.");
  }
}

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const invalidState = (message: string) => new AppError("INVALID_STATE", message);
export const validation = (message: string, issues?: FieldIssue[]) =>
  new AppError("VALIDATION", message, issues);
