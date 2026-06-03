import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, MeshDistortMaterial, Float, Text } from '@react-three/drei';

const AtomModel = () => {
  return (
    <group>
      {/* Nucleus */}
      <Sphere args={[0.3, 32, 32]}>
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.5} />
      </Sphere>
      
      {/* Electron Orbits */}
      <Float speed={2} rotationIntensity={2} floatIntensity={1}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.8, 0.01, 16, 100]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} />
        </mesh>
        <Sphere args={[0.08, 16, 16]} position={[0.8, 0, 0]}>
          <meshStandardMaterial color="#60a5fa" emissive="#60a5fa" emissiveIntensity={1} />
        </Sphere>
      </Float>

      <Float speed={1.5} rotationIntensity={1.5} floatIntensity={0.5}>
        <mesh rotation={[0, Math.PI / 4, 0]}>
          <torusGeometry args={[0.9, 0.01, 16, 100]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} />
        </mesh>
        <Sphere args={[0.08, 16, 16]} position={[0, 0, 0.9]}>
          <meshStandardMaterial color="#60a5fa" emissive="#60a5fa" emissiveIntensity={1} />
        </Sphere>
      </Float>
    </group>
  );
};

const MoleculeModel = () => {
  return (
    <group>
      <Sphere args={[0.3, 32, 32]} position={[-0.4, 0, 0]}>
        <meshStandardMaterial color="#3b82f6" />
      </Sphere>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.8, 32]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
      <Sphere args={[0.3, 32, 32]} position={[0.4, 0, 0]}>
        <meshStandardMaterial color="#ef4444" />
      </Sphere>
    </group>
  );
};

const GeneralModel = () => {
    return (
      <Float speed={1.5} rotationIntensity={1.5} floatIntensity={0.5}>
        <mesh>
          <octahedronGeometry args={[0.6]} />
          <MeshDistortMaterial color="#818cf8" speed={2} distort={0.3} radius={0.6} />
        </mesh>
      </Float>
    );
};

export const ModelViewer = ({ type }: { type?: string }) => {
  return (
    <div className="w-full h-32 bg-slate-900 rounded-xl overflow-hidden shadow-inner cursor-grab active:cursor-grabbing">
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <spotLight position={[-10, 10, 10]} angle={0.2} penumbra={1} intensity={1} />
        
        {type === 'atom' ? <AtomModel /> : type === 'molecule' ? <MoleculeModel /> : <GeneralModel />}
        
        <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={2} />
      </Canvas>
    </div>
  );
};
