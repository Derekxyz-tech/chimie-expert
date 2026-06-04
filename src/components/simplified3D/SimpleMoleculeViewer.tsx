import React, { Component, ReactNode, Suspense, lazy, useMemo, useState, useRef, useEffect } from 'react';
import { Loader2, Beaker, Info, RefreshCw } from 'lucide-react';

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
    console.warn("WebGL Context unavailable. Falling back to High-Fidelity 2D/3D Interactive Vector Engine.", error, errorInfo);
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

const ATOM_COLORS: Record<string, string> = {
  H: '#f8fafc',  // White/slate
  C: '#475569',  // Dark slate (slate-600)
  O: '#ef4444',  // Vibrant Red
  N: '#3b82f6',  // Blue
  Cl: '#22c55e', // Green
  S: '#fbbf24',  // Yellow
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

// Presets matching MoleculeViewer
const MOLECULE_PRESETS: Record<string, any> = {
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
      { start: [-0.65, -0.05, 0], end: [0.65, -0.05, 0] },
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

const REACTION_PRESETS: Record<string, any> = {
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
          name: 'Carbone',
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
      { offset: [-2.2, 0, 0], data: MOLECULE_PRESETS.H2 },
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

// Shimmering skeleton loader screen configured in high contrast white
function ViewerSkeleton() {
  return (
    <div className="w-full h-[400px] rounded-3xl bg-white border border-slate-200 flex flex-col items-center justify-center p-6 relative shadow-sm">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-500 animate-pulse">
          Chargement de l'environnement 3D...
        </span>
      </div>
    </div>
  );
}

// Inter-compatible responsive 2D high-fidelity visualizer with real-time 3D rotation math
function FlatMoleculeFallback({ molecule }: { molecule?: any }) {
  const [rotX, setRotX] = useState<number>(0.2);
  const [rotY, setRotY] = useState<number>(-0.4);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 1. Resolve reaction preset or normal static molecule
  const activeReaction = useMemo(() => {
    if (!molecule) return null;
    const formulaStr = (molecule.formula || molecule.name || "").toLowerCase();
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
      return REACTION_PRESETS.water_synthesis;
    }
    return null;
  }, [molecule]);

  const parsedData = useMemo(() => {
    if (activeReaction) {
      const atomsList: any[] = [];
      const bondsList: any[] = [];
      
      // Inject Reactants offset
      activeReaction.reactants.forEach((reactant: any) => {
        const offset = reactant.offset;
        reactant.data.atoms.forEach((atom: any) => {
          atomsList.push({
            ...atom,
            position: [
              atom.position[0] + offset[0],
              atom.position[1] + offset[1],
              atom.position[2] + offset[2]
            ]
          });
        });
        reactant.data.bonds.forEach((bond: any) => {
          bondsList.push({
            start: [bond.start[0] + offset[0], bond.start[1] + offset[1], bond.start[2] + offset[2]],
            end: [bond.end[0] + offset[0], bond.end[1] + offset[1], bond.end[2] + offset[2]],
          });
        });
      });

      // Inject Products offset
      activeReaction.products.forEach((product: any) => {
        const offset = product.offset;
        product.data.atoms.forEach((atom: any) => {
          atomsList.push({
            ...atom,
            position: [
              atom.position[0] + offset[0],
              atom.position[1] + offset[1],
              atom.position[2] + offset[2]
            ],
            isProduct: true
          });
        });
        product.data.bonds.forEach((bond: any) => {
          bondsList.push({
            start: [bond.start[0] + offset[0], bond.start[1] + offset[1], bond.start[2] + offset[2]],
            end: [bond.end[0] + offset[0], bond.end[1] + offset[1], bond.end[2] + offset[2]],
            isProduct: true
          });
        });
      });

      return {
        name: activeReaction.name,
        formula: activeReaction.equation,
        atoms: atomsList,
        bonds: bondsList
      };
    }

    if (!molecule) {
      return MOLECULE_PRESETS.H2O;
    }

    const formulaUpper = (molecule.formula || '').toUpperCase();
    if (MOLECULE_PRESETS[formulaUpper]) {
      return MOLECULE_PRESETS[formulaUpper];
    }

    if (molecule.nodes && Array.isArray(molecule.nodes)) {
      const atoms = molecule.nodes.map((node: any, idx: number) => ({
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
        name: molecule.name || "Molécule Reconstituée",
        formula: molecule.formula || "",
        atoms,
        bonds
      };
    }

    return MOLECULE_PRESETS.H2O;
  }, [molecule, activeReaction]);

  // 2. Center of gravity & Rotational matrix projection calculation
  const projectProps = useMemo(() => {
    const atoms = parsedData.atoms || [];
    const bonds = parsedData.bonds || [];

    let cx = 0, cy = 0, cz = 0;
    if (atoms.length > 0) {
      atoms.forEach((a: any) => {
        cx += a.position[0];
        cy += a.position[1];
        cz += a.position[2];
      });
      cx /= atoms.length;
      cy /= atoms.length;
      cz /= atoms.length;
    }

    let maxDist = 0.1;
    atoms.forEach((a: any) => {
      const rx = a.position[0] - cx;
      const ry = a.position[1] - cy;
      const rz = a.position[2] - cz;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (d > maxDist) maxDist = d;
    });

    const scale = Math.min(100, 110 / maxDist);

    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);

    const projectPoint = (pos: [number, number, number]) => {
      const rx = pos[0] - cx;
      const ry = pos[1] - cy;
      const rz = pos[2] - cz;

      // Rotate Y (Yaw)
      const x1 = rx * cosY - rz * sinY;
      const z1 = rx * sinY + rz * cosY;

      // Rotate X (Pitch)
      const y2 = ry * cosX - z1 * sinX;
      const z2 = ry * sinX + z1 * cosX;

      return {
        x: 200 + x1 * scale,
        y: 150 - y2 * scale,
        z: z2
      };
    };

    const projectedAtoms = atoms.map((atom: any, i: number) => {
      const proj = projectPoint(atom.position);
      return {
        ...atom,
        projX: proj.x,
        projY: proj.y,
        projZ: proj.z,
        index: i
      };
    });

    // Sort atoms by Z position (painter's algorithm) so they overlap correctly inside SVG
    const sortedAtoms = [...projectedAtoms].sort((a, b) => a.projZ - b.projZ);

    const projectedBonds = bonds.map((bond: any, i: number) => {
      const pStart = projectPoint(bond.start);
      const pEnd = projectPoint(bond.end);
      return {
        id: `bond-${i}`,
        x1: pStart.x,
        y1: pStart.y,
        x2: pEnd.x,
        y2: pEnd.y,
        z: (pStart.z + pEnd.z) / 2
      };
    });

    return { projectedBonds, sortedAtoms };
  }, [parsedData, rotX, rotY]);

  // Drag handlers to turn model
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    setRotY(prev => prev + dx * 0.012);
    setRotX(prev => Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, prev - dy * 0.012)));
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };

    setRotY(prev => prev + dx * 0.015);
    setRotX(prev => Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, prev - dy * 0.015)));
  };

  return (
    <div 
      className="w-full flex flex-col rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-xl"
    >
      {/* Header toolbar */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/60 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50/60 rounded-xl border border-indigo-100 text-indigo-500">
            <Beaker className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-slate-800 text-sm">
              {parsedData.name || "Visualisation Chimique"}
            </h3>
            <p className="font-mono text-[11px] text-slate-500">
              Formule de structure : {parsedData.formula || "Structure 2D/3D"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg border border-emerald-100 text-[10px] font-bold uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
          Moteur 2D/3D Actif
        </div>
      </div>

      {/* Main vector stage area */}
      <div 
        className="w-full h-[400px] md:h-[450px] relative cursor-grab active:cursor-grabbing select-none bg-[#fafafa]"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUpOrLeave}
      >
        <svg 
          viewBox="0 0 400 300" 
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Legend indicator arrow */}
          {activeReaction && (
            <g transform="translate(200, 150)" opacity="0.6">
              <rect x="-30" y="-12" width="60" height="24" rx="12" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
              <text x="0" y="4" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="bold">➔</text>
            </g>
          )}

          {/* Draw Bonds */}
          {projectProps.projectedBonds.map((bond) => (
            <line
              key={bond.id}
              x1={bond.x1}
              y1={bond.y1}
              x2={bond.x2}
              y2={bond.y2}
              stroke="#cbd5e1"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.9"
            />
          ))}

          {/* Draw Atoms sorted by painter index */}
          {projectProps.sortedAtoms.map((atom) => {
            const size = (atom.radius || 0.35) * 50;
            const darkBorder = atom.element === 'H' ? '#94a3b8' : '#334155';
            const color = atom.color || '#3b82f6';

            return (
              <g key={`atom-${atom.index}`}>
                {/* 3D sphere gradient highlight */}
                <defs>
                  <radialGradient id={`shading-${atom.index}`} cx="35%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
                    <stop offset="40%" stopColor={color} stopOpacity="0.95" />
                    <stop offset="100%" stopColor={color === '#f8fafc' ? '#cbd5e1' : '#000000'} stopOpacity="0.3" />
                  </radialGradient>
                </defs>

                {/* Ambient glow drop shadow */}
                <circle
                  cx={atom.projX + 2}
                  cy={atom.projY + 3}
                  r={size}
                  fill="#000"
                  opacity="0.08"
                />

                {/* Atom core */}
                <circle
                  cx={atom.projX}
                  cy={atom.projY}
                  r={size}
                  fill={`url(#shading-${atom.index})`}
                  stroke={darkBorder}
                  strokeWidth="1.5"
                />

                {/* Chemical element letter */}
                <text
                  x={atom.projX}
                  y={atom.projY + 4}
                  textAnchor="middle"
                  fill={atom.element === 'H' ? '#475569' : '#ffffff'}
                  fontSize={size * 0.9}
                  fontWeight="bold"
                  fontFamily="sans-serif"
                  pointerEvents="none"
                >
                  {atom.element}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Soft interactive hint overlays */}
        <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-[10px] text-slate-500 bg-white/85 px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm backdrop-blur-md select-none pointer-events-none opacity-80">
          <Info className="w-3.5 h-3.5 text-indigo-500" />
          <span>Faites glisser pour faire tourner en 3D</span>
        </div>

        <div className="absolute bottom-4 right-4 text-[9px] text-slate-400 tracking-widest font-mono select-none pointer-events-none">
          CHIMIE INFOGRAFIQ ENGINE
        </div>
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
