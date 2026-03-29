import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface InterviewConfig {
  company: string;
  role: string;
  difficulty: "Entry Level" | "Mid Level" | "Senior" | "Expert";
  resumeText?: string;
}

export interface InterviewQuestion {
  question: string;
  category: "Technical" | "Behavioral" | "Situational";
}

export interface InterviewFeedback {
  score: number;
  strengths: string[];
  improvements: string[];
  overallFeedback: string;
}

export async function generateInitialQuestions(config: InterviewConfig): Promise<InterviewQuestion[]> {
  const resumeContext = config.resumeText 
    ? `\n\nCandidate Resume Content:\n${config.resumeText}\n\nPlease generate questions that probe deeper into the specific experiences, skills, and projects mentioned in the resume while still aligning with the company and role.`
    : "";

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate 5 interview questions for a ${config.role} position at ${config.company} with a difficulty level of ${config.difficulty}. 
    Include a mix of technical, behavioral, and situational questions.${resumeContext}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            category: { 
              type: Type.STRING,
              enum: ["Technical", "Behavioral", "Situational"]
            }
          },
          required: ["question", "category"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse initial questions", e);
    return [];
  }
}

export async function evaluateAnswer(
  config: InterviewConfig,
  question: string,
  answer: string
): Promise<{ feedback: string; score: number }> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Question: ${question}\nUser Answer: ${answer}\n\nEvaluate this answer for a ${config.role} role at ${config.company}. Provide constructive feedback and a score out of 10.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          feedback: { type: Type.STRING },
          score: { type: Type.NUMBER }
        },
        required: ["feedback", "score"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{"feedback": "Error evaluating answer", "score": 0}');
  } catch (e) {
    return { feedback: "Error evaluating answer", score: 0 };
  }
}

export async function generateFinalReport(
  config: InterviewConfig,
  history: { question: string; answer: string; feedback: string; score: number }[]
): Promise<InterviewFeedback> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on the following interview history for a ${config.role} at ${config.company}, provide a final report.\n\nHistory: ${JSON.stringify(history)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER, description: "Average score out of 100" },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          overallFeedback: { type: Type.STRING }
        },
        required: ["score", "strengths", "improvements", "overallFeedback"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return {
      score: 0,
      strengths: [],
      improvements: [],
      overallFeedback: "Error generating report"
    };
  }
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (e) {
    console.error("Speech generation failed", e);
    return null;
  }
}
