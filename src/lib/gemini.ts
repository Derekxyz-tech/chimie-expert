// Gemini AI Client Manager with Client-Side Fallback for Standalone Vercel Hosting

let isBackendHealthy: boolean | null = null;

/**
 * Checks if the server-side Express proxy backend is available and healthy (e.g., inside AI Studio).
 */
async function checkBackendHealth(): Promise<boolean> {
  if (isBackendHealthy !== null) return isBackendHealthy;
  try {
    const response = await fetch("/api/health");
    if (response.ok) {
      const data = await response.json();
      isBackendHealthy = data && data.status === "ok";
    } else {
      isBackendHealthy = false;
    }
  } catch (err) {
    isBackendHealthy = false;
  }
  return isBackendHealthy;
}

/**
 * Maps the standard SDK parameters (like contents, config, model) to the Google REST API schema.
 */
function mapParamsToRest(params: any) {
  const model = params.model || "gemini-3.5-flash";
  const restBody: any = {
    contents: params.contents,
  };
  if (params.config) {
    const { systemInstruction, ...generationConfig } = params.config;
    if (systemInstruction) {
      restBody.systemInstruction = {
        parts: typeof systemInstruction === "string"
          ? [{ text: systemInstruction }]
          : systemInstruction.parts || [{ text: JSON.stringify(systemInstruction) }]
      };
    }
    if (Object.keys(generationConfig).length > 0) {
      restBody.generationConfig = generationConfig;
    }
  }
  return { model, restBody };
}

class MockGeminiClient {
  models = {
    generateContent: async (params: any) => {
      const { signal, ...restParams } = params;
      const isHealthy = await checkBackendHealth();
      
      if (isHealthy) {
        // Option A: Proxy through the secure backend server (AI Studio Container)
        const response = await fetch("/api/gemini/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(restParams),
          signal,
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "An error occurred during generation.");
        }
        const data = await response.json();
        
        return {
          ...data,
          get text() {
            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
              return data.candidates[0].content.parts[0].text;
            }
            return data.text || "";
          }
        };
      } else {
        // Option B: Fall back to direct REST client-side communication (Vercel Standalone Hosting)
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error(
            "⚠️ Erreur de configuration de la Clé API :\n\n" +
            "Le site est hébergé en mode statique (ex: Vercel) sans backend Express proxy actif.\n" +
            "Pour activer l'IA en production, vous devez ajouter la variable d'environnement VITE_GEMINI_API_KEY " +
            "dans les paramètres de votre projet Vercel (Vercel Dashboard > Settings > Environment Variables)."
          );
        }
        
        const { model, restBody } = mapParamsToRest(restParams);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(restBody),
            signal,
          }
        );
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || "Erreur de génération directe de l'API Gemini sur l'hôte statique.");
        }
        const data = await response.json();
        
        return {
          ...data,
          get text() {
            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
              return data.candidates[0].content.parts[0].text;
            }
            return data.text || "";
          }
        };
      }
    },

    generateContentStream: async function* (params: any) {
      const { signal, ...restParams } = params;
      const isHealthy = await checkBackendHealth();
      
      if (isHealthy) {
        // Option A: Proxy through the secure backend server (AI Studio Container)
        const response = await fetch("/api/gemini/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(restParams),
          signal,
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown stream error");
          throw new Error(errText);
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === "[DONE]") continue;
              try {
                const chunkObj = JSON.parse(jsonStr);
                const chunkWithText = {
                  ...chunkObj,
                  get text() {
                    if (chunkObj.candidates && chunkObj.candidates[0] && chunkObj.candidates[0].content && chunkObj.candidates[0].content.parts && chunkObj.candidates[0].content.parts[0]) {
                      return chunkObj.candidates[0].content.parts[0].text;
                    }
                    return chunkObj.text || "";
                  }
                };
                yield chunkWithText;
              } catch (e) {
                console.error("Failed to parse chunk", e);
              }
            }
          }
        }
      } else {
        // Option B: Fall back to direct REST client-side streaming (Vercel Standalone Hosting)
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error(
            "⚠️ Erreur de configuration de la Clé API :\n\n" +
            "Le site est hébergé en mode statique (ex: Vercel) sans backend Express proxy actif.\n" +
            "Pour activer le streaming de l'IA en production, ajoutez la variable d'environnement VITE_GEMINI_API_KEY " +
            "dans votre tableau de bord de configuration Vercel."
          );
        }
        
        const { model, restBody } = mapParamsToRest(params);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(restBody),
            signal,
          }
        );
        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown direct stream error");
          throw new Error(errText);
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === "[DONE]") continue;
              try {
                const chunkObj = JSON.parse(jsonStr);
                const chunkWithText = {
                  ...chunkObj,
                  get text() {
                    if (chunkObj.candidates && chunkObj.candidates[0] && chunkObj.candidates[0].content && chunkObj.candidates[0].content.parts && chunkObj.candidates[0].content.parts[0]) {
                      return chunkObj.candidates[0].content.parts[0].text;
                    }
                    return chunkObj.text || "";
                  }
                };
                yield chunkWithText;
              } catch (e) {
                console.error("Failed to parse chunk", e);
              }
            }
          }
        }
      }
    }
  };
}

const clientInstance = new MockGeminiClient();

/**
 * Returns the Gemini proxy client.
 */
export function getGeminiClient(): any {
  return clientInstance;
}

/**
 * Returns true if an API key is present either client-side or server-side.
 */
export function hasGeminiKey(): boolean {
  return !!import.meta.env.VITE_GEMINI_API_KEY || isBackendHealthy !== false;
}

/**
 * Returns the secure backend API proxy client.
 */
export function getActiveGeminiClient(): any {
  return clientInstance;
}
