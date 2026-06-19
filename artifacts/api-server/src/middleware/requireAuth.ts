import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/authToken";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (verifyToken(token)) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}
