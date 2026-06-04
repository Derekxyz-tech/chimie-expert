import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Float, Text } from '@react-three/drei';
import * as THREE from 'three';

interface Atom {
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
  atoms: Atom[];
  bonds: Bond[];
}

const ATOM_COLORS: Record<string, string> = {
  H: '#ffffff',
  C: '#333333',
  O: '#ff0000',
  N: '#0000ff',
  Cl: '#00ff00',
  S: '#ffff00',
  P: '#ffa500',
};

const ATOM_RADII: Record<string, number> = {
  H: 0.25,
  C: 0.4,
  O: 0.35,
  N: 0.35,
  Cl: 0.45,
  S: 0.5,
  P: 0.5,
};

function createTextCanvas(text: string, color: string = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    // Draw solid circle backing for high contrast legibility
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)'; // slate-900 transparent background
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Draw text symbol
    ctx.font = 'bold 55px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);
  }
  return canvas;
}

function AtomWithLabel({ atom }: { atom: Atom }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const labelRef = useRef<THREE.Group>(null!);

  const textTexture = useMemo(() => {
    const canvas = createTextCanvas(atom.element, atom.color);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [atom.element, atom.color]);

  useFrame((state) => {
    if (labelRef.current) {
      labelRef.current.quaternion.copy(state.camera.quaternion);
      
      const pos = new THREE.Vector3(...atom.position);
      labelRef.current.position.copy(pos).add(new THREE.Vector3(0, atom.radius + 0.35, 0));
    }
  });

  return (
    <group>
      <mesh ref={meshRef} position={atom.position}>
        <sphereGeometry args={[atom.radius, 32, 32]} />
        <meshStandardMaterial color={atom.color} roughness={0.3} metalness={0.2} />
      </mesh>
      <group ref={labelRef}>
        <mesh renderOrder={100}>
          <planeGeometry args={[0.5, 0.5]} />
          <meshBasicMaterial
            map={textTexture}
            transparent={true}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

function Molecule({ data }: { data: MoleculeData }) {
  const groupRef = useRef<THREE.Group>(null!);

  if (!data || !data.atoms || !data.bonds) return null;

  return (
    <group ref={groupRef}>
      {(data.atoms || []).map((atom, i) => (
        <AtomWithLabel key={i} atom={atom} />
      ))}
      {(data.bonds || []).map((bond, i) => {
        const start = new THREE.Vector3(...(bond.start || [0, 0, 0]));
        const end = new THREE.Vector3(...(bond.end || [0, 0, 0]));
        const direction = end.clone().sub(start);
        const length = direction.length();
        const center = start.clone().add(direction.clone().multiplyScalar(0.5));
        
        return (
          <mesh key={i} position={center} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())}>
            <cylinderGeometry args={[0.08, 0.08, length, 16]} />
            <meshStandardMaterial color="#cccccc" roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function MoleculeViewer3D({ molecule }: { molecule?: any }) {
  // Constants for color/radii
  const ATOM_COLORS: Record<string, string> = {
    H: '#ffffff', C: '#333333', O: '#ff0000', N: '#0000ff',
    Cl: '#00ff00', S: '#ffff00', P: '#ffa500'
  };
  const ATOM_RADII: Record<string, number> = {
    H: 0.25, C: 0.4, O: 0.35, N: 0.35, Cl: 0.45, S: 0.5, P: 0.5
  };

  const processedMolecule = useMemo(() => {
    if (!molecule) return null;

    // Handle the "nodes" and "links" format from AI
    if (molecule?.nodes && Array.isArray(molecule.nodes)) {
      const atoms = (molecule.nodes || []).map((node: any) => ({
        element: node.element || 'H',
        position: node.position || [0, 0, 0],
        color: ATOM_COLORS[node.element] || '#cccccc',
        radius: ATOM_RADII[node.element] || 0.4
      }));

      const bonds = (molecule.links || []).map((link: any) => {
        const sourceNode = (molecule.nodes || []).find((n: any) => n.id === link.source);
        const targetNode = (molecule.nodes || []).find((n: any) => n.id === link.target);
        if (sourceNode && targetNode) {
          return {
            start: sourceNode.position || [0, 0, 0],
            end: targetNode.position || [0, 0, 0]
          };
        }
        return null;
      }).filter(Boolean);

      return {
        name: molecule.name || "Molécule",
        atoms,
        bonds
      };
    }

    // Default to the provided molecule if it already satisfies the interface
    return {
      name: molecule.name || "Molécule",
      atoms: molecule.atoms || [],
      bonds: molecule.bonds || []
    };
  }, [molecule]);

  // Default fallback
  const defaultMolecule: MoleculeData = {
    name: 'Methane (CH4)',
    atoms: [
      { element: 'C', position: [0, 0, 0], color: '#333333', radius: 0.4 },
      { element: 'H', position: [1, 1, 1], color: '#ffffff', radius: 0.25 },
      { element: 'H', position: [-1, -1, 1], color: '#ffffff', radius: 0.25 },
      { element: 'H', position: [1, -1, -1], color: '#ffffff', radius: 0.25 },
      { element: 'H', position: [-1, 1, -1], color: '#ffffff', radius: 0.25 },
    ],
    bonds: [
      { start: [0, 0, 0], end: [1, 1, 1] },
      { start: [0, 0, 0], end: [-1, -1, 1] },
      { start: [0, 0, 0], end: [1, -1, -1] },
      { start: [0, 0, 0], end: [-1, 1, -1] },
    ]
  };

  const activeMolecule = processedMolecule || defaultMolecule;

  // Final check to prevent map errors
  if (!activeMolecule.atoms || !activeMolecule.bonds) {
     return <div className="p-4 bg-red-50 text-red-500 rounded-xl text-xs">Erreur de données moléculaires.</div>;
  }

  return (
    <div className="w-full h-[400px] rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm relative group">
      <div className="absolute top-4 left-4 z-10">
        <h3 className="text-sm font-display font-bold text-slate-800 bg-white/80 px-3 py-1 rounded-full backdrop-blur-md border border-slate-200/50 shadow-sm">
          {activeMolecule.name}
        </h3>
      </div>
      
      <Canvas shadows dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[0, 0, 5]} />
        <OrbitControls enablePan={false} enableZoom={true} autoRotate autoRotateSpeed={0.5} />
        
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
          <Molecule data={activeMolecule} />
        </Float>
      </Canvas>
      
      <div className="absolute bottom-4 right-4 text-[9px] text-slate-400 font-extrabold uppercase tracking-widest pointer-events-none animate-none">
        Chimie Expert 3D Engine
      </div>
    </div>
  );
}
