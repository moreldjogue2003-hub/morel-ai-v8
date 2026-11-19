import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "1mb" }));

// Serve the MOREL AI V8 web interface without exposing backend files.
app.use(express.static("public", { index: "index.html" }));

const allowedOrigin = process.env.APP_ORIGIN;
app.use(cors({
  origin: allowedOrigin ? allowedOrigin.split(",").map(v => v.trim()) : false,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "MOREL AI V8",
    status: "server-ready",
    hedraConfigured: Boolean(process.env.HEDRA_API_KEY)
  });
});

/*
 * Hedra Character 3 v3 proxy.
 * The secret is read only from the hosting environment.
 * The caller must provide Hedra-compatible start_image and audio
 * inputs. The API key is read only from the hosting environment.
 */
app.post("/api/hedra/generate", async (req, res) => {
  if (!process.env.HEDRA_API_KEY) {
    return res.status(503).json({
      error: "Hedra API key is not configured on the server."
    });
  }

  const input = req.body?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({
      error: "Expected a JSON object with an input object."
    });
  }

  const allowedRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "9:21", "21:9"];
  const allowedResolutions = ["540p", "720p", "1080p"];

  const requiredFields = ["prompt", "aspect_ratio", "resolution", "start_image", "audio"];
  const missingFields = requiredFields.filter(
    field => input[field] === undefined || input[field] === null || input[field] === ""
  );
  if (missingFields.length) {
    return res.status(400).json({
      error: "Missing required Hedra Character 3 input fields.",
      missing: missingFields
    });
  }

  if (!allowedRatios.includes(input.aspect_ratio)) {
    return res.status(400).json({ error: "Unsupported aspect_ratio." });
  }
  if (!allowedResolutions.includes(input.resolution)) {
    return res.status(400).json({ error: "Unsupported resolution." });
  }
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    return res.status(400).json({ error: "prompt must be a non-empty string." });
  }
  if (!(typeof input.audio === "string" || (Array.isArray(input.audio) && input.audio.length > 0))) {
    return res.status(400).json({ error: "audio must be an audio reference or a non-empty list of references." });
  }

  try {
    const response = await fetch(
      "https://api.hedra.com/v3/models/hedra-character-3",
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${process.env.HEDRA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ input })
      }
    );

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw.slice(0, 1000) };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Hedra rejected the generation request.",
        details: data
      });
    }

    return res.status(202).json(data);
  } catch (error) {
    console.error("Hedra request failed:", error.message);
    return res.status(502).json({
      error: "Unable to reach Hedra. Please try again."
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`MOREL AI V8 server listening on port ${PORT}`);
});
