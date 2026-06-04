import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtomComponent } from './AtomComponent';
import { BondComponent } from './BondComponent';

interface MoleculeModelProps {
  data: {
    atoms: Array<{
      id?: string;
      element: string;
      position: [number, number, number];
      color: string;
      radius: number;
    }>;
    bonds: Array<{
      start: [number, number, number];
      end: [number, number, number];
    }>;
  };
  isReacting?: boolean;
  reactionProgress?: number; // 0 to 1
  isReactant?: boolean;      // Scales down if true
  isProduct?: boolean;       // Scales up if true
}

export function MoleculeModel({
  data,
  isReacting = false,
  reactionProgress = 0,
  isReactant = false,
  isProduct = false,
}: MoleculeModelProps) {
  const groupRef = useRef<THREE.Group>(null!);

  // Automatic slow floating & rotation
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (groupRef.current) {
      if (isReacting) {
        // Accelerated spin representing high thermal/chemical energy states
        groupRef.current.rotation.y = time * 1.5;
        groupRef.current.rotation.x = Math.sin(time * 0.8) * 0.25;
      } else {
        // Soft, calming default float
        groupRef.current.rotation.y = time * 0.12;
        groupRef.current.rotation.x = Math.sin(time * 0.4) * 0.1;
        // Breathing vertical coordinate float
        groupRef.current.position.y = Math.sin(time * 1.5) * 0.08;
      }
    }
  });

  // Calculate dynamic reaction scale modifier
  // "La taille des réactifs diminue (progress) pendant que celle des produits augmente"
  const modelScale = useMemo(() => {
    if (!isReacting) return 1.0;
    
    if (isReactant) {
      // Shrinks down to almost zero
      return THREE.MathUtils.lerp(1.0, 0.01, reactionProgress);
    }
    if (isProduct) {
      // Scales up from zero
      return THREE.MathUtils.lerp(0.01, 1.0, reactionProgress);
    }
    return 1.0;
  }, [isReacting, reactionProgress, isReactant, isProduct]);

  // Fade transparency modifier for reactant disappearance / product appearance
  const opacityFactor = useMemo(() => {
    if (!isReacting) return 1.0;
    if (isReactant) return Math.max(0, 1 - reactionProgress);
    if (isProduct) return Math.min(1, reactionProgress);
    return 1.0;
  }, [isReacting, reactionProgress, isReactant, isProduct]);

  if (!data || !data.atoms) return null;

  return (
    <group ref={groupRef} scale={[modelScale, modelScale, modelScale]}>
      {/* Structural Atomic Elements */}
      {data.atoms.map((atom, i) => (
        <AtomComponent
          key={atom.id || `atom-${i}`}
          atom={atom}
          isReacting={isReacting}
          reactionProgress={reactionProgress}
        />
      ))}

      {/* Connectivity Chemical Bonds */}
      {data.bonds?.map((bond, i) => (
        <BondComponent
          key={`bond-${i}`}
          bond={bond}
          isReacting={isReacting}
          reactionProgress={reactionProgress}
        />
      ))}

      {/* Reactive Glowing Energy Wireframe Boundary Box (Jaune/Cyan Blending) */}
      {isReacting && opacityFactor > 0.05 && (
        <mesh>
          <sphereGeometry args={[2.3, 16, 16]} />
          <meshBasicMaterial
            color={reactionProgress > 0.48 ? '#22d3ee' : '#eab308'} // Blends vibrant cyan/yellow
            wireframe={true}
            transparent={true}
            opacity={Math.sin(reactionProgress * Math.PI) * 0.45 * opacityFactor}
          />
        </mesh>
      )}
    </group>
  );
}

export default MoleculeModel;
