// src/server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { answerUser } from "./agent/agent";

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

// Healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Chat (JSON request/response)
app.post("/chat", async (req, res) => {
  try {
    const { message } = (req.body ?? {}) as { message?: string };
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Body must include { message: string }" });
    }
    const data = await answerUser(message);
    return res.json(data);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, "0.0.0.0", () => {
  console.log(`API on http://localhost:${port}`);
});
