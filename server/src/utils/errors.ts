export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const notFound = (code: string, msg: string) => new AppError(404, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
