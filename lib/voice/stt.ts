// Speech-to-text leg via Gemini generateContent multimodal transcription.
// Kimi (Bedrock) is the conversation brain — Gemini here only turns audio into text.

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_STT_MODEL || "gemini-2.5-flash";

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe verbatim what the speaker says in this audio clip. Output ONLY the transcript text, with no preamble, quotes, or commentary. If the audio is silent or unintelligible, output an empty string.",
              },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini STT failed: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return (text || "").trim();
}
