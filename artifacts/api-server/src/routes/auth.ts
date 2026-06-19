import { Router, type IRouter } from "express";
import { generateToken, verifyToken } from "../lib/authToken";
import { AuthLoginBody, AuthLoginResponse, AuthVerifyResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", (req, res): void => {
  const parsed = AuthLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const expected = process.env["DASHBOARD_PASSWORD"] ?? "";
  if (!expected) {
    res.status(500).json({ error: "DASHBOARD_PASSWORD is not configured" });
    return;
  }

  if (parsed.data.password !== expected) {
    res.status(401).json({ error: "Password salah" });
    return;
  }

  const token = generateToken();
  res.json(AuthLoginResponse.parse({ token }));
});

router.get("/auth/verify", (req, res): void => {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (verifyToken(token)) {
    res.json(AuthVerifyResponse.parse({ ok: true }));
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

export default router;
