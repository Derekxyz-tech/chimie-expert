import React, { useMemo, useState } from 'react';
import { 
  Plus, 
  Search, 
  BookOpen, 
  UserCircle, 
  HelpCircle, 
  Settings, 
  LogOut,
  Atom,
  MessageSquare,
  X,
  LogIn,
  PanelLeftClose,
  Edit,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ViewType } from '../App';
import { auth, loginWithGoogle, logout, User, db } from '../lib/firebase';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: any;
  updatedAt?: any;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  user: User | null;
  onNewChat?: () => void;
  chatHistory?: ChatHistoryItem[];
  currentChatId?: string | null;
  onChatSelect?: (id: string) => void;
}

export default function Sidebar({ 
  isOpen, 
  onClose, 
  currentView, 
  onViewChange, 
  user,
  onNewChat,
  chatHistory = [],
  currentChatId,
  onChatSelect
}: SidebarProps) {
  const [showLogout, setShowLogout] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error("Firebase auth error:", err);
      let message = "Failed to sign in.";
      if (err?.code === 'auth/unauthorized-domain') {
        const currentDomain = window.location.hostname;
        message = `Your Vercel site's domain ("${currentDomain}") is not authorized yet in your Firebase Project console.

To fix this:
1. Log in to the Firebase Console (https://console.firebase.google.com).
2. Select your project: "${firebaseConfig.projectId}".
3. In the left-hand menu, open "Authentication".
4. Go to the "Settings" tab, then find the "Authorized domains" section.
5. Click "Add domain" and enter "${currentDomain}". Click Add to save.
6. Refresh your Vercel page and try signing in again!`;
      } else if (err?.code === 'auth/popup-blocked') {
        message = "The Google sign-in pop-up window was blocked by your browser.\n\nPlease allow pop-ups for this website and try again.";
      } else if (err?.code === 'auth/popup-closed-by-user') {
        message = "The sign-in window was closed before authentication was completed.";
      } else if (err?.code === 'auth/operation-not-allowed') {
        message = "Google Sign-In is not enabled on your Firebase project.\n\nPlease enable Google as a sign-in provider in your Firebase Console under Authentication > Sign-in method.";
      } else if (err?.message) {
        message = `Firebase error: ${err.message}`;
      }
      setLoginError(message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Mobile Overlay */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 md:hidden"
          />
          
          <motion.div 
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-72 h-screen flex flex-col bg-white border-r border-slate-200 z-40 fixed md:relative shadow-2xl md:shadow-none overflow-hidden"
          >
            <div className="p-4 flex items-center gap-3 shrink-0">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onClose} 
                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
              >
                <PanelLeftClose className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3 overflow-hidden px-1 group cursor-pointer" onClick={() => onViewChange('chat')}>
                <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
                  <div className="absolute inset-0 bg-indigo-50 rounded-xl rotate-6 group-hover:rotate-12 transition-transform" />
                  <Atom className="w-10 h-10 text-indigo-600/20 absolute animate-[spin_8s_linear_infinite]" />
                  <FlaskConical className="w-5 h-5 text-slate-800 relative z-10" />
                </div>
                <div className="flex flex-col -space-y-1">
                  <span className="font-display font-black text-xl tracking-tighter text-slate-900 leading-none">CHIMIE</span>
                  <span className="font-display font-black text-[10px] tracking-[0.3em] text-indigo-600 leading-none">EXPERT</span>
                </div>
              </div>
            </div>

            <div className="px-3 mb-2 shrink-0">
              <Button 
                onClick={() => {
                  onNewChat?.();
                  onViewChange('chat');
                }}
                className={cn(
                  "w-full justify-between items-center px-3 rounded-xl h-11 transition-all duration-300 group",
                  currentView === 'chat' && !currentChatId 
                    ? "bg-slate-100 text-slate-900" 
                    : "bg-transparent hover:bg-slate-50 text-slate-600"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center">
                    <Atom className="w-5 h-5 text-indigo-600" />
                  </div>
                  <span className="font-bold text-sm">Nouveau Chat</span>
                </div>
                <Edit className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Button>
            </div>

            <ScrollArea className="flex-1 px-3 min-h-0">
              <div className="space-y-6 py-2">
                <div>
                  <div className="space-y-0.5">
                    <SidebarItem 
                      icon={BookOpen} 
                      label="Fiches de cours" 
                      active={currentView === 'notes'} 
                      onClick={() => onViewChange('notes')}
                      iconColor="text-emerald-400"
                    />
                    <SidebarItem 
                      icon={UserCircle} 
                      label="Prof virtuel" 
                      active={currentView === 'teacher'} 
                      onClick={() => onViewChange('teacher')}
                      iconColor="text-blue-400"
                    />
                    <SidebarItem 
                      icon={HelpCircle} 
                      label="Quiz" 
                      active={currentView === 'quiz'} 
                      onClick={() => onViewChange('quiz')}
                      iconColor="text-purple-400"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-3">Historique récent</p>
                  <div className="space-y-0.5">
                    <AnimatePresence initial={false}>
                      {(chatHistory || []).slice(0, 15).map((chat) => (
                        <motion.div
                          key={chat.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <SidebarItem 
                            icon={MessageSquare} 
                            label={chat.title} 
                            active={currentChatId === chat.id}
                            onClick={() => onChatSelect?.(chat.id)}
                            iconColor="text-slate-400" 
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {chatHistory.length === 0 && (
                      <p className="text-[10px] text-slate-500 italic px-3 py-4">Aucun chat récent</p>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="p-3 mt-auto shrink-0 border-t border-slate-100">
              {user ? (
                <div className="space-y-1">
                  <div 
                    onClick={() => setShowLogout(!showLogout)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-xl transition-all cursor-pointer group",
                      showLogout ? "bg-slate-100" : "hover:bg-slate-50"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold ring-2 ring-indigo-500/10 shadow-sm shrink-0">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        user.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate text-slate-900">{user.displayName || 'Chimiste'}</p>
                    </div>
                    {showLogout ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <Settings className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                  
                  <AnimatePresence>
                    {showLogout && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <Button 
                          variant="ghost" 
                          onClick={logout}
                          className="w-full justify-start text-[11px] h-9 gap-3 text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-all rounded-xl font-bold uppercase tracking-wider"
                        >
                          <LogOut className="w-4 h-4" />
                          Déconnexion
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="px-2 py-3 rounded-xl bg-indigo-50/50 border border-indigo-100/50">
                  <p className="text-[10px] text-slate-500 mb-3 px-2">Connectez-vous pour voir vos chats.</p>
                  <Button 
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="w-full text-[10px] h-9 gap-2 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-lg transition-all"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    Connexion
                  </Button>
                </div>
              )}
            </div>
          </motion.div>

          {/* Custom Modern Dialog for Auth Troubleshooting */}
          <AnimatePresence>
            {loginError && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
              >
                <motion.div 
                  initial={{ scale: 0.95, y: 15 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 15 }}
                  className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 text-left"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 shrink-0">
                        <HelpCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900 font-display">Firebase Sign-In Failed</h3>
                        <p className="text-xs text-slate-400 font-sans">Why is this happening and how can you fix it?</p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setLoginError(null)}
                      className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg shrink-0 -mt-1 -mr-1"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-mono">
                    {loginError}
                  </div>

                  <div className="flex justify-end gap-2 mt-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setLoginError(null)}
                      className="text-xs rounded-xl font-medium border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Close
                    </Button>
                    <a
                      href="https://console.firebase.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-9 px-4 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all"
                    >
                      Firebase Console
                    </a>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

function SidebarItem({ 
  icon: Icon, 
  label, 
  active, 
  onClick,
  iconColor = "text-slate-400"
}: { 
  icon: any, 
  label: string, 
  active?: boolean, 
  onClick?: () => void,
  iconColor?: string
}) {
  // Clean label from LaTeX and Markdown for display
  const cleanLabel = useMemo(() => {
    return label
      .replace(/\$[^$]+\$/g, (match) => match.replace(/\$/g, '')) // Remove $ but keep content
      .replace(/[*_#]/g, '')
      .trim();
  }, [label]);

  return (
    <Button 
      variant="ghost" 
      onClick={onClick}
      className={cn(
        "w-full justify-start gap-3 h-10 px-3 rounded-xl transition-all duration-200 group relative",
        active 
          ? "bg-slate-100 text-slate-900" 
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0 transition-colors", active ? iconColor : "text-slate-400 group-hover:text-slate-600")} />
      <span className="text-sm font-bold truncate flex-1 text-left">{cleanLabel}</span>
      {active && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-indigo-600 rounded-r-full" />
      )}
    </Button>
  );
}
