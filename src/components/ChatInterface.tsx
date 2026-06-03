import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Sparkles, Bot, User as UserIcon, Loader2, Maximize2, Atom, UserCircle, ArrowRight, Star, X, BookOpen, PanelLeftOpen, ChevronDown, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import TextareaAutosize from 'react-textarea-autosize';
import { motion, AnimatePresence } from 'motion/react';
import MoleculeViewer3D from './MoleculeViewer3D';
import { ModelViewer } from './ModelViewer';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getActiveGeminiClient, getGeminiClient } from '../lib/gemini';

import { db, User, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  moleculeData?: any;
  isTyping?: boolean;
}

interface ExplanatoryTerm {
  term: string;
  definition: string;
  modelType: 'atom' | 'molecule' | 'general';
}

interface ChatInterfaceProps {
  user: User | null;
  chatId: string | null;
  onChatCreated?: (id: string) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function ChatInterface({ user, chatId, onChatCreated, isSidebarOpen, onToggleSidebar }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null);
  const [personalDocs, setPersonalDocs] = useState<{name: string, content: string, type?: string, size?: number, createdAt?: Date}[]>([]);
  const [globalDocs, setGlobalDocs] = useState<{name: string, content: string, type?: string, size?: number, createdAt?: Date}[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<ExplanatoryTerm | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("L'IA réfléchit...");
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentChatIdRef = useRef(chatId);

  // Effect to rotate loading message
  useEffect(() => {
    let interval: any;
    if (isLoading) {
      const messages = [
        "L'IA réfléchit...",
        "Analyse de la base de données...",
        "Consultation des archives du collège...",
        "Configuration de la réponse...",
        "Synthèse chimique en cours...",
        "Calcul des interactions moléculaires..."
      ];
      let step = 0;
      setLoadingMessage(messages[0]);
      interval = setInterval(() => {
        step = (step + 1) % messages.length;
        setLoadingMessage(messages[step]);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Sync ref and reset state on chat switch
  useEffect(() => {
    // If we transition from no chat to a chat during message sending, don't reset loading
    // We check currentChatIdRef.current === null to see if we were in "new chat" mode
    if (currentChatIdRef.current === null && chatId !== null) {
      currentChatIdRef.current = chatId;
      // Do NOT set isLoading false here, handleSend will handle it
    } else if (chatId !== currentChatIdRef.current) {
      currentChatIdRef.current = chatId;
      setIsLoading(false);
      setAnimatingMessageId(null);
    }
  }, [chatId]);

  // Load chat messages if chatId is provided
  useEffect(() => {
    if (!user) return;
    
    if (!chatId) {
      // Don't reset messages if we are currently loading (sending first message)
      if (!isLoading) {
        setMessages([]);
      }
      return;
    }

    const q = query(
      collection(db, `users/${user.uid}/chats/${chatId}/messages`),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      
      setMessages(msgs.length > 0 ? msgs : [
        {
          id: 'welcome',
          role: 'assistant',
          content: "Bonjour ! Je suis **Chimie Expert**. Posez-moi n'importe quelle question sur la chimie, ou demandez-moi de modéliser une molécule en 3D (ex: $H_2O$, $CH_4$).",
        }
      ]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/chats/${chatId}/messages`, false);
    });

    return () => unsubscribe();
  }, [chatId, user]);

  // Load documents for context
  useEffect(() => {
    // Load Global Knowledge Base (accessible to everyone)
    const qGlobal = query(collection(db, 'knowledge_base'));
    const unsubscribeGlobal = onSnapshot(qGlobal, (snapshot) => {
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        let uploadDate = new Date();
        if (data.createdAt) {
          if (typeof data.createdAt.toDate === 'function') {
            uploadDate = data.createdAt.toDate();
          } else if (data.createdAt instanceof Date) {
            uploadDate = data.createdAt;
          }
        }
        return {
          name: data.name || '',
          content: data.content || '',
          type: data.type || 'text/plain',
          size: data.size || 0,
          createdAt: uploadDate
        };
      });
      // Sort latest first
      docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setGlobalDocs(docs);
    }, (error) => {
      console.warn("Global docs subscription status/error:", error);
    });

    // Load Personal Documents (only if logged in)
    let unsubscribePersonal = () => {};
    if (user) {
      const qPersonal = query(collection(db, `users/${user.uid}/documents`));
      unsubscribePersonal = onSnapshot(qPersonal, (snapshot) => {
        const docs = snapshot.docs.map(doc => {
          const data = doc.data();
          let uploadDate = new Date();
          if (data.createdAt) {
            if (typeof data.createdAt.toDate === 'function') {
              uploadDate = data.createdAt.toDate();
            } else if (data.createdAt instanceof Date) {
              uploadDate = data.createdAt;
            }
          }
          return {
            name: data.name || '',
            content: data.content || '',
            type: data.type || 'text/plain',
            size: data.size || 0,
            createdAt: uploadDate
          };
        });
        setPersonalDocs(docs);
      }, (error) => {
        console.warn("Personal docs subscription status/error:", error);
      });
    } else {
      setPersonalDocs([]);
    }

    return () => {
      unsubscribeGlobal();
      unsubscribePersonal();
    };
  }, [user]);

  const allDocuments = useMemo(() => {
    return [...globalDocs, ...personalDocs];
  }, [globalDocs, personalDocs]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const generateSummary = async (text: string) => {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [{ role: "user", parts: [{ text: `Résume cette question de chimie en 3-5 mots maximum pour un titre de chat. INTERDICTION d'utiliser du LaTeX (pas de $), du Markdown ou des symboles spéciaux. Juste du texte brut. Question: "${text}"` }] }]
      });
      return response.text?.trim().replace(/^"|"$/g, '') || "Nouveau chat";
    } catch (e) {
      console.error("Summary generation failed:", e);
      return text.slice(0, 30) + "...";
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const startingChatId = currentChatIdRef.current;
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    // Optimistic UI update: add user message immediately
    const tempId = 'temp-' + Date.now();
    setMessages(prev => [...prev, {
      id: tempId,
      role: 'user',
      content: currentInput
    }]);

    let activeChatId = startingChatId;

    try {
      // 1. Save user message locally if not logged in, or in Firestore if logged in
      if (user) {
        // Create chat if it doesn't exist
        if (!activeChatId) {
          const chatRef = await addDoc(collection(db, `users/${user.uid}/chats`), {
            title: "Nouveau chat...",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          activeChatId = chatRef.id;
          onChatCreated?.(activeChatId);
          
          generateSummary(currentInput).then(summary => {
            updateDoc(doc(db, `users/${user.uid}/chats`, activeChatId!), { title: summary })
              .catch(e => console.error("Failed to update chat title:", e));
          }).catch(e => console.error("Failed to generate chat summary:", e));
        }

        const userMsgData = {
          role: 'user',
          content: currentInput,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, `users/${user.uid}/chats/${activeChatId}/messages`), userMsgData);
      } else {
        // Guest user message already added optimistically at start
      }

      // 2. Get AI response (Optimisation RAG intelligente)
      const normalizeStr = (str: string) => {
        return str
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, " ");
      };

      const stopWords = ['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en', 'ce', 'que', 'qui', 'est', 'pour', 'dans', 'par', 'sur', 'avec', 'aux'];
      const keywords = currentInput.toLowerCase()
        .replace(/[?.!,;]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.includes(w));
      
      const scoredDocs = allDocuments.map(d => {
        const normName = normalizeStr(d.name);
        const normContent = normalizeStr(d.content);
        const normQuery = normalizeStr(currentInput);
        
        let score = 0;
        
        // Correspondance parfaite de nom de fichier
        if (normQuery.length > 3 && normName.includes(normQuery)) {
          score += 100;
        }
        
        keywords.forEach(k => {
          const normK = normalizeStr(k);
          if (normName.includes(normK)) {
            score += 40;
          }
          const isImg = d.type?.startsWith('image/') || d.content?.startsWith('data:image/') || /\.(jpg|jpeg|png|webp)$/i.test(d.name);
          if (!isImg) {
            const count = normContent.split(normK).length - 1;
            score += Math.min(count * 5, 50);
          }
        });

        const isImg = d.type?.startsWith('image/') || d.content?.startsWith('data:image/') || /\.(jpg|jpeg|png|webp)$/i.test(d.name);
        if (isImg) {
          const isImageQuery = /image|affiche|montre|génère|dessine|photo|regarder|voir|schema|schéma/i.test(currentInput);
          if (isImageQuery) {
            score += 15;
          }
        }
        
        return { ...d, score };
      });

      let relevantDocs = scoredDocs
        .filter(d => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      if (relevantDocs.length === 0) {
        relevantDocs = allDocuments.slice(0, 4).map(d => ({ ...d, score: 0 }));
      }

      const allFilesList = allDocuments
        .map((d, i) => `- [${d.name}] (${d.type?.startsWith('image/') ? 'Image / Visuel' : 'Document de Cours'})`)
        .join('\n');

      const context = allDocuments.length > 0 
        ? `LISTE COMPLÈTE DE TOU(TE)S LES FICHIERS ET IMAGES DANS LA BASE DE DONNÉES (${allDocuments.length} ELEMENTS) :
${allFilesList}

---

DÉTAILS CONTEXTUELS ET CONTENUS DE VERITÉ :
${relevantDocs.map(d => {
  const isImg = d.type?.startsWith('image/') || d.content?.startsWith('data:image/') || /\.(jpg|jpeg|png|webp)$/i.test(d.name);
  if (isImg) {
    return `[DOCUMENT IMAGE RECONNU]
Nom du fichier : ${d.name}
Type d'image : ${d.type || 'image/jpeg'}
Instructions d'affichage : Si l'utilisateur veut voir cette image ou ce schéma (ou demande "affiche l'image" ou "montre"), écris le tag exact [[IMAGE:${d.name}]] à la fin ou au sein de ta réponse. C'est le seul moyen pour l'application d'afficher l'IMAGE RÉELLE de la base de données. Il est prioritaire d'indiquer cette balise.`;
  }
  return `[Fichier : ${d.name}]
${d.content}`;
}).join('\n\n')}`
        : "AUCUN DOCUMENT FOURNI.";

      const history = (messages || [])
        .filter(msg => msg.id !== 'welcome')
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content || "" }]
        }));

      const ai = getActiveGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          ...history,
          { role: "user", parts: [{ text: currentInput }] }
        ],
        config: {
          systemInstruction: `Tu es Chimie Expert, un assistant spécialisé opérant STRICTEMENT ET EXCLUSIVEMENT sur la base des documents de cours fournis dans le CONTEXTE.
          
          RÈGLES CRITIQUES SUR LES IMAGES:
          1. Si l'utilisateur demande de générer, afficher, dessiner ou de montrer une image/schéma disponible dans les documents de cours (par exemple une structure moléculaire, un diagramme d'oxydation, etc.), trouve le nom de fichier correspondant dans le CONTEXTE et insère EXACTEMENT ceci: [[IMAGE:nom_du_fichier.extension]] dans ton explication. C'est le seul moyen pour l'interface utilisateur d'afficher l'image réelle.
          2. Tu peux lister une suite de plusieurs balises [[IMAGE:nom_du_fichier]] successives s'il demande une séquence d'images.
          
          RÈGLE D'OR (ZÉRO CONNAISSANCE EXTERNE): 
          1. Tu ne dois répondre qu'en utilisant les informations textuelles contenues dans le CONTEXTE fourni ci-dessous.
          2. GESTION DES MANQUES :
             - Si la question porte sur la CHIMIE ou la PHYSIQUE mais qu'elle est ABSENTE du CONTEXTE : Réponds que l'information n'est pas présente dans les archives du Collège Catts Pressoir, mais PROPOSE de donner une réponse basée sur tes connaissances générales en précisant qu'elle ne sera pas vérifiée par le Collège.
             - Si la question est HORS-SUJET (culture générale, vie quotidienne, etc.) : Réponds poliment que cela sort de ton domaine d'expertise et que tu es limité exclusivement aux sujets de CHIMIE.
          3. EXCEPTION: Si (et seulement si) dans l'historique récent l'utilisateur a explicitement accepté que tu utilises tes connaissances générales, tu peux répondre. Commence obligatoirement par : "Note : Cette réponse est générée à partir de mes connaissances générales et n'a pas été vérifiée par le Collège Catts Pressoir."
          4. Il est INTERDIT d'utiliser tes connaissances générales par défaut pour les sujets scientifiques. Ta seule source de vérité pour le cours est le CONTEXTE.
          5. Si aucun document n'est fourni, explique que tu attends que des fiches soient ajoutées pour pouvoir répondre.
          6. NE COMMENCE JAMAIS tes phrases par "Selon vos documents", "D'après les textes" ou toute mention de la source. Réponds directement.
          7. UNIQUEMENT SI on te demande tes sources, réponds : "Mes sources proviennent du Collège Catts Pressoir." Ne cite jamais le nom des fichiers.
 
          ANNOTATION DE TERMES CLÉS:
          Identifie les termes techniques expliqués dans le CONTEXTE (atomes, molécules, concepts). 
          Formate-les EXACTEMENT comme ceci: [[Mot|Définition courte|TypeModel]]
          - TypeModel: "atom", "molecule" ou "general".
          - La définition DOIT être une synthèse courte du CONTEXTE (une phrase).
          
          Exemple 1: "L'[[eau|Substance chimique composée de molécules H2O.|molecule]] est un solvant."
          Exemple 2: "Le [[pH|Mesure de l'acidité ou de la basicité d'une solution.|general]] de cette solution est de 7."
          Exemple 3: "Le [[carbone|Élément chimique de base de la chimie organique.|atom]] possède 4 électrons de valence."
 
          ${context}
          
          DIRECTIVES DE RÉPONSE:
          1. Utilise le format Markdown pour la mise en forme.
          2. Pour TOUTES les formules chimiques et équations, utilise le format LaTeX ($H_2O$, etc.).
          3. Sois précis dans tes explications en synthétisent les informations des documents.
          4. NE CITE PAS le nom des fichiers sources dans ta réponse, SAUF si l'utilisateur te le demande explicitement.
          5. MODÉLISATION 3D : Si l'utilisateur demande de voir une molécule ou si c'est pertinent, ajoute UNIQUEMENT à la toute fin de ta réponse un bloc [MOLECULE_DATA] avec le JSON suivant : 
             { "name": "Nom", "formula": "Formule", "nodes": [{"id": 0, "element": "C", "position": [0,0,0]}], "links": [{"source": 0, "target": 1}] }
             Ne mentionne pas ce bloc dans ton texte verbal.`
        }
      });

      if (user && startingChatId !== null && currentChatIdRef.current !== startingChatId) return;
      if (startingChatId === null && currentChatIdRef.current !== null && currentChatIdRef.current !== activeChatId) return;

      const text = response.text || "Désolé, je n'ai pas pu générer de réponse.";
      
      // Extract molecule data...
      let cleanContent = text;
      let moleculeData = null;
      
      // Robust regex: try to match [MOLECULE_DATA]...[/MOLECULE_DATA] first, then fallback to match until the last closing brace
      const fullMatch = text.match(/\[MOLECULE_DATA\]([\s\S]*?)\[\/MOLECULE_DATA\]/);
      const partialMatch = text.match(/\[MOLECULE_DATA\]([\s\S]*?)$/);
      
      const match = fullMatch || partialMatch;
      
      if (match) {
        try {
          let jsonStr = match[1].trim();
          
          // If it was a partial match, try to find the last '}' to truncate potential trailing text
          if (!fullMatch) {
            const lastBrace = jsonStr.lastIndexOf('}');
            if (lastBrace !== -1) {
              jsonStr = jsonStr.substring(0, lastBrace + 1);
            }
          }
          
          moleculeData = JSON.parse(jsonStr);
          // Remove the exact block found from the clean content
          if (fullMatch) {
            cleanContent = text.replace(/\[MOLECULE_DATA\][\s\S]*?\[\/MOLECULE_DATA\]/, '').trim();
          } else {
            // Re-construct the replaced area to be precise
            const blockToReplace = text.substring(text.indexOf('[MOLECULE_DATA]'));
            cleanContent = text.replace(blockToReplace, '').trim();
          }
        } catch (e) {
          console.error("Failed to parse molecule data", e);
          // Keep content as is if parse fails
        }
      }

      // 4. Save assistant message
      if (user) {
        const assistantMsgData = {
          role: 'assistant',
          content: cleanContent,
          moleculeData,
          createdAt: serverTimestamp(),
          isTyping: false
        };
        
        const messagesCol = collection(db, `users/${user.uid}/chats/${activeChatId}/messages`);
        const assistantDocRef = doc(messagesCol);
        setAnimatingMessageId(assistantDocRef.id);
        
        await setDoc(assistantDocRef, assistantMsgData);
        await updateDoc(doc(db, `users/${user.uid}/chats`, activeChatId), { updatedAt: serverTimestamp() });
      } else {
        const guestAsstMsg: Message = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: cleanContent,
          moleculeData
        };
        setAnimatingMessageId(guestAsstMsg.id);
        setMessages(prev => [...prev, guestAsstMsg]);
      }

    } catch (error: any) {
      console.error("Error in handleSend:", error);
      
      const errorMessage = error?.message || "";
      let userFriendlyError = "Désolé, une erreur est survenue lors de la génération de la réponse.";
      
      if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("429")) {
        userFriendlyError = "Désolé, la limite d'utilisation de l'IA a été atteinte pour le moment. Veuillez réessayer dans quelques minutes.";
      }

      // Add error message to chat
      const errorMsg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: `⚠️ **Erreur** : ${userFriendlyError}`
      };
      setMessages(prev => [...prev, errorMsg]);
      
    } finally {
      // Only reset loading if we are still on the same chat context
      if (currentChatIdRef.current === activeChatId || (startingChatId === null && !currentChatIdRef.current)) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-slate-50/20">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          className="absolute -top-24 -left-20 text-indigo-600/5"
        >
          <Atom className="w-96 h-96" />
        </motion.div>
        
        <motion.div 
          animate={{ rotate: -360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 -right-32 text-indigo-600/[0.03]"
        >
          <Atom className="w-[30rem] h-[30rem]" />
        </motion.div>
        
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-40 left-1/4 text-indigo-600/[0.04]"
        >
          <Atom className="w-[25rem] h-[25rem]" />
        </motion.div>
        
        <motion.div 
          animate={{ rotate: -360 }}
          transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/3 -left-40 text-indigo-600/[0.02]"
        >
          <Atom className="w-[35rem] h-[35rem]" />
        </motion.div>
      </div>

      {/* Header */}
      <header className="h-14 flex items-center justify-between px-4 sticky top-0 z-20">
        <div className="flex items-center gap-2">
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
          <Button variant="ghost" className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 gap-2 font-bold uppercase tracking-wider text-[11px]">
            <span>Chimie Expert</span>
            <ChevronDown className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scroll-smooth" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-10 min-h-full flex flex-col">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 animate-in fade-in duration-700 mt-10 md:mt-20">
              <div className="space-y-6">
                <div className="relative flex items-center justify-center w-24 h-24 mx-auto transform -rotate-6 group">
                  <div className="absolute inset-0 bg-white border border-slate-200 rounded-[2rem] shadow-xl rotate-6 group-hover:rotate-12 transition-transform duration-500" />
                  <Atom className="w-24 h-24 text-indigo-600/10 absolute animate-[spin_15s_linear_infinite]" />
                  <FlaskConical className="w-10 h-10 text-indigo-600 relative z-10" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-3xl md:text-5xl font-display font-black text-slate-900 tracking-tight leading-tight">
                    Bonjour <span className="text-indigo-600 italic">{user?.displayName?.split(' ')[0] || 'Chimiste'}</span>.<br />
                    <span className="text-slate-400">Comment puis-je t'aider ?</span>
                  </h3>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-5xl">
                <SuggestionCard 
                  icon={Sparkles} 
                  title="Structure atomique" 
                  desc="Explique les isotopes et les ions avec des exemples concrets." 
                  onClick={() => setInput("Qu'est-ce qu'un isotope et un ion ?")}
                />
                <SuggestionCard 
                  icon={Atom} 
                  title="Modélisation 3D" 
                  desc="Affiche la structure de la molécule d'Éthanol ($C_2H_5OH$)." 
                  onClick={() => setInput("Modélise la molécule d'éthanol en 3D")} 
                />
                <SuggestionCard 
                  icon={BookOpen} 
                  title="Réactions Chimiques" 
                  desc="Comment équilibrer une équation de combustion ?" 
                  onClick={() => setInput("Comment équilibrer une équation de combustion ?")} 
                />
                <SuggestionCard 
                  icon={Star} 
                  title="Quiz de révision" 
                  desc="Génère un test sur le chapitre des solutions aqueuses." 
                  onClick={() => setInput("Peux-tu me faire un petit quiz sur les solutions aqueuses ?")} 
                />
              </div>
            </div>
          )}

          <div className="space-y-10 pb-40">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={cn(
                    "group relative flex w-full",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "flex max-w-[85%] md:max-w-[75%] gap-3 md:gap-4",
                    msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}>
                    <div className="flex-shrink-0 mt-1">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ring-1 transition-all",
                        msg.role === 'user' 
                          ? "bg-indigo-600 text-white ring-indigo-500" 
                          : "bg-white text-slate-900 ring-slate-200 shadow-sm"
                      )}>
                        {msg.role === 'user' ? (
                          user?.photoURL ? (
                            <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full rounded-full" referrerPolicy="no-referrer" />
                          ) : (
                            user?.displayName?.charAt(0) || 'U'
                          )
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                    
                    <div className={cn(
                      "flex-1 space-y-1 min-w-0 px-4 py-3 rounded-2xl shadow-sm",
                      msg.role === 'user' 
                        ? "bg-indigo-600 text-white rounded-tr-none" 
                        : "bg-white text-slate-700 border border-slate-100 rounded-tl-none"
                    )}>
                      <div className={cn(
                        "text-[15px] leading-relaxed",
                        msg.role === 'user' ? "text-white" : "text-slate-700"
                      )}>
                        {msg.role === 'assistant' ? (
                          <TypewriterMarkdown 
                            content={msg.content} 
                            animate={msg.id === animatingMessageId} 
                            onComplete={() => setAnimatingMessageId(null)}
                            onSelectTerm={setSelectedTerm}
                            allDocuments={allDocuments}
                          />
                        ) : (
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        )}
                      </div>

                      {msg.moleculeData && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 rounded-2xl overflow-hidden border border-white/20 shadow-xl bg-slate-900"
                        >
                          <MoleculeViewer3D molecule={msg.moleculeData} />
                        </motion.div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </AnimatePresence>
            
            {isLoading && (
              <div className="flex gap-4 md:gap-6">
                <div className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-indigo-600">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" />
                  </div>
                  <span className="text-xs text-slate-500 ml-2 italic font-medium">{loadingMessage}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent">
        <div className="max-w-3xl mx-auto relative mb-6">
          <div className="bg-white rounded-[2rem] p-1.5 border border-slate-200 transition-all focus-within:border-indigo-300 shadow-xl shadow-slate-200/20 group">
            <div className="flex items-end gap-2 px-3 py-1">
              <TextareaAutosize 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Écrivez votre question ici..."
                disabled={isLoading}
                maxRows={10}
                className="flex-1 border-none bg-transparent focus:ring-0 text-slate-800 placeholder-slate-400 py-3.5 resize-none outline-none text-sm font-medium"
              />
              <Button 
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="bg-slate-900 hover:bg-black text-white disabled:bg-slate-100 disabled:text-slate-400 rounded-full w-9 h-9 flex items-center justify-center p-0 mb-1 transition-all shrink-0 shadow-lg"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Term Details Modal */}
      <AnimatePresence>
        {selectedTerm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
            >
              <div className="relative h-48 bg-slate-900">
                <ModelViewer type={selectedTerm.modelType} />
                <button 
                  onClick={() => setSelectedTerm(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-md"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                    <h3 className="text-xl font-display font-black text-slate-900 uppercase tracking-tight">
                      {selectedTerm.term}
                    </h3>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                    Fiche Interactive • {selectedTerm.modelType}
                  </div>
                </div>
                
                <p className="text-slate-600 leading-relaxed text-sm">
                  {selectedTerm.definition}
                </p>
                
                <Button 
                  onClick={() => setSelectedTerm(null)}
                  className="w-full bg-slate-900 hover:bg-black text-white rounded-xl font-bold uppercase tracking-widest text-xs h-12 shadow-lg shadow-slate-900/10"
                >
                  J'ai compris
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SuggestionCard({ icon: Icon, title, desc, onClick }: { icon: any, title: string, desc: string, onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ backgroundColor: "rgba(255, 255, 255, 1)", scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex flex-col items-start p-5 rounded-3xl border border-slate-200 bg-white/40 text-left transition-all group shadow-sm hover:shadow-xl hover:border-indigo-200 min-h-[140px] relative overflow-hidden"
    >
      <div className="mb-4 w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="font-bold text-slate-900 text-sm mb-1 group-hover:text-indigo-600 transition-colors">{title}</h4>
      <div className="text-xs text-slate-500 leading-relaxed line-clamp-2">
        <ReactMarkdown 
          remarkPlugins={[remarkMath]} 
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>
          }}
        >
          {desc}
        </ReactMarkdown>
      </div>
      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowRight className="w-4 h-4 text-indigo-600" />
      </div>
    </motion.button>
  );
}

function QuickAction({ label, onClick }: { label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-primary transition-colors duration-200"
    >
      <ReactMarkdown 
        remarkPlugins={[remarkMath]} 
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>
        }}
      >
        {label}
      </ReactMarkdown>
    </button>
  );
}

function TypewriterMarkdown({ 
  content, 
  animate, 
  onComplete,
  onSelectTerm,
  allDocuments = []
}: { 
  content: string, 
  animate?: boolean, 
  onComplete?: () => void,
  onSelectTerm: (term: ExplanatoryTerm) => void,
  allDocuments?: any[]
}) {
  const [displayedText, setDisplayedText] = useState(animate ? '' : content);
  const indexRef = useRef(animate ? 0 : content.length);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (animate && !hasStarted) {
      setDisplayedText('');
      indexRef.current = 0;
      setHasStarted(true);
    }
  }, [animate, hasStarted]);

  useEffect(() => {
    if (!animate || (animate && !hasStarted)) {
      if (!animate) setDisplayedText(content);
      return;
    }

    const interval = setInterval(() => {
      if (indexRef.current < content.length) {
        setDisplayedText(content.slice(0, indexRef.current + 1));
        indexRef.current += 1;
      } else {
        clearInterval(interval);
        onComplete?.();
      }
    }, 15);

    return () => clearInterval(interval);
  }, [content, animate, hasStarted, onComplete]);

  // Process text to handle annotations (Italic + Underline) and preserve spaces
  const renderContent = (text: string) => {
    // Detect if we are currently mid-annotation [[...
    // We split by full tokens OR partial tokens at the end of the string
    const parts = text.split(/(\[\[.*?\]\]|\[\[.*$)/g);
    
    return parts.map((part, i) => {
      if (!part) return null;

      // Handle Full Token
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const inner = part.slice(2, -2);
        
        if (inner.startsWith('IMAGE:')) {
          const imageName = inner.slice(6).trim();
          const found = (allDocuments || []).find(
            d => d.name.toLowerCase() === imageName.toLowerCase()
          );
          if (found && found.content && (found.content.startsWith('data:image/') || /\.(jpg|jpeg|png|webp)$/i.test(found.name))) {
            return (
              <span key={i} className="block my-4 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-md max-w-sm mx-auto relative group whitespace-normal">
                <img 
                  src={found.content} 
                  alt={found.name} 
                  className="w-full h-auto object-contain max-h-60" 
                  referrerPolicy="no-referrer"
                />
                <span className="absolute inset-x-0 bottom-0 bg-slate-900/80 backdrop-blur-sm p-2 text-white flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <span className="text-[10px] font-bold truncate pr-3">{found.name}</span>
                  <a 
                    href={found.content} 
                    download={found.name}
                    className="text-[9px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1 rounded"
                  >
                    Télécharger
                  </a>
                </span>
              </span>
            );
          } else {
            return (
              <span key={i} className="block my-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-200 whitespace-normal">
                ⚠️ Image: <strong>{imageName}</strong> introuvable dans la base de données.
              </span>
            );
          }
        }

        const [term, definition, modelType] = inner.split('|');
        return (
          <button
            key={i}
            onClick={() => onSelectTerm({ 
              term, 
              definition, 
              modelType: (modelType || 'general') as any 
            })}
            className="italic text-indigo-600 underline decoration-indigo-600/30 decoration-1 underline-offset-4 hover:decoration-indigo-600 transition-colors mx-1 cursor-pointer font-bold"
            title="Cliquer pour voir la définition et le modèle 3D"
          >
            {term}
          </button>
        );
      }
      
      // Handle Partial Token at the end (Hide the brackets during typing)
      if (part.startsWith('[[')) {
        if (part.includes('IMAGE:')) {
          return <span key={i} className="text-xs text-indigo-500 animate-pulse">Chargement de l'image...</span>;
        }
        const partial = part.slice(2);
        // Extract only the term part (before the first | if it exists)
        const termOnly = partial.split('|')[0];
        return <span key={i} className="italic text-slate-400 underline decoration-indigo-300/30">{termOnly}</span>;
      }
      
      // For non-token parts
      return (
        <ReactMarkdown
          key={i}
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>,
            strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
            em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
            code: ({ children }) => <code className="bg-slate-100 px-1 rounded text-indigo-600 font-mono text-xs">{children}</code>,
          }}
        >
          {part}
        </ReactMarkdown>
      );
    });
  };

  return (
    <div className="markdown-body prose max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-slate-900 prose-pre:text-white">
      {renderContent(displayedText)}
    </div>
  );
}
