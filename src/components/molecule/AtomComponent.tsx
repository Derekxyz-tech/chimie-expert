import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface AtomComponentProps {
  atom: {
    id?: string;
    element: string;
    position: [number, number, number];
    color: string;
    radius: number;
  };
  isReacting?: boolean;
  reactionProgress?: number; // 0 to 1
}

export function AtomComponent({ atom, isReacting = false, reactionProgress = 0 }: AtomComponentProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const labelRef = useRef<THREE.Group>(null!);

  const originalPos = useMemo(() => new THREE.Vector3(...atom.position), [atom.position]);

  useFrame((state) => {
    const clock = state.clock;
    const time = clock.getElapsedTime();

    if (meshRef.current) {
      if (isReacting) {
        // Organic/increasing vibration as reaction reaches peak (progress around 0.5)
        const amplitude = 0.25 * Math.sin(reactionProgress * Math.PI) * Math.sin(time * 60 + originalPos.x * 10);
        meshRef.current.position.set(
          originalPos.x + (Math.random() - 0.5) * amplitude,
          originalPos.y + (Math.random() - 0.5) * amplitude,
          originalPos.z + (Math.random() - 0.5) * amplitude
        );
      } else {
        // Soft idle micromotion
        const idleX = Math.sin(time * 1.5 + originalPos.x) * 0.02;
        const idleY = Math.cos(time * 1.2 + originalPos.y) * 0.02;
        const idleZ = Math.sin(time * 1.8 + originalPos.z) * 0.02;
        meshRef.current.position.set(
          originalPos.x + idleX,
          originalPos.y + idleY,
          originalPos.z + idleZ
        );
      }
    }

    // Keep label positioned slightly above the vibrating mesh base
    if (labelRef.current && meshRef.current) {
      labelRef.current.position.copy(meshRef.current.position).add(new THREE.Vector3(0, atom.radius + 0.45, 0));
    }
  });

  // Calculate scaling factor during physical state transition
  const scale = useMemo(() => {
    if (isReacting) {
      // Shimmering size pulsing
      return 1.0 + Math.sin(reactionProgress * Math.PI) * 0.15;
    }
    return 1.0;
  }, [isReacting, reactionProgress]);

  // Interactive hover event feedback states
  const [hovered, setHovered] = React.useState(false);

  return (
    <group>
      {/* Central Atom Mesh */}
      <mesh
        ref={meshRef}
        scale={[scale * (hovered ? 1.15 : 1.0), scale * (hovered ? 1.15 : 1.0), scale * (hovered ? 1.15 : 1.0)]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[atom.radius, 32, 32]} />
        <meshStandardMaterial
          color={atom.color}
          roughness={0.25}
          metalness={0.2}
          emissive={isReacting ? atom.color : '#000000'}
          emissiveIntensity={isReacting ? Math.sin(reactionProgress * Math.PI) * 0.6 : 0}
        />
      </mesh>

      {/* Floating Billboard HTML Text Label */}
      <group ref={labelRef}>
        <Html distanceFactor={8} center>
          <div 
            style={{ borderColor: atom.color }}
            className="flex items-center justify-center font-sans font-bold text-white bg-slate-900/90 border-2 rounded-full w-8 h-8 select-none text-xs shadow-lg leading-none transform transition-all duration-300 pointer-events-none"
          >
            {atom.element}
          </div>
        </Html>
      </group>
    </group>
  );
}
