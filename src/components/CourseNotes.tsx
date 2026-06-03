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
  PanelLeftOpen
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

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'analysis'>('files');

  const isAdmin = user?.email === "ghostytb77777@gmail.com";
  const files = isGlobalMode ? globalFiles : personalFiles;

  // Load personal files
  useEffect(() => {
    if (!user) {
      setPersonalFiles([]);
      return;
    }

    const q = query(
      collection(db, `users/${user.uid}/documents`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = (snapshot.docs || []).map(doc => ({
        id: doc.id,
        ...doc.data(),
        uploadDate: (doc.data().createdAt as any)?.toDate() || new Date()
      })) as CourseFile[];
      setPersonalFiles(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/documents`, false);
    });

    return () => unsubscribe();
  }, [user]);

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
      'text/plain': ['.txt']
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

  const handleAnalyze = async () => {
    if (selectedFileIds.length === 0) return;
    
    setIsAnalyzing(true);
    setActiveTab('analysis');
    setAnalysisResult(null);

    const selectedFiles = files.filter(f => selectedFileIds.includes(f.id));
    const combinedContent = selectedFiles.map(f => `FILE: ${f.name}\nCONTENT: ${f.content}`).join('\n\n---\n\n');

    try {
      const ai = getActiveGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: `Analyse ces documents de cours de chimie et fournis un résumé structuré, les concepts clés, et des questions d'entraînement potentielles. 
        
        RÈGLE: Utilise EXCLUSIVEMENT les informations contenues dans ces documents. Ne rajoute pas de connaissances extérieures.
        
        Voici les documents :\n\n${combinedContent}` }] }],
        config: {
          systemInstruction: "Tu es un expert en analyse de documents pédagogiques. Ton rôle est de synthétiser fidèlement le contenu fourni sans jamais inventer d'informations. Ne commence pas tes phrases par 'Selon les documents' ou similaire, présente l'analyse directement."
        }
      });
      
      if (!response.text) {
        throw new Error("No text returned from AI");
      }
      
      setAnalysisResult(response.text);
    } catch (error) {
      console.error("Analysis failed:", error);
      setAnalysisResult(`Une erreur est survenue lors de l'analyse: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsAnalyzing(false);
    }
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
                        ? "Ces fichiers seront utilisés par l'IA pour TOUS les utilisateurs du site."
                        : "Supporte PDF, DOCX et TXT. L'IA peut analyser plusieurs fichiers simultanément."
                      }
                    </p>
                  </div>
                  <Button variant="outline" className="rounded-xl border-slate-200 text-slate-900 font-bold text-xs uppercase tracking-widest px-8 bg-white hover:bg-slate-50 shadow-sm">
                    Parcourir les fichiers
                  </Button>
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
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                selectedFileIds.includes(file.id) ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600'
                              )}>
                                <FileText className="w-5 h-5" />
                              </div>
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
                              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                                <span>{formatSize(file.size)}</span>
                                <span>•</span>
                                <span>{file.uploadDate.toLocaleDateString()}</span>
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
                                  <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    selectedFileIds.includes(file.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                                  )}>
                                    <FileText className="w-4 h-4" />
                                  </div>
                                  <span className="text-sm font-bold text-slate-900">{file.name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-xs text-slate-500">{formatSize(file.size)}</td>
                              <td className="px-6 py-4 text-xs text-slate-500">{file.uploadDate.toLocaleDateString()}</td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {selectedFileIds.includes(file.id) && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
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
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Sparkles className="w-5 h-5 text-indigo-600" />
                        <h3 className="font-bold text-slate-900">Résultat de l'analyse</h3>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setAnalysisResult(null)} className="text-slate-400 hover:text-slate-900">
                        Effacer
                      </Button>
                    </div>
                    <div className="p-8">
                      <div className="markdown-body prose max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-slate-900 prose-pre:text-white">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{analysisResult}</ReactMarkdown>
                      </div>
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
    </div>
  );
}
