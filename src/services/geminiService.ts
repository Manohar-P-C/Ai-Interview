import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface InterviewConfig {
  company: string;
  role: string;
  difficulty: "Entry Level" | "Mid Level" | "Senior" | "Expert";
  persona: "Friendly" | "Strict" | "Technical Expert" | "Casual";
  resumeText?: string;
  jdText?: string;
  linkedinUrl?: string;
  interviewType: "Standard" | "Panel" | "Salary Negotiation" | "Blitz Prep";
}

export interface InterviewQuestion {
  question: string;
  category: "System Design" | "Data Structures" | "Algorithms" | "Technical" | "Behavioral" | "Situational" | "Leadership" | "Problem Solving";
}

export interface InterviewFeedback {
  score: number;
  strengths: string[];
  improvements: string[];
  overallFeedback: string;
}

export async function generateInitialQuestions(config: InterviewConfig): Promise<InterviewQuestion[]> {
  let personaContext = {
    "Friendly": "You are a supportive, encouraging interviewer who wants to see the candidate succeed. Your questions are approachable but still professional.",
    "Strict": "You are a demanding, high-pressure interviewer who focuses on precision and depth. You don't settle for surface-level answers.",
    "Technical Expert": "You are a deep-dive specialist who cares about implementation details, edge cases, and architectural trade-offs. You ask very specific, low-level technical questions.",
    "Casual": "You are a relaxed, conversational interviewer. You treat the interview like a chat between peers, focusing on culture fit and high-level problem solving."
  }[config.persona];

  if (config.interviewType === "Panel") {
    personaContext = "You are simulating a PANEL INTERVIEW with 3 distinct personas: 1. A Technical Lead (focuses on implementation), 2. An HR Manager (focuses on culture and behavior), and 3. A Product Manager (focuses on business impact). Each question should clearly state which 'interviewer' is asking it.";
  } else if (config.interviewType === "Salary Negotiation") {
    personaContext = "You are a tough but fair HR Director or Hiring Manager. The focus of this interview is EXCLUSIVELY on compensation, benefits, and negotiation. You will push back on high demands and ask for justification of value.";
  }

  const resumeContext = config.resumeText 
    ? `\n\nCandidate Resume Content:\n${config.resumeText}\n\nPlease generate questions that probe deeper into the specific experiences, skills, and projects mentioned in the resume while still aligning with the company and role.`
    : "";

  const jdContext = config.jdText
    ? `\n\nJob Description:\n${config.jdText}\n\nStrictly align the questions with the requirements and keywords found in this job description.`
    : "";

  const linkedinContext = config.linkedinUrl
    ? `\n\nCandidate LinkedIn Profile URL: ${config.linkedinUrl}\n\nPlease use the content from this LinkedIn profile to further personalize the interview questions and context.`
    : "";

  const questionCount = config.interviewType === "Blitz Prep" ? 3 : 5;

  const tools: any[] = [];
  if (config.linkedinUrl) {
    tools.push({ urlContext: {} });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${personaContext}
    Generate ${questionCount} interview questions for a ${config.role} position at ${config.company} with a difficulty level of ${config.difficulty}. 
    
    CRITICAL INSTRUCTION: The VERY FIRST question MUST be an introductory question like "Tell me about yourself" or "Walk me through your background". 
    The subsequent questions should be a mix of granular categories such as System Design, Data Structures, Algorithms, Behavioral, Situational, and Leadership where appropriate for the role.${resumeContext}${jdContext}${linkedinContext}`,
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
              enum: ["Introductory", "System Design", "Data Structures", "Algorithms", "Technical", "Behavioral", "Situational", "Leadership", "Problem Solving", "Negotiation"]
            }
          },
          required: ["question", "category"]
        }
      },
      tools: tools.length > 0 ? tools : undefined
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
  const personaContext = {
    "Friendly": "You are a supportive, encouraging interviewer. Your feedback is constructive, positive, and gentle. You focus on what the candidate did well while kindly suggesting improvements.",
    "Strict": "You are a demanding, high-pressure interviewer. Your feedback is blunt, direct, and focuses heavily on missed details or lack of depth. You have very high standards.",
    "Technical Expert": "You are a deep-dive specialist. Your feedback is highly technical, focusing on efficiency, architecture, and edge cases. You care about the 'how' and 'why' behind the answer.",
    "Casual": "You are a relaxed, conversational interviewer. Your feedback is informal and focuses on how well the candidate communicated their ideas and their overall vibe."
  }[config.persona];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${personaContext}\n\nQuestion: ${question}\nUser Answer: ${answer}\n\nEvaluate this answer for a ${config.role} role at ${config.company}. Provide constructive feedback and a score out of 10.`,
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
  const personaContext = {
    "Friendly": "You are a supportive, encouraging interviewer. Your final report is motivating and highlights the candidate's potential.",
    "Strict": "You are a demanding, high-pressure interviewer. Your final report is rigorous and highlights every gap in the candidate's performance.",
    "Technical Expert": "You are a deep-dive specialist. Your final report focuses on technical mastery and architectural thinking.",
    "Casual": "You are a relaxed, conversational interviewer. Your final report focuses on communication and cultural fit."
  }[config.persona];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${personaContext}\n\nBased on the following interview history for a ${config.role} at ${config.company}, provide a final report.\n\nHistory: ${JSON.stringify(history)}`,
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

export async function generateSuggestion(
  config: InterviewConfig,
  question: string,
  history: { question: string; answer: string }[]
): Promise<string> {
  const personaContext = {
    "Friendly": "You are a supportive, encouraging interviewer. Your suggestion should be helpful and build the candidate's confidence.",
    "Strict": "You are a demanding, high-pressure interviewer. Your suggestion should focus on how to meet extremely high standards and provide deep technical detail.",
    "Technical Expert": "You are a deep-dive specialist. Your suggestion should focus on implementation details, edge cases, and architectural trade-offs.",
    "Casual": "You are a relaxed, conversational interviewer. Your suggestion should focus on clear communication and storytelling."
  }[config.persona];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      You are an expert interview coach acting as a ${config.persona} interviewer. 
      ${personaContext}
      The user is interviewing for the position of ${config.role} at ${config.company} with a difficulty level of ${config.difficulty}.
      The current question is: "${question}"
      
      Previous conversation history:
      ${history.length > 0 ? history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n') : "No previous history."}
      
      Provide a concise, high-impact suggestion on how to answer this specific question. 
      Focus on key points to hit, structure (like STAR method if applicable), and what ${config.company} might be looking for in this role.
      Keep it under 100 words.
    `,
  });

  return response.text || "No suggestion available.";
}

export async function processResumeText(rawText: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      You are an expert resume parser. 
      Below is the raw text extracted from a resume PDF. 
      Please clean it up, structure it logically (Contact, Summary, Experience, Education, Skills), 
      and ensure it's concise but retains all key information (dates, roles, technologies, achievements).
      
      Raw Text:
      ${rawText}
      
      Return the structured resume in a clean Markdown format.
    `,
  });

  return response.text || rawText;
}

export interface PreparationPlan {
  studyPlan: string;
  companyInsights: string;
  roleSpecificTips: string;
  commonQuestions: string[];
}

export async function generatePreparationPlan(config: InterviewConfig): Promise<PreparationPlan> {
  const tools: any[] = [];
  if (config.linkedinUrl) {
    tools.push({ urlContext: {} });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      You are an expert interview coach. 
      The user is preparing for a ${config.role} position at ${config.company} with a difficulty level of ${config.difficulty}.
      ${config.resumeText ? `Based on their resume: ${config.resumeText}` : ""}
      ${config.jdText ? `Based on the Job Description: ${config.jdText}` : ""}
      ${config.linkedinUrl ? `Based on their LinkedIn Profile: ${config.linkedinUrl}` : ""}
      
      Generate a comprehensive preparation plan. 
      Include:
      1. A step-by-step study plan.
      2. Insights about ${config.company}'s interview process and culture.
      3. Specific tips for the ${config.role} role.
      4. A list of 5 common questions they should prepare for.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          studyPlan: { type: Type.STRING, description: "Markdown formatted study plan" },
          companyInsights: { type: Type.STRING, description: "Markdown formatted company insights" },
          roleSpecificTips: { type: Type.STRING, description: "Markdown formatted role tips" },
          commonQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["studyPlan", "companyInsights", "roleSpecificTips", "commonQuestions"]
      },
      tools: tools.length > 0 ? tools : undefined
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return {
      studyPlan: "Error generating plan",
      companyInsights: "Error generating plan",
      roleSpecificTips: "Error generating plan",
      commonQuestions: []
    };
  }
}

export interface BlitzPrep {
  top3Insights: string[];
  talkingPoints: string[];
  emergencyTips: string[];
}

export async function generateBlitzPrep(config: InterviewConfig): Promise<BlitzPrep> {
  const tools: any[] = [];
  if (config.linkedinUrl) {
    tools.push({ urlContext: {} });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      You are an expert interview coach. 
      The user has an interview in 1 hour for a ${config.role} position at ${config.company}.
      ${config.jdText ? `Job Description: ${config.jdText}` : ""}
      ${config.resumeText ? `Resume: ${config.resumeText}` : ""}
      ${config.linkedinUrl ? `LinkedIn Profile: ${config.linkedinUrl}` : ""}
      
      Provide an EMERGENCY BLITZ PREP guide.
      1. Top 3 critical insights about ${config.company}.
      2. 5 high-impact talking points for this specific candidate and role.
      3. 3 emergency tips for staying calm and performing well.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          top3Insights: { type: Type.ARRAY, items: { type: Type.STRING } },
          talkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          emergencyTips: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["top3Insights", "talkingPoints", "emergencyTips"]
      },
      tools: tools.length > 0 ? tools : undefined
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return { top3Insights: [], talkingPoints: [], emergencyTips: [] };
  }
}

export interface SkillTree {
  communication: number;
  technicalDepth: number;
  problemSolving: number;
  culturalFit: number;
  negotiation: number;
}

export async function calculateSkillTree(history: { score: number; category: string }[]): Promise<SkillTree> {
  const tree: SkillTree = {
    communication: 0,
    technicalDepth: 0,
    problemSolving: 0,
    culturalFit: 0,
    negotiation: 0
  };

  const counts: Record<keyof SkillTree, number> = {
    communication: 0,
    technicalDepth: 0,
    problemSolving: 0,
    culturalFit: 0,
    negotiation: 0
  };

  history.forEach(item => {
    let category: keyof SkillTree = "communication";
    if (["System Design", "Technical", "Data Structures", "Algorithms"].includes(item.category)) category = "technicalDepth";
    if (["Problem Solving", "Situational"].includes(item.category)) category = "problemSolving";
    if (["Behavioral", "Leadership", "Introductory"].includes(item.category)) category = "culturalFit";
    if (item.category === "Negotiation") category = "negotiation";

    tree[category] += item.score;
    counts[category]++;
  });

  Object.keys(tree).forEach(key => {
    const k = key as keyof SkillTree;
    if (counts[k] > 0) {
      tree[k] = Math.round((tree[k] / (counts[k] * 10)) * 100);
    }
  });

  return tree;
}
