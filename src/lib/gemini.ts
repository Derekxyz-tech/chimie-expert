class MockGeminiClient {
  models = {
    generateContent: async (params: any) => {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "An error occurred during generation.");
      }
      const data = await response.json();
      
      // Expose a getter for '.text' to match the real SDK's GenerateContentResponse structure
      return {
        ...data,
        get text() {
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
            return data.candidates[0].content.parts[0].text;
          }
          return data.text || "";
        }
      };
    },

    generateContentStream: async function* (params: any) {
      const response = await fetch("/api/gemini/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
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
              // Ensure getter is defined on each chunk
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
 * Returns true because keys are secure on the Express server.
 */
export function hasGeminiKey(): boolean {
  return true;
}

/**
 * Returns the secure backend API proxy client.
 */
export function getActiveGeminiClient(): any {
  return clientInstance;
}
