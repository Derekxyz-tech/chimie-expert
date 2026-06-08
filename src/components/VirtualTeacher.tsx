import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  UserCircle, 
  Loader2, 
  Sparkles, 
  MessageSquare, 
  History, 
  Trash2, 
  X, 
  Send,
  PanelLeftOpen,
  Square
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { User, db, handleFirestoreError, OperationType } from '../lib/firebase';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, limit } from 'firebase/firestore';
import { getActiveGeminiClient } from '../lib/gemini';

// Cache persistant pour les réponses (limité aux 50 dernières)
const CACHE_KEY = 'teacher_response_cache';
const getCache = (): Record<string, { text: string; disclaimer: string | null }> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

const saveToCache = (query: string, data: { text: string; disclaimer: string | null }) => {
  try {
    const cache = getCache();
    cache[query] = data;
    // Limiter la taille
    const keys = Object.keys(cache);
    if (keys.length > 50) delete cache[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("Cache error:", e);
  }
};

interface TeacherMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: any;
}

interface VirtualTeacherProps {
  user: User | null;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function VirtualTeacher({ user, isSidebarOpen, onToggleSidebar }: VirtualTeacherProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Réflexion...");
  const [scannedCount, setScannedCount] = useState(0);
  const [teacherResponse, setTeacherResponse] = useState('');
  const [displayedResponse, setDisplayedResponse] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [history, setHistory] = useState<TeacherMessage[]>([]);
  const [personalDocs, setPersonalDocs] = useState<{name: string, content: string, type?: string}[]>([]);
  const [globalDocs, setGlobalDocs] = useState<{name: string, content: string, type?: string}[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeDisclaimer, setActiveDisclaimer] = useState<string | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const recognitionRef = useRef<any>(null);
  const networkRetryRef = useRef(0);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const queryHandlerRef = useRef<(text: string) => Promise<void>>(null as any);

  const abortControllerRef = useRef<AbortController | null>(null);

  const stopAll = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
    setIsLoading(false);
    setIsListening(false);
    setIsStarting(false);
  };

  // Typing effect logic has been removed in favor of real-time streaming
  // We keep setDisplayedResponse for immediate updates during streaming

  // Load history from Firestore
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, `users/${user.uid}/teacher_history`),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = (snapshot.docs || []).map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TeacherMessage[];
      setHistory(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/teacher_history`, false);
    });

    return () => unsubscribe();
  }, [user]);

  // Load documents for context
  useEffect(() => {
    // Load Global Knowledge Base
    const qGlobal = query(collection(db, 'knowledge_base'));
    const unsubscribeGlobal = onSnapshot(qGlobal, (snapshot) => {
      const docs = (snapshot.docs || []).map(doc => {
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
      docs.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
      setGlobalDocs(docs);
    }, (error) => {
      console.warn("Global docs subscription status/error:", error);
    });

    // Load Personal Documents
    let unsubscribePersonal = () => {};
    if (user) {
      const qPersonal = query(collection(db, `users/${user.uid}/documents`));
      unsubscribePersonal = onSnapshot(qPersonal, (snapshot) => {
        const docs = (snapshot.docs || []).map(doc => {
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

  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      networkRetryRef.current = 0; // Reset on success
      const transcript = event.results[0][0].transcript;
      if (queryHandlerRef.current) {
        queryHandlerRef.current(transcript).catch((e) => {
          console.error("Speech transcript query processing failed:", e);
        });
      }
    };

    recognition.onstart = () => {
      setIsListening(true);
      setIsStarting(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsStarting(false);
    };

    recognition.onerror = (event: any) => {
      const err = event.error;
      console.warn('Speech recognition status:', err);
      
      setIsListening(false);
      setIsStarting(false);

      if (err === 'no-speech' || err === 'aborted') {
        networkRetryRef.current = 0;
        return;
      }

      if (err === 'network') {
        if (networkRetryRef.current < 2) {
          networkRetryRef.current++;
          setTeacherResponse("Problème de connexion micro... Nouvelle tentative automatique...");
          setTimeout(() => {
            toggleListening();
          }, 1000);
          return;
        } else {
          setTeacherResponse("Le service de reconnaissance vocale de Google semble indisponible pour le moment. Veuillez vérifier votre connexion ou taper votre question via l'icône de clavier.");
        }
      } else if (err === 'not-allowed' || err === 'service-not-allowed') {
        setTeacherResponse("L'accès au micro a été refusé. Veuillez autoriser le micro dans les paramètres de votre navigateur.");
      } else {
        setTeacherResponse("Désolé, une erreur avec le micro est survenue. Veuillez réessayer.");
      }
      
      networkRetryRef.current = 0;
    };

    return recognition;
  };

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    
    // Pred-load voices for better reactivity
    const loadVoices = () => {
      if (synthRef.current) {
        synthRef.current.getVoices();
      }
    };
    
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    return () => {
      synthRef.current?.cancel();
    };
  }, []);

  const speak = (text: string) => {
    if (!synthRef.current) return;
    
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    
    // Voice settings for more natural flow
    utterance.pitch = 1.0; 
    utterance.rate = 1.0;
    utterance.volume = 1;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    // Get all available voices
    const voices = synthRef.current.getVoices();
    
    // Selection strategy for high-quality French voices
    const frVoices = voices.filter(v => v.lang.toLowerCase().startsWith('fr'));
    
    // 1. Prefer Google Native voices (very high quality on Chrome)
    // 2. Prefer voices with "Natural" or "Premium" in name
    // 3. Fallback to any French voice
    const frVoice = 
      frVoices.find(v => v.name.includes('Google') || v.name.includes('français')) || 
      frVoices.find(v => v.name.includes('Natural') || v.name.includes('Premium')) ||
      frVoices.find(v => v.name.includes('Hortense')) ||
      frVoices[0];
    
    if (frVoice) utterance.voice = frVoice;
    
    synthRef.current.speak(utterance);
  };

  const handleTeacherQuery = async (queryText: string) => {
    if (!queryText.trim()) return;

    const normalizedQuery = queryText.trim().toLowerCase();

    // 1. Recherche instantanée en cache (localStorage)
    const cache = getCache();
    if (cache[normalizedQuery]) {
      const cached = cache[normalizedQuery];
      setDisplayedResponse(cached.text);
      setTeacherResponse(cached.text);
      setActiveDisclaimer(cached.disclaimer);
      speak(cached.text);
      
      if (user) {
        const path = `users/${user.uid}/teacher_history`;
        addDoc(collection(db, path), {
          role: 'user', content: queryText, createdAt: serverTimestamp()
        }).catch(() => {});
        addDoc(collection(db, path), {
          role: 'assistant', content: cached.text, createdAt: serverTimestamp()
        }).catch(() => {});
      }
      return;
    }

    setIsLoading(true);
    setLoadingStatus("Archives...");
    setTeacherResponse('');
    
    const allDocs = [...globalDocs, ...personalDocs];

    try {
      if (user) {
        const path = `users/${user.uid}/teacher_history`;
        addDoc(collection(db, path), {
          role: 'user',
          content: queryText,
          createdAt: serverTimestamp()
        }).catch(() => {});
      }

      // Optimisation : Filtrage intelligent du contexte (RAG amélioré sémantiquement)
      const normalizeStr = (str: string) => {
        return str
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, " ");
      };

      const stopWords = ['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en', 'ce', 'que', 'qui', 'est', 'pour', 'dans', 'par', 'sur', 'avec', 'aux'];
      const keywords = queryText.toLowerCase()
        .replace(/[?.!,;]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.includes(w));
      
      const scoredDocs = allDocs.map(d => {
        const normName = normalizeStr(d.name);
        const normContent = normalizeStr(d.content);
        const normQuery = normalizeStr(queryText);
        
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
          const isImageQuery = /image|affiche|montre|génère|dessine|photo|regarder|voir|schema|schéma/i.test(queryText);
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
        relevantDocs = allDocs.slice(0, 4).map(d => ({ ...d, score: 0 }));
      }

      setScannedCount(relevantDocs.length);
      setLoadingStatus("Synthèse...");
      
      const allFilesList = allDocs
        .map((d, i) => `- [${d.name}] (${d.type?.startsWith('image/') ? 'Image / Visuel' : 'Document de Cours'})`)
        .join('\n');

      const context = `LISTE COMPLÈTE DE TOU(TE)S LES FICHIERS ET IMAGES DANS LA BASE DE DONNÉES (${allDocs.length} ELEMENTS) :
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
}).join('\n\n')}`;

      setDisplayedResponse("");
      
      const historyContents = (history || [])
        .slice(0, 4) // Historique limité pour la rapidité
        .reverse()
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content || "" }]
        }));

      const ai = getActiveGeminiClient();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.5-flash", 
        contents: [
          ...historyContents,
          { role: "user", parts: [{ text: queryText }] }
        ],
        config: {
          systemInstruction: `Tu es un professeur de chimie chaleureux, passionné, bienveillant et pédagogue du Collège Catts Pressoir.
          Ta mission est de répondre en utilisant EXCLUSIVEMENT les documents fournis dans le CONTEXTE.
          
          POSTURE ET TON PEDAGOGIQUE :
          - Exprime-toi comme un enseignant attentionné et enthousiaste s'adressant de vive voix à son élève (ex: "Très bonne question !", "Voyons cela en détail !", "C'est fascinant, tu vas voir :").
          - Sois extrêmement pédagogue, positif et encourageant, sans jamais paraître robotique ou distant.
          - Utilise des explications claires et s'il y a lieu de courtes métaphores scientifiques stimulantes.
          
          RÈGLES CRITIQUES:
          1. Répons en 1 ou 2 phrases concises (car ta réponse est lue ou affichée en direct).
          2. Si l'information est présente dans le CONTEXTE, donne la réponse directement sans citer les fichiers.
          3. SÉCURITÉ & HORS-SUJET:
          - Si la question porte sur la CHIMIE ou la PHYSIQUE mais que l'info est ABSENTE du contexte : Réponds que l'info n'est pas dans les archives, mais PROPOSE explicitement de donner l'information via tes connaissances générales en précisant qu'elle ne sera pas vérifiée par le collège.
          - Si la question est HORS-SUJET (culture générale, quotidien, etc.) : Réponds que c'est en dehors de ton champ de compétence et que tu es limité exclusivement aux sujets de CHIMIE.
          4. [FALLBACK] : Si l'utilisateur accepte ta proposition ou si tu donnes une info hors-contexte, commence OBLIGATOIREMENT par "[FALLBACK]".
          5. IMAGES & VISUELS : Si on te demande de générer ou d'afficher une image ou séquence d'images présente dans le CONTEXTE, insère le tag [[IMAGE:nom_du_fichier]] correspondant pour l'image.
          6. MODÉLISATION 3D : Si l'utilisateur pose une question sur une réaction ou des molécules, ou si cela aide à sa compréhension, ajoute obligatoirement à la toute fin de ta réponse un bloc [MOLECULE_DATA]...[/MOLECULE_DATA] strict et valide.
             RÈGLES ABSOLUES DE MODÉLISATION MULTIPLE ET RIGOUREUSE :
             - Tu dois obligatoirement inclure TOUTES les molécules et tous les atomes dont tu as parlé dans l'explication. Ne te résigne jamais à une seule si plusieurs sont mentionnées.
             - Pour éviter toute superposition confuse dans le visualiseur 3D, espace de façon des coordonnées/positions spatiales (axes X, Y, Z). Décale chaque entité chimique d'au moins 2.5 à 3.0 unités par rapport aux autres (ex: entité A centrée à [-2.0, 0.5, 0], entité B centrée à [2.0, -0.5, 0]).
             - Chaque atome/noeud doit posséder un "id" unique sous forme de nombre entier incrémental (0, 1, 2, 3...).
             - Les liens ("links") doivent lier rigoureusement les bonnes sources et cibles d'IDs (par exemple, "source": 0, "target": 1). Aucun lien orphelin n'est toléré.
             - Le JSON doit être syntaxiquement parfait, sans virgule finale en trop, et avec des guillemets doubles réglementaires.
             - N'oublie jamais la balise fermante [/MOLECULE_DATA] à la toute fin pour garantir l'extraction.
             
             Exemple de format valide :
             [MOLECULE_DATA]
             {
               "name": "Synthèse de l'eau (Réactifs et Produits)",
               "formula": "2H2 + O2 -> 2H2O",
               "nodes": [
                 { "id": 0, "element": "H", "position": [-3.0, 0.5, 0] },
                 { "id": 1, "element": "H", "position": [-2.0, 0.5, 0] },
                 { "id": 2, "element": "O", "position": [0.0, 0.0, 0] },
                 { "id": 3, "element": "O", "position": [0.0, 1.0, 0] },
                 { "id": 4, "element": "O", "position": [3.0, 0.0, 0] },
                 { "id": 5, "element": "H", "position": [3.7, -0.4, 0] },
                 { "id": 6, "element": "H", "position": [2.3, -0.4, 0] }
               ],
               "links": [
                 { "source": 0, "target": 1 },
                 { "source": 2, "target": 3 },
                 { "source": 4, "target": 5 },
                 { "source": 4, "target": 6 }
               ]
             }
             [/MOLECULE_DATA]
             Ne mentionne jamais ce bloc de données [MOLECULE_DATA] dans ton texte parlé, génère-le simplement discrètement à la toute fin.
          
          ${context}`
        },
        signal: abortController.signal
      });

      let fullResponse = "";
      
      // Iterate through the stream and update the display in real-time
      for await (const chunk of responseStream) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullResponse += chunkText;
          // Clean the tags during display streaming and hide the [FALLBACK] and [UNVERIFIED] text
          const visibleText = fullResponse
            .replace(/\[FALLBACK\]/g, '')
            .replace(/\[UNVERIFIED\]/g, '')
            .trim();
          setDisplayedResponse(visibleText);
        }
      }

      // Reset abort controller ref once complete
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }

      if (fullResponse.includes('[FALLBACK]')) {
        setActiveDisclaimer("Cette information n'est pas disponible dans les archives. Réponse basée sur des connaissances générales (non vérifiée).");
      } else if (fullResponse.includes('[UNVERIFIED]')) {
        setActiveDisclaimer("Note : Cette réponse utilise des connaissances générales non vérifiées par le Collège Catts Pressoir.");
      } else {
        setActiveDisclaimer(null);
      }

      const responseText = fullResponse
        .replace('[FALLBACK]', '')
        .replace('[UNVERIFIED]', '')
        .trim() || "Désolé, je n'ai pas pu générer de réponse.";

      // Mettre en cache la réponse propre
      saveToCache(normalizedQuery, { text: responseText, disclaimer: activeDisclaimer });
      
      // Extract molecule data if present
      let cleanContent = responseText;
      const moleculeMatch = responseText.match(/\[MOLECULE_DATA\]([\s\S]*?)(?:\[\/MOLECULE_DATA\]|$)/);
      if (moleculeMatch) {
         cleanContent = responseText.replace(/\[MOLECULE_DATA\][\s\S]*?(?:\[\/MOLECULE_DATA\]|$)/, '').trim();
      }

      // Final UI text should also clean the [[term|def|type]] syntax for display if not using a special component
      const displayContent = cleanContent.replace(/\[\[(.*?)\|(.*?)\|(.*?)\]\]/g, '$1');

      if (user) {
        const path = `users/${user.uid}/teacher_history`;
        // Non-blocking history update
        addDoc(collection(db, path), {
          role: 'assistant',
          content: displayContent,
          createdAt: serverTimestamp()
        }).catch(e => handleFirestoreError(e, OperationType.CREATE, path, false));
      }

      setTeacherResponse(displayContent);
      
      // Nettoyer la syntaxe pour la synthèse vocale
      const cleanVoiceText = cleanContent
        .replace(/\[\[(.*?)\|(.*?)\|(.*?)\]\]/g, '$1') // Nettoyage termes clics
        .replace(/\$(.*?)\$/g, '$1')                   // Enlever les $ du LaTeX
        .replace(/(\w)_(\d+)/g, '$1 $2')               // H_2 -> H 2
        .replace(/\^([-+])/g, ' ion $1')              // OH^- -> OH ion -
        .replace(/\bOH\b/g, 'O H');                    // OH -> O H pour une meilleure diction
      
      speak(cleanVoiceText);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.log("Teacher generation aborted by user.");
        return;
      }
      console.error("VirtualTeacher Error:", error);
      const errorMessage = error?.message || "";
      if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("429")) {
        setTeacherResponse("Désolé, la limite d'utilisation de l'IA a été atteinte pour le moment. Veuillez réessayer dans quelques minutes.");
      } else {
        setTeacherResponse(`⚠️ Erreur : ${errorMessage || "Désolé, une erreur est survenue lors de la génération de la réponse."}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    queryHandlerRef.current = handleTeacherQuery;
  }, [handleTeacherQuery]);

  const clearHistory = async () => {
    if (!user || !confirm("Voulez-vous vraiment effacer l'historique du prof virtuel ?")) return;
    try {
      // In a real app we'd batch delete, but for now we'll just delete what's in state
      for (const msg of history) {
        await deleteDoc(doc(db, `users/${user.uid}/teacher_history`, msg.id));
      }
    } catch (e) {
      console.error("Failed to clear history", e);
    }
  };

  const toggleListening = () => {
    if (isStarting) return;

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch (e) {
        // Ignore stop errors
      }
      setIsListening(false);
    } else {
      setIsStarting(true);
      setTeacherResponse('');
      setActiveDisclaimer(null);
      setIsSpeaking(false);
      synthRef.current?.cancel();
      
      // Clean up previous instance
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch(e) {}
      }

      // Create a fresh instance for this session
      const recognition = initSpeechRecognition();
      if (!recognition) {
        alert("La reconnaissance vocale n'est pas supportée sur ce navigateur.");
        setIsStarting(false);
        return;
      }
      
      recognitionRef.current = recognition;
      
      // Short delay to allow browser to reset audio context
      setTimeout(() => {
        try {
          recognition.start();
        } catch (e) {
          console.error("Failed to start recognition:", e);
          setIsStarting(false);
          setIsListening(false);
        }
      }, 150);
    }
  };

  const renderTeacherResponse = (text: string) => {
    // Split by image tags like [[IMAGE:example.jpg]]
    const parts = text.split(/(\[\[IMAGE:.*?\]\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[[IMAGE:') && part.endsWith(']]')) {
        const imageName = part.slice(8, -2).trim();
        const found = [...globalDocs, ...personalDocs].find(
          d => d.name.toLowerCase() === imageName.toLowerCase()
        );
        if (found && found.content && (found.content.startsWith('data:image/') || /\.(jpg|jpeg|png|webp)$/i.test(found.name))) {
          return (
            <span key={i} className="block my-4 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-md max-w-sm mx-auto relative group">
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
                  className="text-[9px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1 rounded animate-none shadow-none"
                >
                  Télécharger
                </a>
              </span>
            </span>
          );
        } else {
          return (
            <span key={i} className="block my-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-200">
              ⚠️ Image: <strong>{imageName}</strong> introuvable.
            </span>
          );
        }
      }
      return (
        <ReactMarkdown 
          key={i}
          remarkPlugins={[remarkMath]} 
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <span className="inline whitespace-pre-wrap">{children}</span>
          }}
        >
          {part}
        </ReactMarkdown>
      );
    });
  };

  // Live Animated Aura Visualizations corresponding to Gemini Live states
  const renderLiveAura = () => {
    // Shared Liquid Color Orb Atmosphere that handles organic blending
    const renderGeminiAtmosphere = (speedClass: string, isBig: boolean) => {
      const speedFactor = speedClass === 'fast' ? 0.4 : speedClass === 'slow' ? 2.5 : 1;
      return (
        <div className={cn(
          "absolute inset-0 rounded-full overflow-hidden transition-transform duration-1000 pointer-events-none",
          isBig ? "scale-150" : "scale-110"
        )}>
          {/* Luminous Core Orbs with extremely smooth keyframes */}
          <motion.div 
            animate={{
              x: [-40, 40, -20, -40],
              y: [-20, 50, 20, -20],
              scale: [1, 1.4, 0.8, 1],
              rotate: [0, 180, 360]
            }}
            transition={{ duration: 10 * speedFactor, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-48 h-48 md:w-64 md:h-64 rounded-full bg-gradient-to-tr from-cyan-450/30 to-teal-500/20 opacity-80 blur-[80px] top-1/4 left-1/4" 
          />
          <motion.div 
            animate={{
              x: [40, -40, 30, 40],
              y: [50, -20, 60, 50],
              scale: [1.2, 0.9, 1.3, 1.2],
              rotate: [360, 180, 0]
            }}
            transition={{ duration: 12 * speedFactor, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-48 h-48 md:w-64 md:h-64 rounded-full bg-gradient-to-tr from-purple-500/30 to-pink-500/20 opacity-85 blur-[90px] top-1/3 right-1/4" 
          />
          <motion.div 
            animate={{
              x: [-20, 20, -30, -20],
              y: [30, -35, 10, 30],
              scale: [0.9, 1.2, 1, 0.9]
            }}
            transition={{ duration: 14 * speedFactor, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-52 h-52 md:w-72 md:h-72 rounded-full bg-gradient-to-tr from-rose-500/25 to-amber-500/15 opacity-70 blur-[100px] bottom-1/4 left-1/3" 
          />
          {/* Ultimate central luminous color blend */}
          <div className="absolute inset-0 bg-transparent backdrop-blur-3xl" />
        </div>
      );
    };

    if (isLoading) {
      // Thinking state: Highly scientific neural color halo rotating elegantly
      return (
        <div id="teacher-live-aura-loading" className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {renderGeminiAtmosphere('fast', true)}
          
          {/* Glowing orbital ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="absolute w-52 h-52 md:w-60 md:h-60 rounded-full border border-dashed border-cyan-400/40 p-1 flex items-center justify-center"
          >
            <div className="w-full h-full rounded-full border border-dotted border-purple-400/40" />
          </motion.div>

          <motion.div
            animate={{ 
              scale: [1, 1.05, 1],
              boxShadow: [
                "0 0 40px rgba(34,211,238,0.25)",
                "0 0 60px rgba(139,92,246,0.4)",
                "0 0 40px rgba(34,211,238,0.25)"
              ]
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="w-44 h-44 md:w-52 md:h-52 rounded-full flex flex-col items-center justify-center bg-slate-950/45 border border-white/10 backdrop-blur-2xl relative z-10 p-5 text-center"
          >
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="flex flex-col items-center justify-center animate-none"
            >
              <Sparkles className="w-10 h-10 text-cyan-300 animate-pulse mb-3" />
              <span className="text-[10px] text-cyan-200 font-extrabold uppercase tracking-[0.25em] leading-normal">{loadingStatus}</span>
            </motion.div>
          </motion.div>
        </div>
      );
    }

    if (isListening) {
      // Listening state: Live audio voice waveform with organic ribbons
      return (
        <div id="teacher-live-aura-listening" className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {renderGeminiAtmosphere('normal', true)}
          
          {/* Vibrating Outer Shell */}
          <motion.div
            animate={{ scale: [1, 1.12, 0.98, 1.05, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-56 h-56 md:w-64 md:h-64 rounded-full bg-pink-500/5 border border-pink-400/20 blur-sm pointer-events-none"
          />

          <div className="w-44 h-44 md:w-52 md:h-52 rounded-full border border-white/15 flex items-center justify-center bg-slate-950/40 backdrop-blur-2xl relative z-10 shadow-[0_0_60px_rgba(244,63,94,0.3)] overflow-hidden">
            <div className="absolute inset-2 flex items-center justify-center">
              <svg viewBox="0 0 200 100" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="glowCyan" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
                    <stop offset="50%" stopColor="#22d3ee" stopOpacity="1" />
                    <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="glowPurple" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ec4899" stopOpacity="0" />
                    <stop offset="50%" stopColor="#a855f7" stopOpacity="1" />
                    <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="glowGold" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0" />
                    <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                  </linearGradient>
                </defs>
                
                {/* 3 morphing wavy lines */}
                <motion.path
                  d="M 10 50 Q 55 10, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowCyan)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 15, 100 50 T 190 50",
                      "M 10 50 Q 55 85, 100 50 T 190 50",
                      "M 10 50 Q 55 15, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                />
                
                <motion.path
                  d="M 10 50 Q 55 80, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowPurple)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 90, 100 50 T 190 50",
                      "M 10 50 Q 55 10, 100 50 T 190 50",
                      "M 10 50 Q 55 90, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                />

                <motion.path
                  d="M 10 50 Q 55 30, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowGold)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 20, 100 50 T 190 50",
                      "M 10 50 Q 55 70, 100 50 T 190 50",
                      "M 10 50 Q 55 20, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </svg>
            </div>
          </div>
        </div>
      );
    }

    if (isSpeaking) {
      // Speaking state: Super responsive glowing equalizer waves
      return (
        <div id="teacher-live-aura-speaking" className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {renderGeminiAtmosphere('normal', true)}
          
          <div className="w-44 h-44 md:w-52 md:h-52 rounded-full border border-white/20 flex items-center justify-center bg-slate-950/30 backdrop-blur-2xl relative z-10 shadow-[0_0_60px_rgba(99,102,241,0.45)] overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <svg viewBox="0 0 200 100" className="w-full h-full overflow-visible">
                <motion.path
                  d="M 10 50 Q 55 5, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowCyan)"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 0, 100 50 T 190 50",
                      "M 10 50 Q 55 100, 100 50 T 190 50",
                      "M 10 50 Q 55 10, 100 50 T 190 50",
                      "M 10 50 Q 55 40, 100 50 T 190 50",
                      "M 10 50 Q 55 0, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 0.95, repeat: Infinity, ease: "easeInOut" }}
                />
                
                <motion.path
                  d="M 10 50 Q 55 95, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowPurple)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 95, 100 50 T 190 50",
                      "M 10 50 Q 55 5, 100 50 T 190 50",
                      "M 10 50 Q 55 80, 100 50 T 190 50",
                      "M 10 50 Q 55 50, 100 50 T 190 50",
                      "M 10 50 Q 55 95, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut" }}
                />

                <motion.path
                  d="M 10 50 Q 55 20, 100 50 T 190 50"
                  fill="none"
                  stroke="url(#glowGold)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{
                    d: [
                      "M 10 50 Q 55 15, 100 50 T 190 50",
                      "M 10 50 Q 55 85, 100 50 T 190 50",
                      "M 10 50 Q 55 5, 100 50 T 190 50",
                      "M 10 50 Q 55 55, 100 50 T 190 50",
                      "M 10 50 Q 55 15, 100 50 T 190 50"
                    ]
                  }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
                />
              </svg>
            </div>
          </div>
        </div>
      );
    }

    // Default Idle state - Elegant, breathing multi-colored glass core orb with orbiting rings
    return (
      <div 
        id="teacher-live-aura-idle" 
        className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center group cursor-pointer animate-none" 
        onClick={toggleListening}
      >
        {renderGeminiAtmosphere('slow', false)}
        
        {/* Soft elegant glass globe outer container */}
        <div className="w-44 h-44 md:w-52 md:h-52 rounded-full border border-white/20 flex flex-col items-center justify-center bg-slate-950/20 backdrop-blur-xl relative z-10 transition-all duration-700 group-hover:border-cyan-300 group-hover:shadow-[0_0_60px_rgba(34,211,238,0.35)] shadow-[inset_0_4px_30px_rgba(255,255,255,0.08)]">
          <div className="relative">
            {/* Glowing ring under mic */}
            <div className="absolute inset-0 bg-cyan-400/20 blur-xl rounded-full scale-150 animate-pulse pointer-events-none" />
            <Mic className="w-12 h-12 text-slate-100 relative z-10 group-hover:text-cyan-300 transform group-hover:scale-110 transition-all duration-500 animate-none" />
          </div>
          <span className="text-[10px] font-extrabold tracking-[0.3em] uppercase text-slate-200 mt-4 opacity-90 group-hover:opacity-100 group-hover:text-cyan-300 transition-colors">Activer Live</span>
          
          {/* Orbits rotating in opposite directions on hovering */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            className="absolute inset-2 border border-dotted border-cyan-400/20 rounded-full pointer-events-none group-hover:border-cyan-400/40"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
            className="absolute inset-5 border border-dashed border-pink-500/15 rounded-full pointer-events-none group-hover:border-pink-500/30"
          />
        </div>
      </div>
    );
  };

  return (
    <div 
      id="teacher-live-container" 
      className="flex flex-col h-full items-center justify-center p-4 md:p-6 relative overflow-hidden bg-white text-slate-800 animate-none"
    >
      {/* Immersive deep radial glowing ambiance */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.06)_0%,transparent_75%)]" />
      
      {/* Sidebar Toggle Button */}
      {!isSidebarOpen && (
        <div className="absolute top-6 left-6 z-20">
          <Button 
            id="teacher-sidebar-toggle-btn"
            variant="ghost" 
            size="icon" 
            onClick={onToggleSidebar}
            className="text-slate-500 hover:text-slate-850 hover:bg-slate-100 rounded-xl"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </Button>
        </div>
      )}
  
      {/* History Toggle Button */}
      <div className="absolute top-6 right-6 z-20">
        <Button 
          id="teacher-history-toggle-btn"
          variant="outline" 
          size="sm" 
          onClick={() => setShowHistory(!showHistory)}
          className="rounded-xl gap-2 bg-slate-50 border-slate-200 text-slate-705 hover:bg-slate-100 hover:text-slate-900 backdrop-blur-md shadow-xs"
        >
          <History className="w-4 h-4" />
          {showHistory ? "Fermer l'historique" : "Historique"}
        </Button>
      </div>
  
      <ScrollArea id="teacher-main-scroll-area" className="w-full h-full min-h-0">
        <div className="max-w-2xl mx-auto min-h-full flex flex-col items-center justify-center gap-8 md:gap-12 py-12">
          
          <AnimatePresence mode="wait">
            {showHistory ? (
              <motion.div 
                key="history"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="w-full space-y-6"
              >
                <div className="flex items-center justify-between px-2">
                  <div className="space-y-1">
                    <h3 className="text-xl font-display font-black text-slate-800 tracking-tight uppercase">HISTORIQUE</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Vos échanges vocaux récents</p>
                  </div>
                  <Button 
                    id="teacher-clear-history-btn"
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHistory} 
                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 gap-2 rounded-xl h-9 px-4 border border-slate-100"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="text-[10px] uppercase font-black tracking-widest">Tout effacer</span>
                  </Button>
                </div>
                <div className="space-y-4">
                  {(history || []).map((msg) => (
                    <motion.div 
                      key={msg.id} 
                      initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div className={cn(
                        "px-5 py-3 rounded-[1.5rem] text-sm leading-relaxed shadow-xs transition-all",
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-tr-none' 
                          : 'bg-slate-50 border border-slate-100/80 text-slate-700 rounded-tl-none'
                      )}>
                        {msg.content}
                      </div>
                      <span className="text-[9px] text-slate-400 uppercase tracking-widest font-black px-2">
                        {msg.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </motion.div>
                  ))}
                  {history.length === 0 && (
                    <div className="text-center py-24 bg-slate-50/50 rounded-[2.5rem] border border-dashed border-slate-200">
                      <p className="text-slate-500 italic text-sm font-medium">Aucun historique pour le moment.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="teacher-ui"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center gap-10 w-full"
              >
                <div className="text-center space-y-3">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-50 border border-cyan-100 text-cyan-600 mb-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Prof Live AI</span>
                  </div>
                  <h2 className="text-3xl md:text-5xl font-display font-black text-slate-800 tracking-tight uppercase">PROF VIRTUEL</h2>
                  <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                    Parlez naturellement ou tapez vos questions pour explorer les archives de cours de chimie.
                  </p>
                  
                  {/* Context Status Badge */}
                  <div className="flex items-center justify-center gap-2 mt-4" id="teacher-archives-status-badge">
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1.5 border rounded-2xl transition-all shadow-xs bg-slate-50/50",
                      (globalDocs.length + personalDocs.length > 0) 
                        ? "border-emerald-200 text-emerald-600 bg-emerald-50/40" 
                        : "border-amber-200 text-amber-600 bg-amber-50/40"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        (globalDocs.length + personalDocs.length > 0) ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                      )} />
                      <span className="text-[9px] uppercase tracking-wider font-bold">
                        {globalDocs.length + personalDocs.length} Archives Chargées
                      </span>
                    </div>
                  </div>
                </div>
  
                {/* Visualizer and dynamic ripples in central aura */}
                <div className="relative animate-none" id="teacher-live-aura-card">
                  {renderLiveAura()}
                </div>
  
                {/* Main Streaming Output Content Text Box */}
                <div 
                  id="teacher-text-display-card"
                  className="w-full min-h-[160px] bg-white/70 border border-slate-150/60 backdrop-blur-2xl rounded-[2.5rem] p-8 md:p-10 shadow-[0_20px_50px_rgba(15,23,42,0.06)] flex flex-col items-center justify-center text-center relative overflow-hidden transition-all"
                >
                  <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
                  
                  <AnimatePresence mode="wait">
                    {showTextInput ? (
                      <motion.form 
                        id="teacher-text-input-form"
                        key="text-input"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (textInput.trim()) {
                            handleTeacherQuery(textInput);
                            setTextInput('');
                            setShowTextInput(false);
                          }
                        }}
                        className="w-full flex items-center gap-3 bg-[#f8f9fa] p-2 rounded-2xl border border-slate-200/80 shadow-inner"
                      >
                        <input 
                          id="teacher-text-input-field"
                          autoFocus
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          placeholder="Démarrez un apprentissage en tapant ici..."
                          className="flex-1 bg-transparent focus:ring-0 outline-none text-slate-800 text-sm px-4 py-2 font-medium placeholder-slate-400"
                        />
                        <Button 
                          id="teacher-send-input-btn"
                          type="submit" 
                          size="sm" 
                          className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-xl px-4 py-1.5 h-9"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </motion.form>
                    ) : isLoading ? (
                      <motion.div key="loading" className="flex flex-col items-center gap-4">
                        <div className="relative">
                          <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                          <motion.div 
                            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="absolute inset-0 bg-cyan-200/10 blur-xl rounded-full"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-black text-cyan-600 uppercase tracking-[0.3em] animate-pulse">
                            {loadingStatus}
                          </p>
                          {scannedCount > 0 && (
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                              Exploration des documents ({scannedCount})
                            </p>
                          )}
                        </div>
                        {/* Square cancel button inside the loader frame! */}
                        <Button
                          id="teacher-cancel-generation-loader-btn"
                          variant="outline"
                          onClick={stopAll}
                          className="mt-2 bg-[#f1f3f5] hover:bg-[#e9ecef] border border-slate-200 text-slate-600 hover:text-slate-850 rounded-xl w-11 h-11 flex items-center justify-center shadow-lg transition-all shrink-0 animate-none"
                          title="Annuler la génération"
                        >
                          <Square className="w-4 h-4 fill-slate-500 stroke-none" />
                        </Button>
                      </motion.div>
                    ) : isListening ? (
                      <motion.div 
                        key="listening" 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center gap-2"
                      >
                        <p className="text-pink-500 font-black tracking-[0.2em] uppercase text-xs animate-pulse">
                          Microphone Écoute en Direct
                        </p>
                        <p className="text-slate-600 text-sm font-medium">Prononcez votre question...</p>
                      </motion.div>
                    ) : displayedResponse ? (
                      <motion.div 
                        key="response" 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4 w-full animate-none"
                      >
                        <div className="text-lg md:text-xl text-slate-800 leading-relaxed font-semibold tracking-wide text-left md:text-center max-h-[250px] overflow-y-auto">
                          {renderTeacherResponse(displayedResponse)}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.p key="idle" className="text-slate-400 text-lg font-medium">
                        Dites quelque chose pour commencer... 👋
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
  
                {/* Secondary Stop/Interrupt Controller Panel - Clean grey square button */}
                {(isLoading || isSpeaking) && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="flex flex-col items-center gap-2"
                  >
                    <p className="text-[9px] text-slate-450 font-black uppercase tracking-[0.2em]">Annuler la Réponse</p>
                    <Button
                      id="teacher-stop-btn"
                      variant="outline"
                      onClick={stopAll}
                      className="bg-[#f1f3f5] hover:bg-[#e9ecef] border border-slate-200 text-slate-650 hover:text-slate-850 rounded-xl w-14 h-14 flex items-center justify-center shadow-lg transition-all shrink-0 animate-none"
                      title="Annuler la génération"
                    >
                      <Square className="w-5 h-5 fill-slate-500 stroke-none" />
                    </Button>
                  </motion.div>
                )}
  
                {/* Floating Navigation / Control Dock */}
                <div className="flex items-center gap-6 bg-white/80 p-4 border border-slate-150/80 shadow-lg rounded-[2.5rem] backdrop-blur-xl">
                  {/* Speaker reset button */}
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button 
                      id="teacher-audio-config-btn"
                      variant="outline" 
                      size="icon" 
                      onClick={() => {
                        recognitionRef.current = initSpeechRecognition();
                        setTeacherResponse("Microphone réinitialisé.");
                        stopAll();
                      }}
                      className="w-14 h-14 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-805 transition-all shadow-md"
                    >
                      <Volume2 className="w-5 h-5" />
                    </Button>
                  </motion.div>
                  
                  {/* Primary record mic toggle orb */}
                  <motion.div 
                    whileHover={{ scale: 1.05 }} 
                    whileTap={{ scale: 0.95 }}
                    className="relative"
                  >
                    {isListening && (
                      <motion.div 
                        layoutId="mic-bg"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1.25 }}
                        className="absolute inset-0 bg-red-500/15 blur-2xl rounded-full"
                      />
                    )}
                    <Button 
                      id="teacher-mic-toggle-btn"
                      onClick={toggleListening}
                      disabled={isLoading}
                      className={cn(
                        "w-20 h-20 md:w-22 md:h-22 rounded-full shadow-2xl transition-all duration-500 relative z-10 font-bold",
                        isListening 
                          ? 'bg-red-500 hover:bg-red-600 text-white rotate-90 shadow-red-500/20' 
                          : 'bg-white hover:bg-slate-100 text-slate-900 border border-slate-200 shadow-md'
                      )}
                    >
                      {isListening ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8" />}
                    </Button>
                  </motion.div>
  
                  {/* Keyboard input open toggle button */}
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button 
                      id="teacher-text-toggle-btn"
                      variant="outline" 
                      size="icon" 
                      onClick={() => setShowTextInput(!showTextInput)}
                      className={cn(
                        "w-14 h-14 rounded-full border-slate-200 bg-slate-50 text-slate-600 transition-all shadow-md",
                        showTextInput 
                          ? 'bg-cyan-500 text-white border-cyan-500 scale-110 shadow-lg shadow-cyan-400/20' 
                          : 'hover:bg-slate-105 hover:text-slate-800'
                      )}
                    >
                      <MessageSquare className="w-5 h-5" />
                    </Button>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
  
      {/* Footer Disclaimer Area - Fixed at the very bottom */}
      <AnimatePresence>
        {activeDisclaimer && (
          <motion.div 
            id="teacher-bottom-disclaimer-banner"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-6"
          >
            <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-[0_10px_35px_rgba(15,23,42,0.08)] flex items-center gap-4 backdrop-blur-xl">
               <div className="shrink-0 p-2 bg-amber-5 border border-amber-100 rounded-xl">
                 <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
               </div>
               <div className="flex-1">
                 <p className="text-[9px] text-slate-400 uppercase tracking-widest font-extrabold mb-0.5">Note Importante</p>
                 <p className="text-xs text-slate-700 leading-normal font-semibold">
                   {activeDisclaimer}
                 </p>
               </div>
               <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setActiveDisclaimer(null)}
                className="text-slate-400 hover:text-slate-800 shrink-0 h-8 w-8 hover:bg-slate-100 rounded-lg"
               >
                 <X className="w-4 h-4" />
               </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
