import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Play, Pause, RotateCcw, AlertCircle, Info, Beaker } from 'lucide-react';
import { MoleculeModel } from './molecule/MoleculeModel';

interface Atom {
  id?: string;
  element: string;
  position: [number, number, number];
  color: string;
  radius: number;
}

interface Bond {
  start: [number, number, number];
  end: [number, number, number];
}

interface MoleculeData {
  name: string;
  formula?: string;
  atoms: Atom[];
  bonds: Bond[];
}

// CPK Color Standards
const ATOM_COLORS: Record<string, string> = {
  H: '#f8fafc',  // White/slate
  C: '#334155',  // Dark grey/charcoal
  O: '#ef4444',  // Vibrant Red
  N: '#3b82f6',  // Blue
  Cl: '#22c55e', // Green
  S: '#eab308',  // Yellow/Amber
  P: '#f97316',  // Orange
  F: '#a855f7',  // Purple
};

const ATOM_RADII: Record<string, number> = {
  H: 0.28,
  C: 0.44,
  O: 0.38,
  N: 0.38,
  Cl: 0.46,
  S: 0.50,
  P: 0.48,
  F: 0.34,
};

// Common Molecule Presets
const MOLECULE_PRESETS: Record<string, MoleculeData> = {
  H2: {
    name: 'Dihydrogène',
    formula: 'H2',
    atoms: [
      { element: 'H', position: [-0.6, 0, 0], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
      { element: 'H', position: [0.6, 0, 0], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
    ],
    bonds: [
      { start: [-0.6, 0, 0], end: [0.6, 0, 0] },
    ]
  },
  O2: {
    name: 'Dioxygène',
    formula: 'O2',
    atoms: [
      { element: 'O', position: [-0.65, 0, 0], color: ATOM_COLORS.O, radius: ATOM_RADII.O },
      { element: 'O', position: [0.65, 0, 0], color: ATOM_COLORS.O, radius: ATOM_RADII.O },
    ],
    bonds: [
      { start: [-0.65, 0.05, 0], end: [0.65, 0.05, 0] },
      { start: [-0.65, -0.05, 0], end: [0.65, -0.05, 0] }, // Double bond representation
    ]
  },
  CO2: {
    name: 'Dioxyde de Carbone',
    formula: 'CO2',
    atoms: [
      { element: 'C', position: [0, 0, 0], color: ATOM_COLORS.C, radius: ATOM_RADII.C },
      { element: 'O', position: [-1.2, 0, 0], color: ATOM_COLORS.O, radius: ATOM_RADII.O },
      { element: 'O', position: [1.2, 0, 0], color: ATOM_COLORS.O, radius: ATOM_RADII.O },
    ],
    bonds: [
      { start: [0, 0.06, 0], end: [-1.2, 0.06, 0] },
      { start: [0, -0.06, 0], end: [-1.2, -0.06, 0] },
      { start: [0, 0.06, 0], end: [1.2, 0.06, 0] },
      { start: [0, -0.06, 0], end: [1.2, -0.06, 0] },
    ]
  },
  H2O: {
    name: 'Eau',
    formula: 'H2O',
    atoms: [
      { element: 'O', position: [0, 0.15, 0], color: ATOM_COLORS.O, radius: ATOM_RADII.O },
      { element: 'H', position: [-0.75, -0.45, 0], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
      { element: 'H', position: [0.75, -0.45, 0], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
    ],
    bonds: [
      { start: [0, 0.15, 0], end: [-0.75, -0.45, 0] },
      { start: [0, 0.15, 0], end: [0.75, -0.45, 0] },
    ]
  },
  HCl: {
    name: 'Chlorure d\'Hydrogène',
    formula: 'HCl',
    atoms: [
      { element: 'Cl', position: [0.35, 0, 0], color: ATOM_COLORS.Cl, radius: ATOM_RADII.Cl },
      { element: 'H', position: [-0.75, 0, 0], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
    ],
    bonds: [
      { start: [0.35, 0, 0], end: [-0.75, 0, 0] },
    ]
  },
  NH3: {
    name: 'Ammoniac',
    formula: 'NH3',
    atoms: [
      { element: 'N', position: [0, 0.15, 0], color: ATOM_COLORS.N, radius: ATOM_RADII.N },
      { element: 'H', position: [-0.8, -0.45, 0.5], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
      { element: 'H', position: [0.8, -0.45, 0.5], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
      { element: 'H', position: [0, -0.45, -0.85], color: ATOM_COLORS.H, radius: ATOM_RADII.H },
    ],
    bonds: [
      { start: [0, 0.15, 0], end: [-0.8, -0.45, 0.5] },
      { start: [0, 0.15, 0], end: [0.8, -0.45, 0.5] },
      { start: [0, 0.15, 0], end: [0, -0.45, -0.85] },
    ]
  }
};

interface ReactionPreset {
  name: string;
  equation: string;
  reactants: Array<{
    offset: [number, number, number];
    data: MoleculeData;
  }>;
  products: Array<{
    offset: [number, number, number];
    data: MoleculeData;
  }>;
}

// Visual Reaction Presets Configuration
const REACTION_PRESETS: Record<string, ReactionPreset> = {
  water_synthesis: {
    name: 'Synthèse de l\'Eau',
    equation: '2 H₂ + O₂ ➔ 2 H₂O',
    reactants: [
      { offset: [-2.2, 0.8, 0], data: MOLECULE_PRESETS.H2 },
      { offset: [-2.2, -0.8, 0], data: MOLECULE_PRESETS.H2 },
      { offset: [-0.6, 0, 0], data: MOLECULE_PRESETS.O2 },
    ],
    products: [
      { offset: [1.2, 0.8, 0], data: MOLECULE_PRESETS.H2O },
      { offset: [1.2, -0.8, 0], data: MOLECULE_PRESETS.H2O },
    ]
  },
  co2_synthesis: {
    name: 'Combustion du Carbone',
    equation: 'C + O₂ ➔ CO₂',
    reactants: [
      { offset: [-2.0, 0, 0], data: {
          name: 'Carbone Solitaire',
          atoms: [{ element: 'C', position: [0, 0, 0], color: ATOM_COLORS.C, radius: ATOM_RADII.C }],
          bonds: []
        }
      },
      { offset: [-0.4, 0, 0], data: MOLECULE_PRESETS.O2 },
    ],
    products: [
      { offset: [1.2, 0, 0], data: MOLECULE_PRESETS.CO2 }
    ]
  },
  hcl_synthesis: {
    name: 'Synthèse du Chlorure d\'Hydrogène',
    equation: 'H₂ + Cl₂ ➔ 2 HCl',
    reactants: [
      // H2 molecule
      { offset: [-2.2, 0, 0], data: MOLECULE_PRESETS.H2 },
      // Cl2 molecule
      { offset: [-0.5, 0, 0], data: {
          name: 'Dichlore', formula: 'Cl2',
          atoms: [
            { element: 'Cl', position: [-0.7, 0, 0], color: ATOM_COLORS.Cl, radius: ATOM_RADII.Cl },
            { element: 'Cl', position: [0.7, 0, 0], color: ATOM_COLORS.Cl, radius: ATOM_RADII.Cl }
          ],
          bonds: [{ start: [-0.7, 0, 0], end: [0.7, 0, 0] }]
        }
      }
    ],
    products: [
      { offset: [1.3, 0.7, 0], data: MOLECULE_PRESETS.HCl },
      { offset: [1.3, -0.7, 0], data: MOLECULE_PRESETS.HCl }
    ]
  }
};

export default function MoleculeViewer({ molecule }: { molecule?: any }) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0); // 0 to 1

  // Dynamic reaction parsing or mapping
  const activeReaction = useMemo<ReactionPreset | null>(() => {
    if (!molecule) return null;

    const formulaStr = (molecule.formula || molecule.name || "").toLowerCase();
    
    // Look for indicative reaction words or arrows
    if (formulaStr.includes('->') || formulaStr.includes('➔') || formulaStr.includes('+')) {
      if (formulaStr.includes('h2o') && formulaStr.includes('o2') && formulaStr.includes('h2')) {
        return REACTION_PRESETS.water_synthesis;
      }
      if (formulaStr.includes('co2') && formulaStr.includes('c')) {
        return REACTION_PRESETS.co2_synthesis;
      }
      if (formulaStr.includes('hcl')) {
        return REACTION_PRESETS.hcl_synthesis;
      }
      
      // Default to water synthesis as a beautiful fallback reaction showcase
      return REACTION_PRESETS.water_synthesis;
    }

    return null;
  }, [molecule]);

  // Static molecule parsing
  const staticMolecule = useMemo<MoleculeData>(() => {
    if (!molecule) return MOLECULE_PRESETS.H2O; // default water

    // If matches one of our clean presets
    const formulaUpper = (molecule.formula || '').toUpperCase();
    if (MOLECULE_PRESETS[formulaUpper]) {
      return MOLECULE_PRESETS[formulaUpper];
    }

    // Parse model structure returned from AI
    if (molecule.nodes && Array.isArray(molecule.nodes)) {
      const atoms = molecule.nodes.map((node: any, idx: number) => ({
        id: node.id !== undefined ? String(node.id) : `node-${idx}`,
        element: node.element || 'H',
        position: node.position || [0, 0, 0],
        color: ATOM_COLORS[node.element] || '#a855f7',
        radius: ATOM_RADII[node.element] || 0.35,
      }));

      const bonds = (molecule.links || []).map((link: any) => {
        const sourceNode = molecule.nodes.find((n: any) => n.id === link.source);
        const targetNode = molecule.nodes.find((n: any) => n.id === link.target);
        if (sourceNode && targetNode) {
          return {
            start: sourceNode.position || [0, 0, 0],
            end: targetNode.position || [0, 0, 0],
          };
        }
        return null;
      }).filter(Boolean);

      return {
        name: molecule.name || 'Molécule IA',
        formula: molecule.formula,
        atoms,
        bonds,
      };
    }

    // Default to a customized MoleculeData
    return {
      name: molecule.name || 'Molécule inconnue',
      formula: molecule.formula,
      atoms: molecule.atoms || MOLECULE_PRESETS.H2O.atoms,
      bonds: molecule.bonds || MOLECULE_PRESETS.H2O.bonds,
    };
  }, [molecule]);

  // Handle reaction progress scheduling tick
  useEffect(() => {
    let interval: any = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 1.0) {
            // Loop back cleanly
            return 0;
          }
          return Math.min(1.0, prev + 0.008);
        });
      }, 16); // ~ 60 FPS update
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="w-full flex flex-col rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-xl">
      {/* Dynamic Interactive Toolbar / Title */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/60 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50/60 rounded-xl border border-indigo-100 text-indigo-500">
            <Beaker className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-slate-800 text-sm">
              {activeReaction ? activeReaction.name : staticMolecule.name}
            </h3>
            <p className="font-mono text-[11px] text-slate-500">
              {activeReaction ? activeReaction.equation : `Formule de structure : ${staticMolecule.formula || 'N/A'}`}
            </p>
          </div>
        </div>

        {/* Action Controls for Reaction Simulators */}
        {activeReaction && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 transition-all text-xs flex items-center gap-1.5 px-3 font-semibold active:scale-95"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : 'Simuler'}
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setProgress(0);
              }}
              className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 transition-all text-xs flex items-center justify-center font-medium active:scale-95"
              title="Réinitialiser"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Primary 3D Viewport Area */}
      <div className="w-full h-[400px] md:h-[450px] relative cursor-pointer active:cursor-grabbing group">
        <Canvas shadows gl={{ antialias: true }} className="w-full h-full">
          <PerspectiveCamera makeDefault position={[0, 0, 6.5]} fov={45} />
          
          {/* Controls to orbit around molecular target */}
          <OrbitControls 
            enablePan={false} 
            enableZoom={true} 
            minDistance={3} 
            maxDistance={12} 
          />

          {/* Clean, detailed atmospheric lighting configurations */}
          <ambientLight intensity={0.7} />
          
          <pointLight 
            position={[10, 10, 10]} 
            intensity={1.2} 
            castShadow 
            shadow-mapSize={[1024, 1024]} 
          />
          
          <spotLight 
            position={[-12, -4, -10]} 
            angle={0.4} 
            penumbra={1} 
            intensity={0.6} 
          />
          
          <directionalLight 
            position={[0, 15, -5]} 
            intensity={0.4} 
          />

          {/* Conditional Rendering logic for static vs reacting models */}
          {activeReaction ? (
            <group>
              {/* Reactants: Displayed during first half, vibrating, shrinking */}
              {activeReaction.reactants.map((reactant, i) => (
                <group key={`reactant-${i}`} position={reactant.offset}>
                  <MoleculeModel
                    data={reactant.data}
                    isReacting={true}
                    reactionProgress={progress}
                    isReactant={true}
                  />
                </group>
              ))}

              {/* Products: Displayed during second half, scaling up, settling */}
              {activeReaction.products.map((product, i) => (
                <group key={`product-${i}`} position={product.offset}>
                  <MoleculeModel
                    data={product.data}
                    isReacting={true}
                    reactionProgress={progress}
                    isProduct={true}
                  />
                </group>
              ))}
            </group>
          ) : (
            // Pure standard static molecule float viewer
            <MoleculeModel data={staticMolecule} isReacting={false} />
          )}
        </Canvas>

        {/* Reaction stage phase overlays */}
        {activeReaction && (
          <div className="absolute inset-x-0 bottom-16 flex justify-center pointer-events-none z-10 select-none px-4">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-600 bg-white/90 px-3 py-1 rounded-full border border-slate-150 shadow-sm backdrop-blur-md">
              {progress < 0.48 ? (
                <span className="text-amber-600 flex items-center gap-1">⚡ Réactifs en excitation ({Math.round(progress * 200)}%)</span>
              ) : progress < 0.53 ? (
                <span className="text-slate-800 animate-pulse flex items-center gap-1">☄️ Point d'activation atteint !</span>
              ) : (
                <span className="text-cyan-600 flex items-center gap-1">🧪 Formation des Produits ({Math.round((progress - 0.5) * 200)}%)</span>
              )}
            </span>
          </div>
        )}

        {/* Soft educational helper banner overlay */}
        <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-[10px] text-slate-500 bg-white/85 px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm backdrop-blur-md select-none pointer-events-none transition-opacity duration-300 group-hover:opacity-10 opacity-70">
          <Info className="w-3 h-3 text-indigo-500" />
          <span>Faites glisser pour tourner • Molette pour zoomer</span>
        </div>

        {/* Professional attribution badge */}
        <div className="absolute bottom-4 right-4 text-[9px] text-slate-450 tracking-widest font-mono select-none pointer-events-none">
          CHIMIE 3D SYSTEM
        </div>
      </div>

      {/* Manual timeline scrubber slider bar for reaction control */}
      {activeReaction && (
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row items-center gap-4 relative z-10">
          <div className="flex items-center gap-2 min-w-[130px]">
            <Beaker className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-705 font-bold uppercase tracking-wider font-display">Évolution chimique :</span>
          </div>
          
          <div className="flex-1 w-full flex items-center gap-3">
            <span className="text-[10px] font-mono text-amber-600 w-16 text-right font-bold uppercase select-none">H₂ + O₂</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={progress}
              onChange={(e) => {
                setIsPlaying(false);
                setProgress(parseFloat(e.target.value));
              }}
              className="flex-1 h-1.5 rounded-lg bg-slate-200 accent-indigo-500 hover:accent-indigo-400 cursor-pointer outline-none transition-all"
            />
            <span className="text-[10px] font-mono text-cyan-600 w-16 text-left font-bold uppercase select-none">H₂O</span>
          </div>

          <div className="text-[11px] font-mono font-semibold text-slate-600 flex items-center gap-2 select-none bg-white px-2.5 py-1 rounded-md border border-slate-200 min-w-[70px] justify-center shadow-xs">
            {Math.round(progress * 100)} %
          </div>
        </div>
      )}
    </div>
  );
}
export { MoleculeViewer };
