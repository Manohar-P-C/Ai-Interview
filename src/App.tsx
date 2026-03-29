/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, 
  Briefcase, 
  Trophy, 
  ArrowRight, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  User,
  Bot,
  RefreshCcw,
  Star,
  FileText,
  Upload,
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from 'lucide-react';
import { cn } from './lib/utils';
import * as pdfjs from 'pdfjs-dist';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
import { 
  generateInitialQuestions, 
  evaluateAnswer, 
  generateFinalReport,
  generateSpeech,
  type InterviewConfig, 
  type InterviewQuestion,
  type InterviewFeedback 
} from './services/geminiService';
import Markdown from 'react-markdown';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  type User,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';

type AppState = 'landing' | 'loading' | 'interview' | 'feedback';

interface InterviewHistoryItem {
  question: string;
  answer: string;
  feedback: string;
  score: number;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [state, setState] = useState<AppState>('landing');
  const [config, setConfig] = useState<InterviewConfig>({
    company: '',
    role: '',
    difficulty: 'Mid Level'
  });
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [history, setHistory] = useState<InterviewHistoryItem[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [finalReport, setFinalReport] = useState<InterviewFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [currentInterviewId, setCurrentInterviewId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        // Sync user profile to Firestore
        try {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: Timestamp.now()
          }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        }
      } else {
        setUser(null);
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError('Failed to sign in. Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      resetInterview();
    } catch (err) {
      setError('Failed to sign out.');
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setUserAnswer(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  useEffect(() => {
    if (state === 'interview' && autoSpeak && questions.length > 0) {
      speakText(questions[currentQuestionIndex].question);
    }
  }, [state, currentQuestionIndex, questions]);

  const speakText = async (text: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/pcm' }); // Note: Gemini TTS returns raw PCM 24kHz
        
        // Since it's raw PCM, we need to wrap it or use AudioContext
        // For simplicity, let's try to use the standard Audio element if the browser supports it, 
        // but raw PCM usually needs a header. 
        // Actually, the instructions say "decode and play audio with sample rate 24000".
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
        const nowBuffering = audioBuffer.getChannelData(0);
        
        // Convert 16-bit PCM to float
        const dataView = new DataView(bytes.buffer);
        for (let i = 0; i < bytes.length / 2; i++) {
          nowBuffering[i] = dataView.getInt16(i * 2, true) / 32768;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error('Speech playback failed', err);
      setIsSpeaking(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setUserAnswer('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingResume(true);
    setError(null);
    setResumeFileName(file.name);

    try {
      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPDF(file);
      } else if (file.type === 'text/plain') {
        text = await file.text();
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or TXT file.');
      }

      if (text.trim().length < 50) {
        throw new Error('Resume content seems too short. Please ensure the file contains text.');
      }

      setConfig(prev => ({ ...prev, resumeText: text }));
    } catch (err: any) {
      setError(err.message || 'Failed to parse resume.');
      setResumeFileName(null);
    } finally {
      setIsParsingResume(false);
    }
  };

  const removeResume = () => {
    setResumeFileName(null);
    setConfig(prev => ({ ...prev, resumeText: undefined }));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isEvaluating]);

  const startInterview = async () => {
    if (!config.company || !config.role) {
      setError('Please fill in both company and role.');
      return;
    }
    setError(null);
    setState('loading');
    try {
      const qs = await generateInitialQuestions(config);
      setQuestions(qs);
      
      // Create interview session in Firestore if logged in
      if (user) {
        try {
          const docRef = await addDoc(collection(db, 'interviews'), {
            uid: user.uid,
            company: config.company,
            role: config.role,
            difficulty: config.difficulty,
            status: 'started',
            createdAt: Timestamp.now(),
            history: []
          });
          setCurrentInterviewId(docRef.id);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'interviews');
        }
      }
      
      setState('interview');
    } catch (err) {
      setError('Failed to start interview. Please try again.');
      setState('landing');
    }
  };

  const handleAnswerSubmit = async () => {
    if (!userAnswer.trim()) return;

    setIsEvaluating(true);
    const currentQuestion = questions[currentQuestionIndex].question;
    const answer = userAnswer;
    setUserAnswer('');

    try {
      const evaluation = await evaluateAnswer(config, currentQuestion, answer);
      const newHistoryItem = {
        question: currentQuestion,
        answer: answer,
        feedback: evaluation.feedback,
        score: evaluation.score
      };
      
      const updatedHistory = [...history, newHistoryItem];
      setHistory(updatedHistory);
      
      // Update Firestore history
      if (user && currentInterviewId) {
        try {
          await updateDoc(doc(db, 'interviews', currentInterviewId), {
            history: updatedHistory
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `interviews/${currentInterviewId}`);
        }
      }

      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        // End of interview
        setState('loading');
        const report = await generateFinalReport(config, updatedHistory);
        setFinalReport(report);
        
        // Update final report in Firestore
        if (user && currentInterviewId) {
          try {
            await updateDoc(doc(db, 'interviews', currentInterviewId), {
              status: 'completed',
              score: report.score,
              finalReport: report
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `interviews/${currentInterviewId}`);
          }
        }
        
        setState('feedback');
      }
    } catch (err) {
      setError('Evaluation failed. Please try again.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const resetInterview = () => {
    setState('landing');
    setConfig({ company: '', role: '', difficulty: 'Mid Level' });
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setHistory([]);
    setFinalReport(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={resetInterview}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">InterviewAI</span>
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm font-medium text-gray-500">
            <button 
              onClick={() => setShowHowItWorks(true)}
              className="hover:text-blue-600 transition-colors"
            >
              How it works
            </button>
            <button 
              onClick={() => setShowResources(true)}
              className="hover:text-blue-600 transition-colors"
            >
              Resources
            </button>
            {isAuthLoading ? (
              <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <img 
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=random`} 
                    alt="" 
                    className="w-8 h-8 rounded-full border border-gray-200" 
                    referrerPolicy="no-referrer"
                  />
                  <span className="text-sm font-bold text-gray-700 hidden sm:inline">{user.displayName || 'User'}</span>
                </div>
                <button 
                  onClick={handleSignOut}
                  className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-red-600 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button 
                onClick={handleSignIn}
                className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-all shadow-sm flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="pt-24 pb-12 px-6 max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {state === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div className="space-y-8">
                <div className="space-y-4">
                  <motion.span 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-wider rounded-full"
                  >
                    AI-Powered Career Growth
                  </motion.span>
                  <h1 className="text-5xl sm:text-6xl font-extrabold leading-[1.1] tracking-tight">
                    Master your next <span className="text-blue-600">interview</span> with confidence.
                  </h1>
                  <p className="text-lg text-gray-600 max-w-md">
                    Personalized mock interviews for any company and role. Get instant feedback and improve your performance.
                  </p>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-blue-500" />
                        Target Company
                      </label>
                      <input 
                        type="text"
                        placeholder="e.g. Google, Stripe, Local Startup"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                        value={config.company}
                        onChange={(e) => setConfig({ ...config, company: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-blue-500" />
                        Job Role
                      </label>
                      <input 
                        type="text"
                        placeholder="e.g. Software Engineer, Product Manager"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                        value={config.role}
                        onChange={(e) => setConfig({ ...config, role: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                        Resume (Optional)
                      </label>
                      {!resumeFileName ? (
                        <div className="relative group">
                          <input 
                            type="file"
                            accept=".pdf,.txt"
                            onChange={handleResumeUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                          <div className="w-full px-4 py-3 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center gap-2 text-gray-500 group-hover:border-blue-300 group-hover:bg-blue-50 transition-all">
                            {isParsingResume ? (
                              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                            ) : (
                              <Upload className="w-4 h-4" />
                            )}
                            <span className="text-sm font-medium">
                              {isParsingResume ? 'Parsing Resume...' : 'Upload PDF or TXT'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                            <span className="text-sm font-medium text-blue-700 truncate">{resumeFileName}</span>
                          </div>
                          <button 
                            onClick={removeResume}
                            className="p-1 hover:bg-blue-100 rounded-full transition-colors"
                          >
                            <X className="w-4 h-4 text-blue-600" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-blue-500" />
                        Experience Level
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(['Entry Level', 'Mid Level', 'Senior', 'Expert'] as const).map((level) => (
                          <button
                            key={level}
                            onClick={() => setConfig({ ...config, difficulty: level })}
                            className={cn(
                              "px-3 py-2 text-xs font-semibold rounded-lg border transition-all",
                              config.difficulty === level 
                                ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200" 
                                : "bg-white border-gray-200 text-gray-600 hover:border-blue-300"
                            )}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <button 
                    onClick={startInterview}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2 group"
                  >
                    Start Interview
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>

              <div className="hidden lg:block relative">
                <div className="absolute -inset-4 bg-blue-100/50 rounded-[40px] blur-3xl -z-10" />
                <div className="bg-white rounded-[32px] p-6 shadow-2xl border border-gray-100 rotate-2 hover:rotate-0 transition-transform duration-500">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl">
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">AI</div>
                      <div>
                        <p className="text-xs font-bold text-blue-600 uppercase">Feedback</p>
                        <p className="text-sm font-medium">"Your explanation of system design was excellent, but try to be more specific about trade-offs."</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-green-50 rounded-2xl">
                      <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white font-bold">92</div>
                      <div>
                        <p className="text-xs font-bold text-green-600 uppercase">Score</p>
                        <p className="text-sm font-medium">Top 5% for Senior Software Engineer roles.</p>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-100 rounded-2xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold">Communication</span>
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="w-[85%] h-full bg-blue-500" />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold">Technical Depth</span>
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="w-[92%] h-full bg-blue-500" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {state === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-32 space-y-6"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-blue-400 blur-2xl opacity-20 animate-pulse" />
                <Loader2 className="w-16 h-16 text-blue-600 animate-spin relative z-10" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold">Preparing your interview...</h2>
                <p className="text-gray-500">Our AI is generating custom questions for {config.company}.</p>
              </div>
            </motion.div>
          )}

          {state === 'interview' && (
            <motion.div
              key="interview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-3xl mx-auto space-y-6"
            >
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full">
                    {config.company}
                  </div>
                  <span className="text-sm text-gray-500 font-medium">{config.role}</span>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setAutoSpeak(!autoSpeak)}
                    className={cn(
                      "p-2 rounded-full transition-all",
                      autoSpeak ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                    )}
                    title={autoSpeak ? "Auto-speak enabled" : "Auto-speak disabled"}
                  >
                    {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                  <div className="text-sm font-bold text-gray-400">
                    Question {currentQuestionIndex + 1} of {questions.length}
                  </div>
                </div>
              </div>

              {/* Chat Interface */}
              <div className="bg-white rounded-[32px] shadow-xl border border-gray-100 overflow-hidden flex flex-col h-[600px]">
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* History */}
                  {history.map((item, i) => (
                    <div key={i} className="space-y-4">
                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <Bot className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="bg-blue-50 p-4 rounded-2xl rounded-tl-none text-sm font-medium max-w-[85%]">
                          {item.question}
                        </div>
                      </div>
                      <div className="flex gap-4 justify-end">
                        <div className="bg-gray-100 p-4 rounded-2xl rounded-tr-none text-sm font-medium max-w-[85%]">
                          {item.answer}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                          <User className="w-5 h-5 text-gray-600" />
                        </div>
                      </div>
                      <div className="flex gap-4 pl-12">
                        <div className="bg-white border border-blue-100 p-4 rounded-2xl text-xs space-y-2 w-full">
                          <div className="flex items-center gap-2 text-blue-600 font-bold uppercase tracking-wider">
                            <Star className="w-3 h-3" />
                            AI Feedback • Score: {item.score}/10
                          </div>
                          <div className="text-gray-600 leading-relaxed">
                            <Markdown>{item.feedback}</Markdown>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Current Question */}
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div className="bg-blue-600 text-white p-4 rounded-2xl rounded-tl-none text-sm font-medium max-w-[85%] shadow-lg shadow-blue-100">
                      {questions[currentQuestionIndex]?.question}
                    </div>
                  </div>

                  {isEvaluating && (
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                      </div>
                      <div className="text-xs text-gray-400 font-medium italic animate-pulse">
                        AI is evaluating your response...
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-6 bg-gray-50 border-t border-gray-100">
                  <div className="relative flex gap-3">
                    <div className="flex-1 relative">
                      <textarea 
                        rows={3}
                        placeholder={isListening ? "Listening..." : "Type your answer here..."}
                        className={cn(
                          "w-full px-4 py-4 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none text-sm pr-12",
                          isListening && "border-blue-400 ring-2 ring-blue-100"
                        )}
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAnswerSubmit();
                          }
                        }}
                      />
                      <button 
                        onClick={handleAnswerSubmit}
                        disabled={!userAnswer.trim() || isEvaluating}
                        className="absolute bottom-4 right-4 p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all"
                      >
                        <ArrowRight className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={toggleListening}
                        className={cn(
                          "p-4 rounded-2xl transition-all shadow-md flex items-center justify-center",
                          isListening 
                            ? "bg-red-500 text-white animate-pulse shadow-red-200" 
                            : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
                        )}
                        title={isListening ? "Stop Recording" : "Start Voice Input"}
                      >
                        {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                      </button>
                      <button 
                        onClick={() => speakText(questions[currentQuestionIndex].question)}
                        disabled={isSpeaking}
                        className="p-4 bg-white text-gray-600 rounded-2xl hover:bg-gray-50 border border-gray-100 shadow-md flex items-center justify-center disabled:opacity-50"
                        title="Repeat Question"
                      >
                        <Volume2 className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-gray-400 text-center font-medium">
                    {isListening ? "Recording in progress... Click the mic to stop." : "Press Enter to send. Click the mic to speak your answer."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {state === 'feedback' && finalReport && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-extrabold">Interview Complete!</h2>
                <p className="text-gray-500">Here is your comprehensive performance report for {config.company}.</p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="bg-white p-8 rounded-[32px] shadow-xl border border-gray-100 flex flex-col items-center justify-center space-y-4">
                  <div className="relative w-32 h-32 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90">
                      <circle 
                        cx="64" cy="64" r="58" 
                        fill="transparent" 
                        stroke="#F3F4F6" 
                        strokeWidth="10" 
                      />
                      <circle 
                        cx="64" cy="64" r="58" 
                        fill="transparent" 
                        stroke="#2563EB" 
                        strokeWidth="10" 
                        strokeDasharray={364.4}
                        strokeDashoffset={364.4 - (364.4 * finalReport.score) / 100}
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <span className="absolute text-3xl font-black">{finalReport.score}</span>
                  </div>
                  <p className="font-bold text-gray-400 uppercase tracking-widest text-xs">Overall Score</p>
                </div>

                <div className="md:col-span-2 bg-white p-8 rounded-[32px] shadow-xl border border-gray-100 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      Key Strengths
                    </h3>
                    <ul className="grid sm:grid-cols-2 gap-3">
                      {finalReport.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600 bg-green-50 p-3 rounded-xl">
                          <ChevronRight className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-blue-500" />
                      Areas for Improvement
                    </h3>
                    <ul className="grid sm:grid-cols-2 gap-3">
                      {finalReport.improvements.map((imp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600 bg-blue-50 p-3 rounded-xl">
                          <ChevronRight className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          {imp}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-xl border border-gray-100 space-y-4">
                <h3 className="text-xl font-bold">Detailed Analysis</h3>
                <div className="text-gray-600 leading-relaxed">
                  <Markdown>{finalReport.overallFeedback}</Markdown>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={resetInterview}
                  className="px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                >
                  <RefreshCcw className="w-5 h-5" />
                  Try Another Interview
                </button>
                <button 
                  className="px-8 py-4 bg-white text-blue-600 border-2 border-blue-600 font-bold rounded-2xl hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                >
                  Download Report
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* How It Works Modal */}
        <AnimatePresence>
          {showHowItWorks && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHowItWorks(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative bg-white w-full max-w-2xl rounded-[32px] p-8 shadow-2xl space-y-8 overflow-hidden"
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-3xl font-extrabold">How it works</h2>
                  <button onClick={() => setShowHowItWorks(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="grid sm:grid-cols-2 gap-8">
                  {[
                    {
                      icon: <Building2 className="w-6 h-6 text-blue-600" />,
                      title: "1. Configure",
                      desc: "Enter your target company, role, and experience level to get tailored questions."
                    },
                    {
                      icon: <FileText className="w-6 h-6 text-blue-600" />,
                      title: "2. Personalize",
                      desc: "Upload your resume to let the AI probe deeper into your specific skills and projects."
                    },
                    {
                      icon: <Mic className="w-6 h-6 text-blue-600" />,
                      title: "3. Practice",
                      desc: "Engage in a realistic conversation by typing or talking. Get real-time AI evaluation."
                    },
                    {
                      icon: <Trophy className="w-6 h-6 text-blue-600" />,
                      title: "4. Improve",
                      desc: "Receive a detailed performance report with scores, strengths, and improvement tips."
                    }
                  ].map((step, i) => (
                    <div key={i} className="space-y-3">
                      <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                        {step.icon}
                      </div>
                      <h3 className="font-bold text-lg">{step.title}</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={() => setShowHowItWorks(false)}
                  className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all"
                >
                  Got it, let's start!
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Resources Modal */}
        <AnimatePresence>
          {showResources && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowResources(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative bg-white w-full max-w-2xl rounded-[32px] p-8 shadow-2xl space-y-6"
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-3xl font-extrabold">Interview Resources</h2>
                  <button onClick={() => setShowResources(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4">
                  {[
                    { title: "The STAR Method Guide", desc: "Learn how to structure behavioral answers effectively.", tag: "Behavioral" },
                    { title: "System Design Roadmap", desc: "Key concepts for technical architectural interviews.", tag: "Technical" },
                    { title: "Salary Negotiation Tips", desc: "How to handle the compensation conversation.", tag: "Career" },
                    { title: "Common Soft Skills Questions", desc: "Top 20 questions every candidate should prepare for.", tag: "General" }
                  ].map((res, i) => (
                    <div key={i} className="p-4 border border-gray-100 rounded-2xl hover:border-blue-200 hover:bg-blue-50/30 transition-all cursor-pointer group">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h3 className="font-bold group-hover:text-blue-600 transition-colors">{res.title}</h3>
                          <p className="text-sm text-gray-500">{res.desc}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-gray-100 rounded-md text-gray-400">
                          {res.tag}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-gray-500" />
            </div>
            <span className="font-bold text-gray-500">InterviewAI</span>
          </div>
          <p className="text-sm text-gray-400">© 2026 InterviewAI. All rights reserved.</p>
          <div className="flex gap-6 text-sm font-medium text-gray-400">
            <a href="#" className="hover:text-blue-600 transition-colors">Privacy</a>
            <a href="#" className="hover:text-blue-600 transition-colors">Terms</a>
            <a href="#" className="hover:text-blue-600 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
