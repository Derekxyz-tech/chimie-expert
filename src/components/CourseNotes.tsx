import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileUp, 
  FileText, 
  X, 
  Loader2, 
  BookOpen, 
  Sparkles, 
  CheckCircle2, 
  Trash2, 
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  FileSearch,
  PanelLeftOpen,
  FileImage,
  Brain,
  Award,
  HelpCircle,
  Check,
  RotateCcw,
  Video,
  Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import mammoth from 'mammoth';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getActiveGeminiClient } from '../lib/gemini';
import { db, User, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { Type } from "@google/genai";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface DefinitionItem {
  term: string;
  definition: string;
}

interface FlashcardItem {
  question: string;
  answer: string;
}

interface QuizItem {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

interface ExerciseItem {
  title: string;
  statement: string;
  solution: string;
}

interface CourseAnalysis {
  resume: string;
  definitions: DefinitionItem[];
  flashcards: FlashcardItem[];
  quiz: QuizItem[];
  exercises: ExerciseItem[];
}

interface CourseFile {
  id: string;
  name: string;
  content: string;
  type: string;
  size: number;
  uploadDate: Date;
}

interface CourseNotesProps {
  user: User | null;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function CourseNotes({ user, isSidebarOpen, onToggleSidebar }: CourseNotesProps) {
  const [personalFiles, setPersonalFiles] = useState<CourseFile[]>([]);
  const [globalFiles, setGlobalFiles] = useState<CourseFile[]>([]);
  const [isGlobalMode, setIsGlobalMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [newVideoName, setNewVideoName] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [videoSource, setVideoSource] = useState<'file' | 'url'>('file');
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{ name: string; content: string; type: string } | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CourseAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'analysis'>('files');
  const [currentSubTab, setCurrentSubTab] = useState<'resume' | 'definitions' | 'flashcards' | 'quiz' | 'exercises'>('resume');

  // Interactive analysis sub-states
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [currentQuizIdx, setCurrentQuizIdx] = useState<number>(0);
  const [isQuizComplete, setIsQuizComplete] = useState<boolean>(false);
  const [expandedSolutions, setExpandedSolutions] = useState<Record<number, boolean>>({});

  const isAdmin = user?.email && ["ghostytb77777@gmail.com", "christianst731@gmail.com", "cyrillealexandrinahall@gmail.com"].includes(user.email);
  const files = isGlobalMode ? globalFiles : personalFiles;

  // Load personal files
  useEffect(() => {
    if (!user) {
      setPersonalFiles([]);
      return;
    }

    const q = query(
      collection(db, `users/${user.uid}/documents`)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
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
          id: doc.id,
          name: data.name || '',
          content: data.content || '',
          type: data.type || 'text/plain',
          size: data.size || 0,
          uploadDate
        };
      }) as CourseFile[];
      // Sort in-memory latest first
      docs.sort((a, b) => (b.uploadDate?.getTime?.() || 0) - (a.uploadDate?.getTime?.() || 0));
      setPersonalFiles(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/documents`, false);
    });

    return () => unsubscribe();
  }, [user]);

  // Set global mode to true for admins by default so they upload to and read the global folder automatically
  useEffect(() => {
    if (user && isAdmin) {
      setIsGlobalMode(true);
    }
  }, [user, isAdmin]);

  // Automatic sync/migration of accidental personal uploads by any admin to the global database
  useEffect(() => {
    if (user && isAdmin && personalFiles.length > 0 && globalFiles.length > 0) {
      const migrateAccidentalUploads = async () => {
        for (const file of personalFiles) {
          const alreadyExists = globalFiles.some(
            (gf) => gf.name.toLowerCase() === file.name.toLowerCase() || gf.content === file.content
          );
          if (!alreadyExists) {
            console.log(`Auto-migrating accidental personal upload "${file.name}" to global custom database`);
            try {
              await addDoc(collection(db, 'knowledge_base'), {
                uid: user.uid,
                name: file.name,
                content: file.content,
                type: file.type || 'text/plain',
                size: file.size || 0,
                createdAt: serverTimestamp()
              });
            } catch (err) {
              console.error(`Failed to migrate "${file.name}" to knowledge_base:`, err);
            }
          }
          // Now safely clean up the personal document to prevent duplicate counts and confusion
          try {
            await deleteDoc(doc(db, `users/${user.uid}/documents`, file.id));
          } catch (err) {
            console.error(`Failed to clean up duplicate personal document "${file.name}":`, err);
          }
        }
      };
      migrateAccidentalUploads();
    }
  }, [user, isAdmin, personalFiles, globalFiles]);

  // Load global files
  useEffect(() => {
    const q = query(collection(db, 'knowledge_base'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = (snapshot.docs || []).map(doc => ({
        id: doc.id,
        ...doc.data(),
        uploadDate: (doc.data().createdAt as any)?.toDate() || new Date()
      })) as CourseFile[];
      
      // Sort in memory to avoid index requirements and missing timestamp issues
      docs.sort((a, b) => (b.uploadDate?.getTime?.() || 0) - (a.uploadDate?.getTime?.() || 0));
      
      setGlobalFiles(docs);
    }, (error) => {
      // Non-logged in users might not be able to list, but our rules say read: true
      // LIST might be different from READ depending on how Firestore behaves with wildcards
      // but usually list is read on collection.
      console.warn("Global files load error:", error);
    });

    return () => unsubscribe();
  }, []);

  const handleCloseUrlModal = () => {
    setIsUrlModalOpen(false);
    setNewVideoName('');
    setNewVideoUrl('');
    setSelectedVideoFile(null);
    setVideoError(null);
  };

  const getEmbedUrl = (url: string) => {
    if (!url) return '';
    let id = '';
    if (url.includes('youtube.com/watch')) {
      const params = new URLSearchParams(url.split('?')[1]);
      id = params.get('v') || '';
    } else if (url.includes('youtu.be/')) {
      id = url.split('youtu.be/')[1]?.split('?')[0] || '';
    } else if (url.includes('youtube.com/embed/')) {
      return url;
    }
    return id ? `https://www.youtube.com/embed/${id}` : url;
  };

  const addVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setIsProcessing(true);
    setVideoError(null);
    const path = isGlobalMode ? 'knowledge_base' : `users/${user.uid}/documents`;
    
    try {
      if (videoSource === 'url') {
        if (!newVideoName || !newVideoUrl) {
          throw new Error("Veuillez remplir tous les champs obligatoires.");
        }
        await addDoc(collection(db, path), {
          uid: user.uid,
          name: newVideoName,
          content: newVideoUrl,
          type: 'video/url',
          size: 0,
          createdAt: serverTimestamp()
        });
      } else {
        if (!selectedVideoFile) {
          throw new Error("Veuillez sélectionner un fichier vidéo.");
        }
        if (!newVideoName) {
          throw new Error("Veuillez donner un titre à la vidéo de cours.");
        }
        
        // Size validation for Base64 document size in firestore (1MB document limit)
        // 750 * 1024 bytes is approx 750KB. Base64 is size * 1.33 = ~1MB.
        if (selectedVideoFile.size > 750 * 1024) {
          throw new Error("Fichier trop lourd ! Les vidéos directes stockées sur le cloud doivent faire moins de 750 Ko pour respecter les limites de stockage. Utilisez un lien vidéo ou compressez votre fichier.");
        }

        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Erreur de lecture du fichier vidéo."));
          reader.readAsDataURL(selectedVideoFile);
        });

        await addDoc(collection(db, path), {
          uid: user.uid,
          name: newVideoName,
          content: dataUrl,
          type: selectedVideoFile.type || 'video/mp4',
          size: selectedVideoFile.size,
          createdAt: serverTimestamp()
        });
      }
      
      handleCloseUrlModal();
    } catch (err: any) {
      console.error("Error adding video:", err);
      setVideoError(err.message || "Une erreur est survenue.");
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user) return;
    if (isGlobalMode && !isAdmin) return;

    setIsProcessing(true);
    const path = isGlobalMode ? 'knowledge_base' : `users/${user.uid}/documents`;
    console.log(`Uploading to ${path}, globalMode: ${isGlobalMode}, isAdmin: ${isAdmin}`);
    
    for (const file of acceptedFiles) {
      let text = '';
      try {
        if (file.type === 'application/pdf') {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            if (content && content.items) {
              fullText += content.items.map((item: any) => item.str || "").join(' ') + '\n';
            }
          }
          text = fullText;
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        } else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        } else {
          text = await file.text();
        }

        await addDoc(collection(db, path), {
          uid: user.uid,
          name: file.name,
          content: text,
          type: file.type,
          size: file.size,
          createdAt: serverTimestamp()
        }).catch(e => handleFirestoreError(e, OperationType.CREATE, path));

      } catch (error) {
        console.error("Error processing file:", error);
      }
    }
    setIsProcessing(false);
  }, [user, isGlobalMode, isAdmin]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    multiple: true,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'image/jpeg': ['.jpeg', '.jpg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'video/mp4': ['.mp4'],
      'video/webm': ['.webm'],
      'video/ogg': ['.ogg'],
      'video/quicktime': ['.mov']
    }
  });

  const toggleAllSelection = () => {
    if (selectedFileIds.length === files.length && files.length > 0) {
      setSelectedFileIds([]);
    } else {
      setSelectedFileIds(files.map(f => f.id));
    }
  };

  const toggleFileSelection = (id: string) => {
    setSelectedFileIds(prev => 
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const removeFile = async (id: string) => {
    if (!user) return;
    if (isGlobalMode && !isAdmin) return;
    
    try {
      const path = isGlobalMode ? 'knowledge_base' : `users/${user.uid}/documents`;
      await deleteDoc(doc(db, path, id));
      setSelectedFileIds(prev => prev.filter(fid => fid !== id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, isGlobalMode ? `knowledge_base/${id}` : `users/${user.uid}/documents/${id}`);
    }
  };

  const filteredFiles = useMemo(() => {
    return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [files, searchQuery]);

  const triggerAnalysisWithFileIds = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    
    setIsAnalyzing(true);
    setActiveTab('analysis');
    setAnalysisResult(null);

    // Reset interaction sub-states
    setFlippedCards({});
    setQuizAnswers({});
    setCurrentQuizIdx(0);
    setIsQuizComplete(false);
    setExpandedSolutions({});
    setCurrentSubTab('resume');

    const selectedFiles = files.filter(f => fileIds.includes(f.id));
    const combinedContent = selectedFiles.map(f => `FILE: ${f.name}\nCONTENT: ${f.content}`).join('\n\n---\n\n');

    try {
      const ai = getActiveGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [{ role: "user", parts: [{ text: `Tu es un professeur de chimie chaleureux, stimulant et extrêmement pédagogue du Collège Catts Pressoir. Analyse ces documents de cours et génère une fiche d'apprentissage complète en français (JSON) s'adressant aux élèves de manière engageante, claire et bienveillante. Elle doit contenir précisément :
1. "resume" : un résumé complet, chaleureusement rédigé par un enseignant, très structuré et détaillé du cours. Utilise un ton de professeur encourageant, donne des astuces mnémotechniques et d'apprentissage, et utilise du formatage Markdown classique ou du formatage de formules en LaTeX s'il y a lieu.
2. "definitions" : tableau de définitions importantes expliquées de manière claire, rigoureuse mais très pédagogique.
3. "flashcards" : 4 à 8 flashcards de révision (recto question formulée comme par un prof en classe, verso réponse explicative encourageante).
4. "quiz" : un quiz interactif à choix multiples de 5 questions (avec pour chaque question : 4 options possibles dans "options", l'index de l'option correcte de 0 à 3 dans "correctAnswerIndex", et une explication "explanation" rédigée avec bienveillance par un prof expliquant pourquoi la solution est correcte et comment éviter de se tromper).
5. "exercises" : 2 à 4 exercices pratiques d'entraînement de chimie s'appliquant sur ces notions (avec énoncé dans "statement" et corrigé "solution" rédigé pas-à-pas comme une correction au tableau par un enseignant patient).

CONSIGNE: Produis EXACTEMENT le format JSON requis. Le contenu textuel général doit refléter ton identité de professeur de chimie captivant s'adressant à ses élèves et non un robot de synthèse de texte.

Voici le contenu des documents de cours :\n\n${combinedContent}` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              resume: { type: Type.STRING },
              definitions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: { type: Type.STRING },
                    definition: { type: Type.STRING }
                  },
                  required: ["term", "definition"]
                }
              },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    answer: { type: Type.STRING }
                  },
                  required: ["question", "answer"]
                }
              },
              quiz: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    correctAnswerIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING }
                  },
                  required: ["question", "options", "correctAnswerIndex", "explanation"]
                }
              },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    statement: { type: Type.STRING },
                    solution: { type: Type.STRING }
                  },
                  required: ["title", "statement", "solution"]
                }
              }
            },
            required: ["resume", "definitions", "flashcards", "quiz", "exercises"]
          },
          systemInstruction: "Tu es un enseignant expert en chimie et pédagogie. Ton rôle est de concevoir une fiche d'apprentissage interactive et complète à partir des notes de cours fournies."
        }
      });
      
      if (!response.text) {
        throw new Error("Aucun texte reçu de l'IA.");
      }
      
      const parsed = JSON.parse(response.text) as CourseAnalysis;
      setAnalysisResult(parsed);
    } catch (error) {
      console.error("Analysis generation failed:", error);
      setAnalysisResult({
        resume: `Une erreur est survenue lors de la génération de la fiche d'apprentissage. Veuillez réessayer.\n\nType d'erreur : ${error instanceof Error ? error.message : 'Format invalide'}`,
        definitions: [
          { term: "Erreur de chargement", definition: "Impossible d'extraire de manière structurée les définitions de ce fichier." }
        ],
        flashcards: [
          { question: "Pourquoi ce message s'affiche ?", answer: "L'analyse automatique du document a rencontré un problème d'interprétation." }
        ],
        quiz: [],
        exercises: []
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (selectedFileIds.length === 0) return;
    await triggerAnalysisWithFileIds(selectedFileIds);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/20">
      {/* Header */}
      <header className="p-6 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
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
            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-900 shadow-sm border border-slate-100">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-display font-black text-slate-900 tracking-tight uppercase">Fiches de cours</h2>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">
                {isGlobalMode ? "Base de connaissance globale" : "Gestionnaire de documents personnels"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin && (
              <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
                <Button 
                  variant={!isGlobalMode ? 'outline' : 'ghost'} 
                  size="sm" 
                  onClick={() => { setIsGlobalMode(false); setSelectedFileIds([]); }}
                  className={cn("text-[10px] uppercase font-bold px-3 h-8 rounded-lg transition-all", !isGlobalMode ? "bg-white text-slate-900 border-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-900")}
                >
                  Perso
                </Button>
                <Button 
                  variant={isGlobalMode ? 'outline' : 'ghost'} 
                  size="sm" 
                  onClick={() => { setIsGlobalMode(true); setSelectedFileIds([]); }}
                  className={cn("text-[10px] uppercase font-bold px-3 h-8 rounded-lg transition-all", isGlobalMode ? "bg-white text-slate-900 border-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-900")}
                >
                  Global Admin
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
              <Button 
                variant={viewMode === 'grid' ? 'outline' : 'ghost'} 
                size="icon" 
                onClick={() => setViewMode('grid')}
                className={cn("h-8 w-8 rounded-lg transition-all", viewMode === 'grid' ? "bg-white text-slate-900 border-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-900")}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button 
                variant={viewMode === 'list' ? 'outline' : 'ghost'} 
                size="icon" 
                onClick={() => setViewMode('list')}
                className={cn("h-8 w-8 rounded-lg transition-all", viewMode === 'list' ? "bg-white text-slate-900 border-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-900")}
              >
                <ListIcon className="w-4 h-4" />
              </Button>
            </div>
            <Button 
              disabled={selectedFileIds.length === 0 || isAnalyzing}
              onClick={handleAnalyze}
              className="bg-slate-900 hover:bg-black text-white rounded-xl px-6 h-10 gap-2 shadow-lg disabled:bg-slate-100 disabled:text-slate-400"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>Analyser ({selectedFileIds.length})</span>
            </Button>
          </div>
        </div>
      </div>
    </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white/50">
          <div className="max-w-7xl mx-auto flex gap-8">
            <button 
              onClick={() => setActiveTab('files')}
              className={cn(
                "py-4 text-xs font-bold uppercase tracking-widest transition-all relative",
                activeTab === 'files' ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
              )}
            >
              Mes Documents
              {activeTab === 'files' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />}
            </button>
            <button 
              onClick={() => setActiveTab('analysis')}
              className={cn(
                "py-4 text-xs font-bold uppercase tracking-widest transition-all relative",
                activeTab === 'analysis' ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
              )}
            >
              Analyse IA
              {activeTab === 'analysis' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />}
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1 p-6 min-h-0">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'files' ? (
              <div className="space-y-8">
                {/* Upload Area */}
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-all cursor-pointer group",
                    isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-500 hover:bg-slate-50 bg-white'
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 border border-slate-100">
                    {isProcessing ? <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" /> : <FileUp className="w-8 h-8 text-slate-400" />}
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-lg font-display font-black text-slate-900 uppercase tracking-tight">
                      {isGlobalMode ? "Téléverser dans la base globale" : "Glissez vos documents ici"}
                    </p>
                    <p className="text-sm text-slate-500 max-w-xs mx-auto font-medium">
                      {isGlobalMode 
                        ? "Ces fichiers seront utilisés par l'IA pour TOUS les utilisateurs (PDF, DOCX, TXT, Images, Vidéos)."
                        : "Supporte PDF, DOCX, TXT, les images et les fiches vidéo."
                      }
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" onClick={() => {
                      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                      if (fileInput) fileInput.click();
                    }} className="rounded-xl border-slate-200 text-slate-900 font-bold text-xs uppercase tracking-widest px-8 bg-white hover:bg-slate-50 shadow-sm">
                      Parcourir les fichiers
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setVideoSource('file');
                        setIsUrlModalOpen(true);
                      }} 
                      className="rounded-xl border-purple-200 text-purple-600 font-bold text-xs uppercase tracking-widest px-6 bg-purple-50/30 hover:bg-purple-50 shadow-sm gap-1.5"
                    >
                      <Video className="w-4 h-4" />
                      Ajouter une vidéo
                    </Button>
                  </div>
                </div>

                {/* Search & Actions */}
                {files.length > 0 && (
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        placeholder="Rechercher un document..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 rounded-xl border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-indigo-500/10 h-10"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedFileIds(files.map(f => f.id))}
                        className="text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      >
                        Tout sélectionner
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedFileIds([])}
                        className="text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      >
                        Désélectionner
                      </Button>
                    </div>
                  </div>
                )}

                {/* File List */}
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    <AnimatePresence>
                      {filteredFiles.map(file => (
                        <motion.div
                          key={file.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          layout
                        >
                          <Card 
                            onClick={() => toggleFileSelection(file.id)}
                            className={cn(
                              "p-4 rounded-2xl cursor-pointer transition-all duration-300 border group relative overflow-hidden",
                              selectedFileIds.includes(file.id) 
                                ? 'bg-indigo-50 border-indigo-200 shadow-md ring-1 ring-indigo-200' 
                                : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                            )}
                          >
                            <div className="flex items-start justify-between mb-4">
                              {file.type?.startsWith('image/') && file.content?.startsWith('data:image/') ? (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewMedia({ name: file.name, content: file.content, type: file.type });
                                  }}
                                  className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50 relative group-hover:scale-105 transition-transform duration-300 cursor-zoom-in shrink-0"
                                  title="Cliquez pour agrandir"
                                >
                                  <img 
                                    src={file.content} 
                                    alt={file.name} 
                                    className="w-full h-full object-cover" 
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : (file.type?.startsWith('video/') || file.type === 'video/url') ? (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewMedia({ name: file.name, content: file.content, type: file.type });
                                  }}
                                  className="w-12 h-12 rounded-xl flex items-center justify-center bg-purple-50 text-purple-600 border border-purple-200 shadow-sm relative group-hover:scale-105 transition-transform duration-300 cursor-pointer shrink-0"
                                  title="Cliquez pour lire la vidéo"
                                >
                                  <Video className="w-5 h-5 absolute" />
                                  <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Play className="w-4 h-4 text-white fill-white" />
                                  </div>
                                </div>
                              ) : (
                                <div className={cn(
                                  "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0",
                                  selectedFileIds.includes(file.id) ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600'
                                )}>
                                  {file.type === 'application/pdf' ? (
                                    <BookOpen className="w-5 h-5" />
                                  ) : (
                                    <FileText className="w-5 h-5" />
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                {selectedFileIds.includes(file.id) && (
                                  <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                                )}
                                <button 
                                  onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                                  className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <h3 className="text-sm font-bold text-slate-900 truncate pr-4">{file.name}</h3>
                              <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium uppercase tracking-wider pt-1.5 border-t border-slate-100 mt-2">
                                <div className="flex items-center gap-1.5 text-slate-400">
                                  <span>{formatSize(file.size)}</span>
                                  <span>•</span>
                                  <span>{file.uploadDate.toLocaleDateString()}</span>
                                </div>
                                <button
                                  id={`gen-btn-${file.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFileIds([file.id]);
                                    triggerAnalysisWithFileIds([file.id]);
                                  }}
                                  className="flex items-center gap-1 text-[10px] uppercase font-bold text-indigo-600 hover:text-indigo-900 bg-indigo-50/50 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-all duration-200"
                                >
                                  <Sparkles className="w-3 h-3 animate-pulse text-indigo-500" />
                                  <span>Générer</span>
                                </button>
                              </div>
                            </div>
                          </Card>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/50">
                            <th className="px-6 py-4 w-10">
                              <input 
                                type="checkbox" 
                                checked={files.length > 0 && selectedFileIds.length === files.length}
                                onChange={toggleAllSelection}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            </th>
                            <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Document</th>
                            <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Taille</th>
                            <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</th>
                            <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredFiles.map(file => (
                            <tr 
                              key={file.id}
                              onClick={() => toggleFileSelection(file.id)}
                              className={cn(
                                "group cursor-pointer transition-colors",
                                selectedFileIds.includes(file.id) ? 'bg-indigo-50/30' : 'hover:bg-slate-50'
                              )}
                            >
                              <td className="px-6 py-4">
                                <input 
                                  type="checkbox" 
                                  checked={selectedFileIds.includes(file.id)}
                                  readOnly
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  {file.type?.startsWith('image/') && file.content?.startsWith('data:image/') ? (
                                    <div 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewMedia({ name: file.name, content: file.content, type: file.type });
                                      }}
                                      className="w-8 h-8 rounded overflow-hidden border border-slate-200 bg-slate-50 flex-shrink-0 cursor-zoom-in"
                                      title="Cliquez pour agrandir"
                                    >
                                      <img 
                                        src={file.content} 
                                        alt={file.name} 
                                        className="w-full h-full object-cover" 
                                        referrerPolicy="no-referrer"
                                      />
                                    </div>
                                  ) : (file.type?.startsWith('video/') || file.type === 'video/url') ? (
                                    <div 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewMedia({ name: file.name, content: file.content, type: file.type });
                                      }}
                                      className="w-8 h-8 rounded border border-purple-200 bg-purple-50 flex items-center justify-center flex-shrink-0 cursor-pointer text-purple-600 hover:bg-purple-100"
                                      title="Cliquez pour lire la vidéo"
                                    >
                                      <Play className="w-3.5 h-3.5 fill-purple-600" />
                                    </div>
                                  ) : (
                                    <div className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                                      selectedFileIds.includes(file.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                                    )}>
                                      {file.type === 'application/pdf' ? (
                                        <BookOpen className="w-4 h-4" />
                                      ) : (
                                        <FileText className="w-4 h-4" />
                                      )}
                                    </div>
                                  )}
                                  <span className="text-sm font-bold text-slate-900 truncate">{file.name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-xs text-slate-500">{formatSize(file.size)}</td>
                              <td className="px-6 py-4 text-xs text-slate-500">{file.uploadDate.toLocaleDateString()}</td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    id={`gen-row-${file.id}`}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedFileIds([file.id]);
                                      triggerAnalysisWithFileIds([file.id]);
                                    }}
                                    className="h-8 text-[10px] uppercase font-bold text-indigo-600 hover:text-white border-indigo-200 hover:bg-indigo-600 hover:border-indigo-600 gap-1 rounded-xl transition-all"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    <span>Générer d'un clic</span>
                                  </Button>
                                  {selectedFileIds.includes(file.id) && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                                  <button 
                                    onClick={() => removeFile(file.id)}
                                    className="p-2 text-slate-400 hover:text-rose-500 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {files.length === 0 && (
                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center text-slate-400">
                      <FileSearch className="w-10 h-10" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-900 font-display font-black uppercase tracking-tight">Aucun document pour le moment</p>
                      <p className="text-sm text-slate-500 font-medium">Téléversez vos fiches de cours pour commencer l'analyse.</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                {isAnalyzing ? (
                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-6">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full border-4 border-slate-100 border-t-indigo-600 animate-spin" />
                      <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-indigo-600 animate-pulse" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-display font-black text-slate-900 uppercase tracking-tight">Analyse en cours...</h3>
                      <p className="text-sm text-slate-500 font-medium">L'IA parcourt vos documents pour en extraire l'essentiel.</p>
                    </div>
                  </div>
                ) : analysisResult ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden"
                  >
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Sparkles className="w-5 h-5 text-indigo-600" />
                        <div>
                          <h3 className="font-bold text-slate-900">Fiche d'Apprentissage Interactive</h3>
                          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest mt-0.5">Automatique • Génération en un clic</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setAnalysisResult(null)} className="text-slate-400 hover:text-slate-900 h-8 text-xs uppercase font-bold tracking-wider">
                        Effacer la Fiche
                      </Button>
                    </div>

                    {/* Sub-tab navigation */}
                    <div className="border-b border-slate-100 bg-slate-50/30 p-2 flex flex-wrap gap-2 justify-center">
                      {(['resume', 'definitions', 'flashcards', 'quiz', 'exercises'] as const).map((subTab) => {
                        const labels = {
                          resume: "Résumé 📝",
                          definitions: "Définitions 📖",
                          flashcards: "Flashcards 🎴",
                          quiz: "Quiz ⚡",
                          exercises: "Exercices 🧪"
                        };
                        const active = currentSubTab === subTab;
                        return (
                          <Button
                            id={`subtab-btn-${subTab}`}
                            key={subTab}
                            variant={active ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setCurrentSubTab(subTab)}
                            className={cn(
                              "text-xs font-bold uppercase tracking-wider rounded-xl py-2 px-4 transition-all h-9",
                              active 
                                ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md" 
                                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                            )}
                          >
                            {labels[subTab]}
                          </Button>
                        );
                      })}
                    </div>

                    <div className="p-8">
                      {/* Sub-tab content panes */}
                      {currentSubTab === 'resume' && (
                        <div id="panel-resume" className="space-y-6">
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                            <BookOpen className="w-5 h-5 text-indigo-600" />
                            <h4 className="text-base font-bold text-slate-900 uppercase tracking-tight">Résumé thématique du cours</h4>
                          </div>
                          <div className="markdown-body prose max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-slate-900 prose-pre:text-white leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                              {analysisResult.resume}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}

                      {currentSubTab === 'definitions' && (
                        <div id="panel-definitions" className="space-y-6">
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                            <Brain className="w-5 h-5 text-indigo-600" />
                            <h4 className="text-base font-bold text-slate-900 uppercase tracking-tight">Définitions importantes à connaître</h4>
                          </div>
                          {analysisResult.definitions && analysisResult.definitions.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {analysisResult.definitions.map((def, idx) => (
                                <div 
                                  id={`def-card-${idx}`}
                                  key={idx} 
                                  className="p-5 bg-slate-50/50 hover:bg-slate-50 rounded-2xl border border-slate-200/60 shadow-sm flex flex-col gap-2 hover:shadow-md transition-all duration-300 group"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-4 bg-indigo-500 rounded-full group-hover:bg-indigo-600 transition-colors" />
                                    <h5 className="font-display font-black text-slate-950 text-sm tracking-tight">{def.term}</h5>
                                  </div>
                                  <p className="text-xs text-slate-600 font-medium leading-relaxed pl-4">
                                    {def.definition}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500 text-center py-6">Aucune définition n'a été identifiée pour ce document.</p>
                          )}
                        </div>
                      )}

                      {currentSubTab === 'flashcards' && (
                        <div id="panel-flashcards" className="space-y-6">
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                            <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                            <h4 className="text-base font-bold text-slate-900 uppercase tracking-tight">Flashcards d'auto-évaluation</h4>
                          </div>
                          <p className="text-xs text-slate-500 mb-6 font-medium">Cliquez sur une carte pour la retourner et voir l'explication au verso.</p>
                          {analysisResult.flashcards && analysisResult.flashcards.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                              {analysisResult.flashcards.map((card, idx) => {
                                const isFlipped = !!flippedCards[idx];
                                return (
                                  <div 
                                    id={`flashcard-${idx}`}
                                    key={idx} 
                                    onClick={() => setFlippedCards(p => ({ ...p, [idx]: !p[idx] }))}
                                    className="w-full h-44 cursor-pointer relative"
                                    style={{ perspective: "1000px" }}
                                  >
                                    <div 
                                      className="w-full h-full relative text-center shadow-sm hover:shadow-md transition-transform duration-500"
                                      style={{ 
                                        transformStyle: "preserve-3d",
                                        transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                                        transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)"
                                      }}
                                    >
                                      {/* Front Side */}
                                      <div 
                                        className="absolute inset-0 bg-gradient-to-br from-indigo-50/40 to-white border border-slate-200/85 rounded-2xl p-6 flex flex-col justify-between"
                                        style={{ backfaceVisibility: "hidden" }}
                                      >
                                        <div className="text-[10px] uppercase font-bold text-indigo-600 tracking-wider">Question de révision</div>
                                        <p className="text-xs font-bold text-slate-800 text-center flex-1 flex items-center justify-center my-2 leading-relaxed">
                                          {card.question}
                                        </p>
                                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Cliquer pour révéler</span>
                                      </div>
                                      {/* Back Side */}
                                      <div 
                                        className="absolute inset-0 bg-slate-950 text-white border border-slate-900 rounded-2xl p-6 flex flex-col justify-between"
                                        style={{ 
                                          backfaceVisibility: "hidden", 
                                          transform: "rotateY(180deg)" 
                                        }}
                                      >
                                        <div className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Réponse / Explication</div>
                                        <p className="text-xs font-semibold leading-relaxed text-center flex-1 flex items-center justify-center my-2 overflow-y-auto px-1 text-slate-200">
                                          {card.answer}
                                        </p>
                                        <span className="text-[9px] text-cyan-300 font-bold uppercase tracking-widest">Cliquer pour retourner</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500 text-center py-6">Aucune flashcard disponible.</p>
                          )}
                        </div>
                      )}

                      {currentSubTab === 'quiz' && (
                        <div id="panel-quiz" className="space-y-6">
                          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <Award className="w-5 h-5 text-indigo-600" />
                              <h4 className="text-base font-bold text-slate-900 uppercase tracking-tight">Test de Connaissances Express</h4>
                            </div>
                            {analysisResult.quiz && analysisResult.quiz.length > 0 && !isQuizComplete && (
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                                Question {currentQuizIdx + 1} / {analysisResult.quiz.length}
                              </span>
                            )}
                          </div>

                          {analysisResult.quiz && analysisResult.quiz.length > 0 ? (
                            isQuizComplete ? (
                              <div id="quiz-completion-score" className="text-center py-8 space-y-6">
                                <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600">
                                  <Award className="w-10 h-10" />
                                </div>
                                <div className="space-y-2">
                                  <h5 className="text-xl font-display font-black text-slate-900 uppercase tracking-tight">Quiz Terminé !</h5>
                                  <p className="text-sm text-slate-600 font-semibold">
                                    Votre score : <span className="text-indigo-600 font-extrabold text-base">
                                      {analysisResult.quiz.reduce((score, q, idx) => score + (quizAnswers[idx] === q.correctAnswerIndex ? 1 : 0), 0)}
                                    </span> sur <span className="font-extrabold text-slate-900">{analysisResult.quiz.length}</span>
                                  </p>
                                </div>
                                <div className="max-w-md mx-auto bg-slate-50 border border-slate-200/60 rounded-2xl p-4 text-left divide-y divide-slate-200/50">
                                  {analysisResult.quiz.map((q, idx) => {
                                    const userAns = quizAnswers[idx];
                                    const isCorrect = userAns === q.correctAnswerIndex;
                                    return (
                                      <div key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                                        <div className="flex items-start gap-2">
                                          {isCorrect ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                                          ) : (
                                            <X className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                                          )}
                                          <div>
                                            <p className="text-xs font-bold text-slate-900">{q.question}</p>
                                            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                                              Réponse correcte : <span className="font-semibold text-emerald-600">{q.options[q.correctAnswerIndex]}</span>
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <Button 
                                  onClick={() => {
                                    setQuizAnswers({});
                                    setCurrentQuizIdx(0);
                                    setIsQuizComplete(false);
                                  }}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-2 font-bold text-xs uppercase tracking-widest px-6 h-10"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  <span>Recommencer le quiz</span>
                                </Button>
                              </div>
                            ) : (
                              (() => {
                                const currentQ = analysisResult.quiz[currentQuizIdx];
                                const selectedOptionIdx = quizAnswers[currentQuizIdx];
                                const hasAnswered = selectedOptionIdx !== undefined;

                                return (
                                  <div id={`quiz-question-box-${currentQuizIdx}`} className="space-y-6">
                                    <div className="bg-indigo-50/30 border border-indigo-100 rounded-2xl p-5">
                                      <h5 className="font-display font-bold text-slate-900 text-sm leading-relaxed">
                                        {currentQ.question}
                                      </h5>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {currentQ.options.map((option, idx) => {
                                        const isSelected = selectedOptionIdx === idx;
                                        const isCorrectOpt = idx === currentQ.correctAnswerIndex;
                                        
                                        // Colors mapping on answer submit
                                        let btnClass = "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300";
                                        if (hasAnswered) {
                                          if (isCorrectOpt) {
                                            btnClass = "bg-emerald-50 border-emerald-300 text-emerald-950 font-bold shadow-sm";
                                          } else if (isSelected) {
                                            btnClass = "bg-rose-50 border-rose-200 text-rose-950 font-medium";
                                          } else {
                                            btnClass = "bg-white border-slate-100 text-slate-400 opacity-70";
                                          }
                                        }

                                        return (
                                          <button
                                            id={`quiz-option-${idx}`}
                                            key={idx}
                                            disabled={hasAnswered}
                                            onClick={() => {
                                              setQuizAnswers(prev => ({ ...prev, [currentQuizIdx]: idx }));
                                            }}
                                            className={cn(
                                              "p-4 rounded-xl text-left border text-xs font-medium transition-all duration-300 flex items-center justify-between w-full shadow-sm",
                                              btnClass
                                            )}
                                          >
                                            <span className="leading-relaxed">{option}</span>
                                            {hasAnswered && isCorrectOpt && <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    <AnimatePresence>
                                      {hasAnswered && (
                                        <motion.div 
                                          initial={{ opacity: 0, y: 10 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2"
                                        >
                                          <h6 className="text-[10px] uppercase font-bold text-indigo-600 tracking-wider">Explication Scientifique</h6>
                                          <p className="text-xs text-slate-700 leading-relaxed font-semibold">
                                            {currentQ.explanation}
                                          </p>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>

                                    <div className="flex justify-end pt-2">
                                      <Button
                                        disabled={!hasAnswered}
                                        onClick={() => {
                                          if (currentQuizIdx < analysisResult.quiz.length - 1) {
                                            setCurrentQuizIdx(prev => prev + 1);
                                          } else {
                                            setIsQuizComplete(true);
                                          }
                                        }}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-2 font-bold text-xs uppercase tracking-widest px-6 h-10 disabled:bg-slate-100 disabled:text-slate-400"
                                      >
                                        <span>
                                          {currentQuizIdx < analysisResult.quiz.length - 1 ? "Question Suivante" : "Terminer et voir le score"}
                                        </span>
                                        <ChevronRight className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })()
                            )
                          ) : (
                            <p className="text-sm text-slate-500 text-center py-6">Aucun quiz disponible pour ce cours.</p>
                          )}
                        </div>
                      )}

                      {currentSubTab === 'exercises' && (
                        <div id="panel-exercises" className="space-y-6">
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                            <HelpCircle className="w-5 h-5 text-indigo-600" />
                            <h4 className="text-base font-bold text-slate-900 uppercase tracking-tight">Exercices d'entraînement pratique</h4>
                          </div>
                          {analysisResult.exercises && analysisResult.exercises.length > 0 ? (
                            <div className="space-y-6">
                              {analysisResult.exercises.map((ex, idx) => {
                                const showSolution = !!expandedSolutions[idx];
                                return (
                                  <div 
                                    id={`ex-card-${idx}`}
                                    key={idx} 
                                    className="p-6 bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl border border-slate-200/70 shadow-sm space-y-4 transition-all duration-300"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-[10px] flex items-center justify-center">
                                        {idx + 1}
                                      </span>
                                      <h5 className="font-display font-black text-slate-900 text-sm uppercase tracking-tight">{ex.title}</h5>
                                    </div>
                                    <div className="prose prose-sm max-w-none text-xs text-slate-700 leading-relaxed font-semibold pl-1">
                                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                        {ex.statement}
                                      </ReactMarkdown>
                                    </div>

                                    <div className="pt-2 border-t border-slate-200/50 flex flex-col gap-3">
                                      <button
                                        id={`toggle-sol-btn-${idx}`}
                                        onClick={() => setExpandedSolutions(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                        className="text-[10px] uppercase font-bold text-indigo-600 hover:text-indigo-900 flex items-center gap-1 w-fit transition-colors"
                                      >
                                        <span>{showSolution ? "Masquer la solution rédigée ▲" : "Afficher la solution rédigée ▼"}</span>
                                      </button>

                                      <AnimatePresence>
                                        {showSolution && (
                                          <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="overflow-hidden bg-emerald-50/40 border border-emerald-100 rounded-xl p-5 mt-2 shadow-inner"
                                          >
                                            <div className="flex items-center gap-2 mb-2">
                                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                              <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">Correction pas-à-pas</span>
                                            </div>
                                            <div className="prose prose-sm max-w-none text-xs text-emerald-950 font-medium leading-relaxed leading-slate">
                                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                {ex.solution}
                                              </ReactMarkdown>
                                            </div>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500 text-center py-6">Aucun devoir ou exercice disponible.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-6">
                    <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center text-indigo-600">
                      <Sparkles className="w-10 h-10" />
                    </div>
                    <div className="space-y-2 max-w-xs">
                      <h3 className="text-xl font-display font-black text-slate-900 uppercase tracking-tight">Prêt pour l'analyse ?</h3>
                      <p className="text-sm text-slate-500 font-medium">
                        Sélectionnez un ou plusieurs documents dans l'onglet "Mes Documents" puis cliquez sur "Analyser".
                      </p>
                    </div>
                    <Button onClick={() => setActiveTab('files')} variant="outline" className="rounded-xl border-slate-200 text-slate-900 font-bold text-xs uppercase tracking-widest hover:bg-slate-50">
                      Sélectionner des fichiers
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Video URL Form Modal */}
      <AnimatePresence>
        {isUrlModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
            onClick={handleCloseUrlModal}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl border border-slate-200 p-6 w-full max-w-md shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={handleCloseUrlModal}
                className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 mb-4">
                <Video className="w-5 h-5 text-indigo-600 animate-pulse" />
                <h3 className="font-display font-black text-slate-900 text-base uppercase tracking-tight">Ajouter une vidéo</h3>
              </div>

              {/* Source Switcher */}
              <div className="flex bg-slate-100 p-1 rounded-xl mb-5 border border-slate-200/50">
                <button
                  type="button"
                  onClick={() => { setVideoSource('file'); setVideoError(null); }}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-bold uppercase rounded-lg transition-all",
                    videoSource === 'file' 
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200/50" 
                      : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  Fichier Local
                </button>
                <button
                  type="button"
                  onClick={() => { setVideoSource('url'); setVideoError(null); }}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-bold uppercase rounded-lg transition-all",
                    videoSource === 'url' 
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200/50" 
                      : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  Lien YouTube / Web
                </button>
              </div>

              {videoError && (
                <div className="p-3 mb-4 text-xs font-semibold rounded-xl bg-rose-50 text-rose-600 border border-rose-100 leading-relaxed">
                  ⚠️ {videoError}
                </div>
              )}

              <form onSubmit={addVideo} className="space-y-4">
                {videoSource === 'file' ? (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Sélectionner la vidéo</label>
                      <div 
                        onClick={() => {
                          const el = document.getElementById('modal-video-input') as HTMLInputElement;
                          if (el) el.click();
                        }}
                        className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer hover:bg-slate-50/50 transition-colors group relative"
                      >
                        <input 
                          type="file" 
                          id="modal-video-input" 
                          accept="video/*" 
                          className="hidden" 
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setSelectedVideoFile(file);
                            if (file) {
                              setVideoError(null);
                              // Auto-fill video title if empty
                              setNewVideoName(prev => {
                                if (!prev || prev.trim() === '') {
                                  return file.name.replace(/\.[^/.]+$/, ""); // Name without extension
                                }
                                return prev;
                              });
                            }
                          }}
                        />
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform duration-300 border border-slate-100">
                          <FileUp className="w-5 h-5 text-slate-400" />
                        </div>
                        {selectedVideoFile ? (
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-slate-900 truncate max-w-[250px] mx-auto">{selectedVideoFile.name}</p>
                            <p className="text-[10px] font-medium text-slate-500">{formatSize(selectedVideoFile.size)}</p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-slate-700">Cliquez pour choisir un fichier</p>
                            <p className="text-[9px] font-medium text-slate-400">MP4, WEBM, MOV (max 750 Ko)</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Titre de la vidéo</label>
                      <Input 
                        placeholder="Ex: Expérience de Titration d'Acide"
                        value={newVideoName}
                        onChange={(e) => setNewVideoName(e.target.value)}
                        required
                        className="rounded-xl border-slate-200"
                      />
                    </div>
                    
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                      💡 Les bases de données cloud limitent la taille d'un document à 1 Mo. Pour de longues démonstrations de cours, privilégiez un lien externe. Pour des minis séquences manipulatoires de votre laptop/tablette, l'import de courts fichiers légers est optimal !
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Titre de la vidéo</label>
                      <Input 
                        placeholder="Ex: Expérience de titration d'acide ou Synthèse de l'eau"
                        value={newVideoName}
                        onChange={(e) => setNewVideoName(e.target.value)}
                        required
                        className="rounded-xl border-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">URL de la vidéo (YouTube ou Direct)</label>
                      <Input 
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={newVideoUrl}
                        onChange={(e) => setNewVideoUrl(e.target.value)}
                        required
                        className="rounded-xl border-slate-200"
                      />
                      <p className="text-[9px] text-slate-400 leading-relaxed pt-0.5 font-medium">
                        Prend en charge les liens vidéo standard YouTube, les partages et les URL directes de vidéos MP4/WEBM.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={handleCloseUrlModal}
                    className="rounded-xl text-xs uppercase font-bold tracking-wider text-slate-500 hover:text-slate-900 h-10"
                  >
                    Annuler
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={isProcessing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs uppercase font-bold tracking-wider px-6 h-10"
                  >
                    {isProcessing ? "Enregistrement..." : "Ajouter la vidéo"}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media Lightbox Zoom Modal */}
      <AnimatePresence>
        {previewMedia && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setPreviewMedia(null)}
          >
            <button 
              onClick={() => setPreviewMedia(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div 
              className="relative max-w-5xl max-h-[85vh] flex flex-col items-center justify-center gap-4 bg-slate-900/50 p-4 rounded-3xl border border-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              {previewMedia.type === 'video/url' || previewMedia.type?.startsWith('video/') ? (
                previewMedia.content.includes('youtube.com') || previewMedia.content.includes('youtu.be') ? (
                  <iframe 
                    src={getEmbedUrl(previewMedia.content)} 
                    title={previewMedia.name}
                    className="w-full max-w-4xl aspect-video rounded-2xl shadow-2xl border border-slate-800"
                    allowFullScreen
                  />
                ) : (
                  <video 
                    src={previewMedia.content} 
                    controls 
                    autoPlay
                    className="w-full max-w-4xl max-h-[75vh] rounded-2xl shadow-2xl border border-slate-800 bg-black"
                  />
                )
              ) : (
                <img 
                  src={previewMedia.content} 
                  alt="Zoom" 
                  className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-slate-800" 
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
