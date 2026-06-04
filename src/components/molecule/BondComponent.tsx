import React, { useMemo } from 'react';
import * as THREE from 'three';

interface BondComponentProps {
  bond: {
    start: [number, number, number];
    end: [number, number, number];
  };
  isReacting?: boolean;
  reactionProgress?: number;
}

export function BondComponent({ bond, isReacting = false, reactionProgress = 0 }: BondComponentProps) {
  const { position, quaternion, length } = useMemo(() => {
    const startVec = new THREE.Vector3(...bond.start);
    const endVec = new THREE.Vector3(...bond.end);

    const direction = new THREE.Vector3().subVectors(endVec, startVec);
    const length = direction.length();
    
    // Central position point
    const position = startVec.clone().add(direction.clone().multiplyScalar(0.5));
    
    // Compute rotation quaternion
    const up = new THREE.Vector3(0, 1, 0);
    const normalizedDirection = direction.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normalizedDirection);

    return { position, quaternion, length };
  }, [bond.start, bond.end]);

  // Handle reaction shrinking/distorting of reactant bonds vs product bonds
  const currentRadius = useMemo(() => {
    const baseRadius = 0.07;
    if (isReacting) {
      // Slightly pulse diameter of bond during reaction energy transfers
      return baseRadius * (1.0 + Math.sin(reactionProgress * Math.PI * 2) * 0.25);
    }
    return baseRadius;
  }, [isReacting, reactionProgress]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[currentRadius, currentRadius, length, 16]} />
      <meshStandardMaterial
        color={isReacting ? '#f43f5e' : '#64748b'} // rose-500 red during reaction, slate-500 otherwise
        roughness={0.4}
        metalness={0.3}
        transparent={true}
        opacity={isReacting ? 0.9 - (Math.abs(0.5 - reactionProgress) * 0.5) : 0.8}
        emissive={isReacting ? '#be123c' : '#000000'}
        emissiveIntensity={isReacting ? Math.sin(reactionProgress * Math.PI) * 0.4 : 0}
      />
    </mesh>
  );
}
export default BondComponent;
