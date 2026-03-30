import React, { useState, useEffect } from 'react';
import { db, auth, type User, handleFirestoreError, OperationType, getDocs, Timestamp } from '../firebase';
import { collection, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { CalendarDays, Briefcase, Trophy, Bot, Star, X, User as UserIcon, ArrowLeft, Loader2, MessageSquare, Download } from 'lucide-react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

interface InterviewHistoryItem {
  question: string;
  category?: string;
  answer: string;
  feedback: string;
  score: number;
}

interface InterviewSession {
  id: string;
  company: string;
  role: string;
  status: string;
  persona?: string;
  score?: number;
  createdAt: any;
  history?: InterviewHistoryItem[];
  finalReport?: any;
}

interface HistoryPageProps {
  onBack: () => void;
}

const HistoryPage: React.FC<HistoryPageProps> = ({ onBack }) => {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<InterviewSession | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  useEffect(() => {
    const fetchSessions = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const sessionsCollection = collection(db, 'interviews');
        const q = query(
          sessionsCollection,
          where('uid', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const querySnapshot = await getDocs(q);
        const fetchedSessions: InterviewSession[] = [];

        querySnapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          fetchedSessions.push({
            id: docSnapshot.id,
            company: data.company,
            role: data.role,
            status: data.status,
            score: data.score,
            createdAt: data.createdAt,
            history: data.history,
            finalReport: data.finalReport
          });
        });
        setSessions(fetchedSessions);
      } catch (err) {
        console.error('Error fetching sessions:', err);
        setError('Failed to fetch interview sessions. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, []);

  const handleSessionClick = async (session: InterviewSession) => {
    // If we already have the history and report, just show it
    if (session.history && session.finalReport) {
      setSelectedSession(session);
      return;
    }

    setIsDetailLoading(true);
    try {
      const sessionDocRef = doc(db, 'interviews', session.id);
      const sessionDocSnap = await getDoc(sessionDocRef);

      if (sessionDocSnap.exists()) {
        const fullData = sessionDocSnap.data();
        setSelectedSession({
          ...session,
          history: fullData.history,
          finalReport: fullData.finalReport
        });
      } else {
        setError('Interview session not found.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `interviews/${session.id}`);
      setError('Failed to load session details.');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return format(d, 'MMM dd, yyyy • hh:mm a');
  };

  const downloadReport = (session: InterviewSession) => {
    const reportText = `
INTERVIEW REPORT - ${session.company} (${session.role})
==================================================
Date: ${formatDate(session.createdAt)}
Persona: ${session.persona || 'N/A'}
Overall Score: ${session.score || 'N/A'}/10

OVERALL FEEDBACK:
${typeof session.finalReport === 'string' ? session.finalReport : session.finalReport?.overallFeedback || 'N/A'}

DETAILED HISTORY:
${(session.history || []).map((item, index) => `
Question ${index + 1}: ${item.question}
Category: ${item.category || 'N/A'}
Your Answer: ${item.answer}
Feedback: ${item.feedback}
Score: ${item.score}/10
`).join('\n')}
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Interview_Report_${session.company.replace(/\s+/g, '_')}_${session.role.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        <p className="text-gray-500 font-medium">Loading your interview history...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Past Interviews</h1>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[32px] border border-dashed border-gray-200">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">No interviews yet</h3>
          <p className="text-gray-500 max-w-xs mx-auto mt-2">
            Complete your first AI mock interview to see your history and performance reports here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <motion.div
              key={session.id}
              layoutId={session.id}
              onClick={() => handleSessionClick(session)}
              className="bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all cursor-pointer group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">{session.role}</h3>
                    <p className="text-gray-500 text-sm font-medium flex items-center gap-1.5">
                      {session.company} • {formatDate(session.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-6">
                  <div className="text-right">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Score</p>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-black text-blue-600">
                        {session.score !== undefined ? `${session.score}/100` : 'N/A'}
                      </div>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSession(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-[#F8F9FA] rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 sm:p-8 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{selectedSession.role}</h2>
                    <p className="text-gray-500 font-medium">
                      {selectedSession.company} • {formatDate(selectedSession.createdAt)}
                      {selectedSession.persona && ` • ${selectedSession.persona} Persona`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadReport(selectedSession)}
                    className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center hover:bg-blue-100 transition-colors group"
                    title="Download Report"
                  >
                    <Download className="w-5 h-5 text-blue-600 group-hover:scale-110 transition-transform" />
                  </button>
                  <button 
                    onClick={() => setSelectedSession(null)}
                    className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8">
                {/* Final Report Section */}
                {selectedSession.finalReport && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-blue-600 font-bold uppercase tracking-widest text-xs">
                      <Trophy className="w-4 h-4" />
                      Performance Report
                    </div>
                    <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-blue-100 shadow-sm prose prose-blue max-w-none">
                      <Markdown>{typeof selectedSession.finalReport === 'string' ? selectedSession.finalReport : selectedSession.finalReport.overallFeedback}</Markdown>
                    </div>
                  </div>
                )}

                {/* History Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-blue-600 font-bold uppercase tracking-widest text-xs">
                    <MessageSquare className="w-4 h-4" />
                    Interview Transcript
                  </div>
                  <div className="space-y-6">
                    {selectedSession.history?.map((item, idx) => (
                      <div key={idx} className="space-y-4">
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <Bot className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="bg-blue-50 p-4 rounded-2xl rounded-tl-none text-sm font-medium max-w-[85%] relative">
                            <div className="absolute -top-6 left-0 text-[10px] font-bold uppercase tracking-widest text-blue-400">
                              {item.category || 'Question'}
                            </div>
                            {item.question}
                          </div>
                        </div>
                        <div className="flex gap-4 justify-end">
                          <div className="bg-white border border-gray-100 p-4 rounded-2xl rounded-tr-none text-sm font-medium max-w-[85%] shadow-sm">
                            {item.answer}
                          </div>
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                            <UserIcon className="w-5 h-5 text-gray-600" />
                          </div>
                        </div>
                        <div className="flex gap-4 pl-12">
                          <div className="bg-white border border-blue-50 p-4 rounded-2xl text-xs space-y-2 w-full">
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
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Re-importing missing icons for the list view
import { ChevronRight, MessageSquare as MessageSquareIcon, AlertCircle } from 'lucide-react';

export default HistoryPage;
