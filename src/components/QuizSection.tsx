import React, { useState, useEffect } from 'react';
import { 
  HelpCircle, 
  MessageSquare, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  RotateCcw, 
  Sparkles, 
  Loader2,
  PanelLeftOpen
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { Type } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { db, User } from '../lib/firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getActiveGeminiClient } from '../lib/gemini';

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: any;
  updatedAt?: any;
}

interface QuizSectionProps {
  user: User | null;
  chatHistory: ChatHistoryItem[];
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function QuizSection({ user, chatHistory, isSidebarOpen, onToggleSidebar }: QuizSectionProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);

  const generateQuiz = async () => {
    if (!selectedChatId || !user) return;
    
    setIsGenerating(true);
    try {
      // 1. Fetch messages from the selected chat
      const messagesQuery = query(
        collection(db, `users/${user.uid}/chats/${selectedChatId}/messages`),
        orderBy('createdAt', 'asc'),
        limit(20)
      );
      const snapshot = await getDocs(messagesQuery);
      const context = (snapshot.docs || []).map(doc => `${doc.data().role}: ${doc.data().content}`).join('\n');

      // 2. Call Gemini to generate quiz
      const ai = getActiveGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Génère un quiz de 3 à 5 questions basé sur cette conversation de chimie. 
        Chaque question doit avoir 4 options, un index de réponse correcte (0-3) et une explication.
        
        CONVERSATION:
        ${context}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING } 
                },
                correctAnswer: { type: Type.INTEGER },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "correctAnswer", "explanation"]
            }
          }
        }
      });

      const generatedQuestions = JSON.parse(response.text || "[]");
      if (generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setQuizStarted(true);
      } else {
        throw new Error("Aucune question générée");
      }
    } catch (error) {
      console.error("Quiz generation failed:", error);
      alert("Erreur lors de la génération du quiz. Assurez-vous que le chat contient assez d'informations.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswer = (index: number) => {
    const newAnswers = [...userAnswers, index];
    setUserAnswers(newAnswers);
    
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      setShowResult(true);
    }
  };

  const resetQuiz = () => {
    setQuizStarted(false);
    setCurrentQuestionIndex(0);
    setUserAnswers([]);
    setShowResult(false);
    setQuestions([]);
  };

  const score = userAnswers.reduce((acc, ans, idx) => acc + (ans === questions[idx].correctAnswer ? 1 : 0), 0);

  return (
    <div className="flex flex-col h-full bg-slate-50/20">
      <header className="p-6 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onToggleSidebar}
                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                <PanelLeftOpen className="w-5 h-5" />
              </Button>
            )}
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-slate-900 shadow-sm border border-slate-100">
              <HelpCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-display font-black text-slate-900 tracking-tight uppercase">Quiz Personnalisé</h2>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Évaluation par IA</p>
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 p-6 min-h-0">
        <div className="max-w-4xl mx-auto h-full">
          {!quizStarted ? (
            <div className="flex flex-col gap-8 py-8">
              <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-4 shadow-xl">
                <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center mx-auto text-slate-900 shadow-inner border border-slate-100">
                  {isGenerating ? <Loader2 className="w-10 h-10 animate-spin" /> : <Sparkles className="w-10 h-10" />}
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-display font-black text-slate-900 uppercase tracking-tight">
                    {isGenerating ? "Génération en cours..." : "Prêt pour un défi ?"}
                  </h3>
                  <p className="text-sm text-slate-500 max-w-md mx-auto font-medium">
                    {isGenerating 
                      ? "L'IA analyse votre conversation pour créer des questions sur mesure."
                      : "Sélectionnez une conversation réelle dans votre historique pour que l'IA génère un quiz adapté."}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 font-mono">Votre historique de chat</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(chatHistory || []).map(chat => (
                    <button 
                      key={chat.id}
                      onClick={() => setSelectedChatId(chat.id)}
                      disabled={isGenerating}
                      className={cn(
                        "flex items-center gap-4 p-5 rounded-2xl transition-all border text-left group",
                        selectedChatId === chat.id 
                          ? 'bg-indigo-50 border-indigo-200 shadow-md ring-1 ring-indigo-200' 
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 shadow-sm'
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                        selectedChatId === chat.id ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 shadow-inner'
                      )}>
                        <MessageSquare className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-bold truncate", selectedChatId === chat.id ? 'text-slate-900' : 'text-slate-700')}>{chat.title}</p>
                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                          {chat.updatedAt?.toDate?.().toLocaleDateString() || chat.createdAt?.toDate?.().toLocaleDateString() || "Date inconnue"}
                        </p>
                      </div>
                      {selectedChatId === chat.id && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
                    </button>
                  ))}
                </div>
                {chatHistory.length === 0 && (
                  <p className="text-center py-10 text-slate-500 italic font-medium">Aucun chat trouvé. Commencez une conversation pour générer un quiz !</p>
                )}
              </div>

              <Button 
                disabled={!selectedChatId || isGenerating}
                onClick={generateQuiz}
                className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-black text-white font-bold text-lg gap-3 shadow-xl transition-all active:scale-[0.98] disabled:bg-slate-100 disabled:text-slate-400"
              >
                {isGenerating ? "Génération..." : "Générer le Quiz"}
                {!isGenerating && <ArrowRight className="w-5 h-5" />}
              </Button>
            </div>
          ) : showResult ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-20 text-center space-y-12"
            >
              <div className="relative">
                <div className="w-48 h-48 rounded-full border-8 border-slate-100 flex items-center justify-center bg-white shadow-2xl">
                  <div className="flex flex-col items-center">
                    <span className="text-6xl font-black text-slate-900">{score}</span>
                    <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">sur {questions.length}</span>
                  </div>
                </div>
                <motion.div 
                  initial={{ rotate: 0 }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-4 border-2 border-dashed border-slate-200 rounded-full"
                />
              </div>
              
              <div className="space-y-3">
                <h3 className="text-3xl font-display font-black text-slate-900 uppercase tracking-tight">
                  {score === questions.length ? "Parfait !" : score > 0 ? "Pas mal !" : "Continuez à réviser !"}
                </h3>
                <p className="text-slate-500 max-w-xs mx-auto font-medium">
                  Vous avez répondu correctement à {score} questions sur {questions.length}.
                </p>
              </div>

              <div className="w-full max-w-sm space-y-3">
                <Button onClick={resetQuiz} className="w-full h-14 rounded-2xl bg-slate-900 text-white hover:bg-black font-bold gap-2 shadow-lg">
                  <RotateCcw className="w-4 h-4" />
                  Réessayer
                </Button>
                <Button variant="ghost" onClick={resetQuiz} className="w-full h-12 rounded-xl text-slate-500 hover:text-slate-900 font-bold text-xs uppercase tracking-widest">
                  Retour à l'historique
                </Button>
              </div>
            </motion.div>
          ) : (
            <div className="py-8 space-y-12">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {questions.map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "h-2 w-16 rounded-full transition-all duration-500",
                        i === currentQuestionIndex ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20' : i < currentQuestionIndex ? 'bg-indigo-600/20' : 'bg-slate-200'
                      )} 
                    />
                  ))}
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Question {currentQuestionIndex + 1} / {questions.length}
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentQuestionIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-10"
                >
                  <h3 className="text-2xl md:text-3xl font-display font-black text-slate-900 leading-tight uppercase tracking-tight">
                    <ReactMarkdown 
                      remarkPlugins={[remarkMath]} 
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>
                      }}
                    >
                      {questions[currentQuestionIndex].question}
                    </ReactMarkdown>
                  </h3>

                  <div className="grid grid-cols-1 gap-4">
                    {questions[currentQuestionIndex].options.map((option, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(idx)}
                        className="w-full p-6 rounded-3xl bg-white border border-slate-200 hover:border-indigo-400 hover:bg-slate-50 text-left transition-all group flex items-center justify-between shadow-sm hover:shadow-xl"
                      >
                        <span className="text-base font-bold text-slate-700 group-hover:text-slate-900">
                          <ReactMarkdown 
                            remarkPlugins={[remarkMath]} 
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>
                            }}
                          >
                            {option}
                          </ReactMarkdown>
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 flex items-center justify-center text-xs font-black transition-all shadow-inner">
                          {String.fromCharCode(65 + idx)}
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
