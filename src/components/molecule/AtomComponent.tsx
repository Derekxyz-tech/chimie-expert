import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
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

export function AtomComponent({ atom, isReacting = false, reactionProgress = 0 }: AtomComponentProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const labelRef = useRef<THREE.Group>(null!);

  const originalPos = useMemo(() => new THREE.Vector3(...atom.position), [atom.position]);

  // Generate canvas texture once for the symbol
  const textTexture = useMemo(() => {
    const canvas = createTextCanvas(atom.element, atom.color);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [atom.element, atom.color]);

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

    // Keep the element label billboard-oriented towards camera
    if (labelRef.current) {
      labelRef.current.quaternion.copy(state.camera.quaternion);
      
      // Keep label positioned slightly above the vibrating mesh base
      if (meshRef.current) {
        labelRef.current.position.copy(meshRef.current.position).add(new THREE.Vector3(0, atom.radius + 0.45, 0));
      }
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

      {/* Floating Billboard Text Label */}
      <group ref={labelRef}>
        <mesh renderOrder={100}>
          <planeGeometry args={[0.65, 0.65]} />
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
