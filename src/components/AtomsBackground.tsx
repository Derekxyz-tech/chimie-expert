import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

function AtomPoints() {
  const ref = useRef<THREE.Points>(null!);
  
  // Create a sphere of points
  const [positions, connections] = useMemo(() => {
    const count = 100;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    
    // Create some random connections for lines
    const conn: number[] = [];
    for (let i = 0; i < count; i++) {
      if (Math.random() > 0.9) {
        const target = Math.floor(Math.random() * count);
        conn.push(i, target);
      }
    }
    
    return [pos, new Float32Array(conn)];
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const { x, y } = state.mouse;
    
    ref.current.rotation.y = t * 0.05 + x * 0.05;
    ref.current.rotation.x = t * 0.02 + y * 0.05;
  });

  return (
    <group>
      <Points ref={ref} positions={positions} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color="#6366f1"
          size={0.08}
          sizeAttenuation={true}
          depthWrite={false}
          opacity={0.2}
        />
      </Points>
      <primitive object={new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
        new THREE.LineBasicMaterial({ color: '#6366f1', transparent: true, opacity: 0.05 })
      )} />
    </group>
  );
}

export default function AtomsBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-white">
      <Canvas camera={{ position: [0, 0, 8], fov: 60 }}>
        <AtomPoints />
      </Canvas>
      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-50/50 via-transparent to-slate-50/50" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(248,250,252,0.4)_100%)]" />
    </div>
  );
}
