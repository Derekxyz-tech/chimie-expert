import React, { Component, ReactNode, Suspense, lazy } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Resilient WebGL error interceptor
class WebGLErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("WebGL 3D Context Failure detected:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Lazy load the high-fidelity 3D molecule engine to optimize bundling speeds
const LazyMoleculeViewer = lazy(() => import('../MoleculeViewer'));

// Flat elegant 2D canvas fallback in case WebGL is unavailable or crashes
function FlatMoleculeFallback({ molecule }: { molecule?: any }) {
  const name = molecule?.name || "Molécule";
  const formula = molecule?.formula || molecule?.equation || "";
  
  return (
    <div className="w-full h-[400px] rounded-3xl bg-slate-950/85 border border-white/10 flex flex-col items-center justify-center p-6 text-center shadow-xl relative overflow-hidden group">
      {/* Dynamic graphic backgrounds */}
      <div className="absolute inset-0 bg-radial-gradient from-indigo-500/10 via-transparent to-transparent pointer-events-none opacity-50" />
      
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full mb-3.5 relative z-10">
        <AlertTriangle className="w-6 h-6 animate-pulse" />
      </div>
      
      <h3 className="text-sm font-semibold text-white/90 font-display relative z-10">
        {name}
      </h3>
      <p className="font-mono text-[11px] text-slate-400 mt-1 relative z-10">
        {formula}
      </p>
      
      <div className="mt-5 max-w-sm text-[11px] leading-relaxed text-slate-400/80 p-3 bg-white/[0.02] rounded-xl border border-white/5 relative z-10">
        Le visualiseur 3D accéléré est inaccessible sur cet appareil ou ce navigateur. 
        Affichage de la structure chimique en mode alternatif.
      </div>
    </div>
  );
}

// Shimmering skeleton loader screen
function ViewerSkeleton() {
  return (
    <div className="w-full h-[400px] rounded-3xl bg-slate-950/40 border border-white/5 flex flex-col items-center justify-center p-6 relative">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400 animate-pulse">
          Chargement du simulateur 3D...
        </span>
      </div>
    </div>
  );
}

export default function SimpleMoleculeViewer({ molecule }: { molecule?: any }) {
  return (
    <WebGLErrorBoundary fallback={<FlatMoleculeFallback molecule={molecule} />}>
      <Suspense fallback={<ViewerSkeleton />}>
        <LazyMoleculeViewer molecule={molecule} />
      </Suspense>
    </WebGLErrorBoundary>
  );
}
export { SimpleMoleculeViewer };
