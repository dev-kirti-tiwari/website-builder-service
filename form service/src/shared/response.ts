import type { Request, Response } from 'express';

/** Standard success envelope. All successful calls return HTTP 200. */
export function ok(req: Request, res: Response, message: string, data: unknown): void {
  res.status(200).json({ success: true, message, data, meta: { requestId: req.requestId } });
}
