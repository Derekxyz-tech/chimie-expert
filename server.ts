import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Initialize Gemini AI securely server-side
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({
    apiKey: apiKey || "dummy-key",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const getFallbackModels = (requestedModel: string): string[] => {
    const defaults = [
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-3.1-pro-preview"
    ];
    const list = [requestedModel];
    for (const m of defaults) {
      if (!list.includes(m)) {
        list.push(m);
      }
    }
    return list;
  };

  async function generateContentWithFallback(requestedModel: string, contents: any, config: any) {
    const modelsToTry = getFallbackModels(requestedModel || "gemini-3.5-flash");
    let lastError: any = null;
    for (const model of modelsToTry) {
      try {
        console.log(`[Gemini Proxy] Attempting generateContent with model: ${model}`);
        const response = await ai.models.generateContent({
          model,
          contents,
          config
        });
        console.log(`[Gemini Proxy] Successfully generated content using model: ${model}`);
        return response;
      } catch (err: any) {
        lastError = err;
        console.error(`[Gemini Proxy] Error generating content with model ${model}:`, err?.message || err);
      }
    }
    throw lastError || new Error("All generative models failed to respond.");
  }

  async function* generateContentStreamWithFallback(requestedModel: string, contents: any, config: any) {
    const modelsToTry = getFallbackModels(requestedModel || "gemini-3.5-flash");
    let lastError: any = null;
    for (const model of modelsToTry) {
      try {
        console.log(`[Gemini Proxy] Attempting generateContentStream with model: ${model}`);
        const responseStream = await ai.models.generateContentStream({
          model,
          contents,
          config
        });
        for await (const chunk of responseStream) {
          yield chunk;
        }
        console.log(`[Gemini Proxy] Successfully completed stream using model: ${model}`);
        return;
      } catch (err: any) {
        lastError = err;
        console.error(`[Gemini Proxy] Error streaming content with model ${model}:`, err?.message || err);
      }
    }
    throw lastError || new Error("All streaming models failed to respond.");
  }

  // API Route - Healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", hasKey: !!process.env.GEMINI_API_KEY });
  });

  // API Route - Single response generation
  app.post("/api/gemini/generate", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({
          error: "The Google Gemini API key is not configured. Please add the GEMINI_API_KEY environment variable in Google AI Studio Settings > Secrets or Vercel Settings to activate AI features."
        });
      }
      const { model, contents, config } = req.body;
      const response = await generateContentWithFallback(model, contents, config);
      res.json(response);
    } catch (error: any) {
      console.error("Generate error:", error);
      res.status(500).json({ error: error?.message || "An error occurred during generation." });
    }
  });

  // API Route - Streaming response generation
  app.post("/api/gemini/stream", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(400).end("The Google Gemini API key is not configured.");
      }
      const { model, contents, config } = req.body;
      const responseStream = generateContentStreamWithFallback(model, contents, config);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of responseStream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Stream error:", error);
      if (!res.headersSent) {
        res.status(500).end(error?.message || "An error occurred during streaming.");
      } else {
        res.write(`data: ${JSON.stringify({ error: error?.message })}\n\n`);
        res.end();
      }
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
