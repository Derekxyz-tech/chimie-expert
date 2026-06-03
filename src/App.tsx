import React, { useState, useEffect } from 'react';
import AtomsBackground from './components/AtomsBackground';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import CourseNotes from './components/CourseNotes';
import VirtualTeacher from './components/VirtualTeacher';
import QuizSection from './components/QuizSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Menu, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { auth, onAuthStateChanged, User, db } from './lib/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

export type ViewType = 'chat' | 'notes' | 'teacher' | 'quiz';

interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: any;
  updatedAt?: any;
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to chat history
  useEffect(() => {
    if (!user) {
      setChatHistory([]);
      return;
    }

    const q = query(
      collection(db, `users/${user.uid}/chats`)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Fetched ${snapshot.docs.length} chats for user ${user.uid}`);
      const history = (snapshot.docs || []).map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatHistoryItem[];
      
      // Sort in memory to handle documents missing updatedAt
      history.sort((a, b) => {
        const dateA = a.updatedAt?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.updatedAt?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      setChatHistory(history);
    }, (error) => {
      console.error("Error fetching chat history:", error);
      if (error.code === 'permission-denied') {
        console.error("Permission denied for path:", `users/${user.uid}/chats`);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Handle window resize for responsiveness
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isAuthLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white">
        <Loader2 className="w-10 h-10 text-slate-900 animate-spin" />
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'chat': return (
        <ChatInterface 
          user={user} 
          chatId={currentChatId} 
          onChatCreated={(id) => setCurrentChatId(id)} 
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      );
      case 'notes': return (
        <CourseNotes 
          user={user} 
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      );
      case 'teacher': return (
        <VirtualTeacher 
          user={user} 
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      );
      case 'quiz': return (
        <QuizSection 
          user={user} 
          chatHistory={chatHistory} 
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      );
      default: return (
        <ChatInterface 
          user={user} 
          chatId={currentChatId} 
          onChatCreated={(id) => setCurrentChatId(id)} 
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      );
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden text-slate-700 font-sans selection:bg-indigo-50 bg-white">
        <AtomsBackground />
        
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setIsSidebarOpen(false)} 
          currentView={currentView}
          onViewChange={(view) => {
            setCurrentView(view);
            if (window.innerWidth < 768) setIsSidebarOpen(false);
          }}
          user={user}
          onNewChat={() => setCurrentChatId(null)}
          chatHistory={chatHistory}
          currentChatId={currentChatId}
          onChatSelect={(id) => {
            setCurrentChatId(id);
            setCurrentView('chat');
          }}
        />
        
        <main className="flex-1 relative flex flex-col min-w-0 h-full overflow-hidden">
          <div className="flex-1 relative h-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="h-full"
              >
                {renderView()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
