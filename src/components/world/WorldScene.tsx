import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/*
 * The Exchange Hall — an archaic, monumental financial interior.
 * Stone colonnades, a bronze-domed rotunda, a polished black marble floor.
 * Warm ivory light against a deep ink void; teal data lines are the only
 * modern intrusion.
 */

const VOID = "#0a0e13";
const STONE = "#d9cfba";
const STONE_DIM = "#9a907c";
const BRONZE = "#c99a5b";
const TEAL = "#56e6e2";
const AMBER = "#f2ad54";
const DUST = "#d8c9ad";

export const STATIONS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  { pos: [0, 1.4, 15], look: [0, 2.4, -4] },
  { pos: [9, 2.6, 9], look: [2, 1.5, -2] },
  { pos: [12.5, 3.4, 0], look: [3, 1.5, -4] },
  { pos: [8, 2.4, -11], look: [0, 2, -6] },
  { pos: [0, 4.2, -14], look: [-3, 1.5, -6] },
  { pos: [-9, 2.8, -10], look: [-8, 1.5, -2] },
  { pos: [-13, 3.6, 0], look: [-6, 1.5, 2] },
  { pos: [-9, 2.5, 10], look: [-2, 1.5, 2] },
  { pos: [-2, 3.6, 14], look: [0, 2, 2] },
  { pos: [5, 5, 12], look: [0, 1.5, 0] },
];

/* ---------- shared assets ---------- */

function useHallAssets() {
  return useMemo(() => {
    const stoneMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.58, metalness: 0.07 });
    const stoneDimMat = new THREE.MeshStandardMaterial({ color: STONE_DIM, roughness: 0.72, metalness: 0.04 });
    const bronzeMat = new THREE.MeshStandardMaterial({ color: BRONZE, roughness: 0.3, metalness: 0.88 });
    const tealLineMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.5 });
    const amberGlowMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.28 });

    const baseGeo = new THREE.BoxGeometry(1.5, 0.4, 1.5);
    const shaftGeo = new THREE.CylinderGeometry(0.42, 0.52, 5.4, 20);
    const capGeo = new THREE.BoxGeometry(1.62, 0.34, 1.62);

    return { stoneMat, stoneDimMat, bronzeMat, tealLineMat, amberGlowMat, baseGeo, shaftGeo, capGeo };
  }, []);
}

type Assets = ReturnType<typeof useHallAssets>;

/* ---------- architecture ---------- */

function Column({
  position,
  assets,
  scale = 1,
}: {
  position: [number, number, number];
  assets: Assets;
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh geometry={assets.baseGeo} material={assets.stoneDimMat} position={[0, 0.2, 0]} />
      <mesh geometry={assets.shaftGeo} material={assets.stoneMat} position={[0, 3.1, 0]} />
      <mesh geometry={assets.capGeo} material={assets.stoneMat} position={[0, 5.9, 0]} />
    </group>
  );
}

function Colonnade({ side, assets }: { side: 1 | -1; assets: Assets }) {
  const x = side * 13;
  const zs = useMemo(() => Array.from({ length: 9 }, (_, i) => -18 + i * 4.5), []);
  return (
    <group>
      {zs.map((z) => (
        <Column key={z} position={[x, 0, z]} assets={assets} />
      ))}
      {/* entablature + cornice running the length of the hall */}
      <mesh material={assets.stoneMat} position={[x, 6.5, 0]}>
        <boxGeometry args={[2.2, 0.85, 41]} />
      </mesh>
      <mesh material={assets.stoneDimMat} position={[x, 7.1, 0]}>
        <boxGeometry args={[2.7, 0.28, 41.8]} />
      </mesh>
      {/* market data line along the inner face */}
      <mesh material={assets.tealLineMat} position={[x - side * 1.25, 6.1, 0]}>
        <boxGeometry args={[0.07, 0.07, 39]} />
      </mesh>
      <mesh material={assets.amberGlowMat} position={[x - side * 1.25, 5.6, 0]}>
        <boxGeometry args={[0.05, 0.05, 39]} />
      </mesh>
    </group>
  );
}

function Rotunda({ assets }: { assets: Assets }) {
  const ring = useMemo(() => {
    const items: { pos: [number, number, number] }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      items.push({ pos: [Math.cos(angle) * 4.8, 0, Math.sin(angle) * 4.8] });
    }
    return items;
  }, []);

  return (
    <group position={[0, 0, -4]}>
      {/* ring of columns */}
      {ring.map((item, index) => (
        <Column key={index} position={item.pos} assets={assets} scale={0.92} />
      ))}
      {/* entablature drum */}
      <mesh material={assets.stoneMat} position={[0, 6.2, 0]}>
        <cylinderGeometry args={[5.5, 5.5, 0.9, 24, 1, true]} />
      </mesh>
      {/* bronze dome with oculus ring */}
      <mesh material={assets.bronzeMat} position={[0, 6.6, 0]}>
        <sphereGeometry args={[5.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
      </mesh>
      <mesh material={assets.bronzeMat} position={[0, 10.4, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[1.05, 0.14, 10, 36]} />
      </mesh>
    </group>
  );
}

function Portico({ assets }: { assets: Assets }) {
  return (
    <group position={[0, 0, -21]}>
      {/* back wall */}
      <mesh material={assets.stoneDimMat} position={[0, 6, -5]}>
        <boxGeometry args={[44, 12, 1.2]} />
      </mesh>
      {/* paired columns flanking the far bay */}
      <Column position={[-4.5, 0, 0]} assets={assets} />
      <Column position={[4.5, 0, 0]} assets={assets} />
      {/* lintel */}
      <mesh material={assets.stoneMat} position={[0, 6.5, 0]}>
        <boxGeometry args={[11.5, 0.9, 2]} />
      </mesh>
      {/* triangular pediment */}
      <mesh material={assets.stoneMat} position={[0, 7.9, 0]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[2.5, 2.5, 12, 3, 1, false, Math.PI / 2]} />
      </mesh>
    </group>
  );
}

function ExchangeCore() {
  const group = useRef<THREE.Group>(null);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    if (group.current) group.current.rotation.y += dt * 0.1;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.02;
    group.current?.scale.setScalar(pulse);
  });

  return (
    <group ref={group} position={[0, 2.3, -4]}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[2.6, 0.02, 6, 160]} />
        <meshBasicMaterial color={TEAL} transparent opacity={0.45} />
      </mesh>
      <mesh rotation={[Math.PI / 2.8, 0.4, 0.2]}>
        <torusGeometry args={[2.0, 0.03, 6, 140]} />
        <meshBasicMaterial color={BRONZE} transparent opacity={0.6} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.62, 1]} />
        <meshStandardMaterial color={TEAL} transparent opacity={0.14} emissive={TEAL} emissiveIntensity={0.6} />
      </mesh>
</group>
  );
}

/* ---------- atmosphere ---------- */

function Dust() {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    let seed = 771;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const positions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      positions[index * 3] = (random() - 0.5) * 44;
      positions[index * 3 + 1] = random() * 11;
      positions[index * 3 + 2] = (random() - 0.5) * 52 - 8;
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return result;
  }, []);

  useFrame((state) => {
    if (points.current) points.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.02) * 0.04;
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial size={0.045} color={DUST} transparent opacity={0.32} sizeAttenuation />
    </points>
  );
}

function Lanterns() {
  return (
    <>
      {STATIONS.slice(1).map((station, index) => (
        <Float key={index} speed={0.4} rotationIntensity={0.06} floatIntensity={0.22}>
          <mesh position={station.look}>
            <octahedronGeometry args={[0.14, 0]} />
            <meshBasicMaterial color={index % 4 === 0 ? TEAL : AMBER} />
          </mesh>
        </Float>
      ))}
    </>
  );
}

function CameraRig({ station }: { station: number }) {
  const { camera } = useThree();
  const firstStation = STATIONS[0] ?? { pos: [0, 1.4, 15] as [number, number, number], look: [0, 2.4, -4] as [number, number, number] };
  const target = useRef(new THREE.Vector3(...firstStation.look));
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };
    const onLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const current = STATIONS[station % STATIONS.length] ?? firstStation;
    const desired = new THREE.Vector3(...current.pos);
    desired.x += pointer.current.x * 1.6;
    desired.y += pointer.current.y * 0.9;
    const damping = 1 - Math.exp(-2.4 * dt);
    camera.position.lerp(desired, damping);
    const desiredTarget = new THREE.Vector3(
      current.look[0] - pointer.current.x * 0.7,
      current.look[1] - pointer.current.y * 0.38,
      current.look[2],
    );
    target.current.lerp(desiredTarget, damping);
    camera.lookAt(target.current);
  });

  return null;
}

export function WorldScene({ station }: { station: number }) {
  const firstStation = STATIONS[0] ?? { pos: [0, 1.4, 15] as [number, number, number] };
  const assets = useHallAssets();
  return (
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }} camera={{ position: firstStation.pos, fov: 50 }}>
      <color attach="background" args={[VOID]} />
      <fogExp2 attach="fog" args={[VOID, 0.024]} />
      <ambientLight intensity={0.3} color="#d9cdb8" />
      <directionalLight position={[10, 20, 6]} intensity={1.15} color="#ffe3bd" />
      <directionalLight position={[-8, 5, 16]} intensity={0.32} color="#9db8c9" />
      <pointLight position={[0, 4, -4]} intensity={26} distance={17} decay={2} color="#ffd9a0" />
      <Environment>
        <Lightformer intensity={1.6} color="#ffe8c8" position={[0, 10, -4]} scale={[10, 10, 1]} rotation-x={Math.PI / 2} />
        <Lightformer intensity={0.9} color="#8fb4c7" position={[-14, 2, 6]} scale={[16, 2, 1]} rotation-y={Math.PI / 2} />
        <Lightformer intensity={0.9} color="#8fb4c7" position={[14, 2, -6]} scale={[16, 2, 1]} rotation-y={-Math.PI / 2} />
      </Environment>

      {/* polished black marble floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -3]}>
        <planeGeometry args={[90, 100]} />
        <MeshReflectorMaterial
          blur={[280, 60]}
          resolution={640}
          mixBlur={1}
          mixStrength={14}
          roughness={0.82}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#10151b"
          metalness={0.5}
          mirror={0.55}
        />
      </mesh>

      <Colonnade side={1} assets={assets} />
      <Colonnade side={-1} assets={assets} />
      <Rotunda assets={assets} />
      <Portico assets={assets} />
      <ExchangeCore />
      <Dust />
      <Lanterns />
      <CameraRig station={station} />
    </Canvas>
  );
}

export default WorldScene;
