import type { Request, Response, NextFunction } from "express";

const API_TOKEN = process.env.API_TOKEN;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_TOKEN) { next(); return; }
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token === API_TOKEN) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}
