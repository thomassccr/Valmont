'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ValmontState } from '@valmont/types';
import { CoreDriver } from './state';
import {
  CIRCUIT_FRAGMENT,
  CIRCUIT_VERTEX,
  GEAR_FRAGMENT,
  GLOW_FRAGMENT,
  PARTICLES_FRAGMENT,
  PARTICLES_VERTEX,
  RING_FRAGMENT,
  RING_VERTEX,
} from './shaders';

const PARTICLE_COUNT = 48_000;

/**
 * Distribution des particules.
 *
 * Trois décisions qui font toute la différence visuelle :
 *
 *  1. **Spirale de Fibonacci** pour les directions : une distribution
 *     aléatoire uniforme produit des amas et des trous visibles ; la spirale
 *     donne une couverture parfaitement régulière de la sphère.
 *  2. **Rayon en racine cubique** d'un tirage uniforme : c'est ce qui remplit
 *     réellement le *volume*. Un rayon tiré uniformément concentrerait tout au
 *     centre et le noyau paraîtrait creux en surface.
 *  3. **Cœur dense** : 30% des particules sont resserrées au centre, ce qui
 *     crée le point brûlant d'où tout semble émaner.
 */
function buildParticles(count: number) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const shells = new Float32Array(count);
  const sizes = new Float32Array(count);

  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    // Le tirage « cœur » doit être INDÉPENDANT de `i` : l'indice détermine
    // déjà la latitude sur la spirale de Fibonacci, donc un test du type
    // `i / count < 0.3` ne sélectionnerait pas un cœur central mais une
    // calotte polaire — le noyau paraîtrait mangé d'un côté.
    const isCore = Math.random() < 0.3;

    const y = 1 - (i / (count - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;

    const direction = new THREE.Vector3(
      Math.cos(theta) * ringRadius,
      y,
      Math.sin(theta) * ringRadius,
    );

    // Cube root : remplit le volume au lieu de tasser vers le centre.
    const uniform = Math.random();
    // Cœur resserré, halo externe étalé : deux populations distinctes plutôt
    // qu'un dégradé continu, ce qui creuse visuellement le foyer central.
    const radius = isCore
      ? 0.08 + Math.cbrt(uniform) * 0.34
      : 0.5 + Math.cbrt(uniform) * 0.68;

    positions[i * 3] = direction.x * radius;
    positions[i * 3 + 1] = direction.y * radius;
    positions[i * 3 + 2] = direction.z * radius;

    seeds[i] = Math.random();
    shells[i] = THREE.MathUtils.clamp((radius - 0.08) / 1.1, 0, 1);
    // Les particules du cœur sont plus petites et plus nombreuses : c'est ce
    // qui donne la densité lumineuse au centre plutôt que de gros points.
    sizes[i] = isCore ? 0.7 + Math.random() * 0.6 : 0.75 + Math.random() * 1.4;
  }

  return { positions, seeds, shells, sizes };
}

interface CoreProps {
  driver: CoreDriver;
}

function Particles({ driver }: CoreProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const { size, viewport } = useThree();

  const geometry = useMemo(() => {
    const { positions, seeds, shells, sizes } = buildParticles(PARTICLE_COUNT);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aShell', new THREE.BufferAttribute(shells, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEnergy: { value: 0.4 },
      uTurbulence: { value: 0.3 },
      uConvergence: { value: 0.2 },
      uPulse: { value: 0 },
      uBreathing: { value: 1 },
      uPixelRatio: { value: 1 },
    }),
    [],
  );

  useFrame((_, delta) => {
    const profile = driver.read();
    const u = uniforms;
    u.uTime.value += delta;
    u.uEnergy.value = profile.energy;
    u.uTurbulence.value = profile.turbulence;
    u.uConvergence.value = profile.convergence;
    u.uPulse.value = profile.pulse;
    u.uBreathing.value = profile.breathing;
    u.uPixelRatio.value = Math.min(viewport.dpr ?? 1, 2);

    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.06 * (0.2 + profile.spin);
      pointsRef.current.rotation.x += delta * 0.015 * profile.spin;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={PARTICLES_VERTEX}
        fragmentShader={PARTICLES_FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Un anneau gradué. L'inclinaison et la vitesse varient d'un anneau à l'autre. */
function Ring({
  driver,
  radius,
  tube,
  tilt,
  speed,
  segments,
  opacity,
  tint = 0,
}: CoreProps & {
  radius: number;
  tube: number;
  tilt: [number, number, number];
  speed: number;
  segments: number;
  opacity: number;
  tint?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: Math.random() * 100 },
      uEnergy: { value: 0.4 },
      uMachinery: { value: 0.3 },
      uSegments: { value: segments },
      uOpacity: { value: opacity },
      uTint: { value: tint },
    }),
    [segments, opacity, tint],
  );

  useFrame((_, delta) => {
    const profile = driver.read();
    uniforms.uTime.value += delta;
    uniforms.uEnergy.value = profile.energy;
    uniforms.uMachinery.value = profile.machinery;

    if (ref.current) {
      // Rotation propre à chaque anneau, dans son plan incliné : c'est le
      // déphasage entre les anneaux qui produit la complexité mécanique.
      ref.current.rotation.z += delta * speed * (0.15 + profile.machinery * 1.5);
    }
  });

  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, tube, 8, 220]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={RING_VERTEX}
        fragmentShader={RING_FRAGMENT}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/** Couronne dentée, dessinée par shader sur un simple disque. */
function Gear({
  driver,
  radius,
  tilt,
  teeth,
  direction,
  opacity,
}: CoreProps & {
  radius: number;
  tilt: [number, number, number];
  teeth: number;
  direction: number;
  opacity: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: Math.random() * 50 },
      uEnergy: { value: 0.4 },
      uMachinery: { value: 0.3 },
      uTeeth: { value: teeth },
      uOpacity: { value: opacity },
    }),
    [teeth, opacity],
  );

  useFrame((_, delta) => {
    const profile = driver.read();
    uniforms.uTime.value += delta * direction;
    uniforms.uEnergy.value = profile.energy;
    uniforms.uMachinery.value = profile.machinery;
    if (ref.current) {
      ref.current.rotation.z += delta * direction * 0.12 * (0.1 + profile.machinery);
    }
  });

  return (
    <mesh ref={ref} rotation={tilt}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={RING_VERTEX}
        fragmentShader={GEAR_FRAGMENT}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/** Coque de circuits — visible surtout sur la silhouette. */
function Circuits({ driver, radius, opacity }: CoreProps & { radius: number; opacity: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEnergy: { value: 0.4 },
      uCircuitry: { value: 0.3 },
      uOpacity: { value: opacity },
    }),
    [opacity],
  );

  useFrame((_, delta) => {
    const profile = driver.read();
    uniforms.uTime.value += delta;
    uniforms.uEnergy.value = profile.energy;
    uniforms.uCircuitry.value = profile.circuitry;
    if (ref.current) ref.current.rotation.y -= delta * 0.05 * (0.2 + profile.spin);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[radius, 96, 96]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={CIRCUIT_VERTEX}
        fragmentShader={CIRCUIT_FRAGMENT}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function Glow({ driver }: CoreProps) {
  const uniforms = useMemo(() => ({ uEnergy: { value: 0.4 }, uPulse: { value: 0 } }), []);

  useFrame((_, delta) => {
    const profile = driver.read();
    uniforms.uEnergy.value = profile.energy;
    uniforms.uPulse.value = profile.pulse;
  });

  return (
    <mesh>
      <sphereGeometry args={[1.9, 48, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={CIRCUIT_VERTEX}
        fragmentShader={GLOW_FRAGMENT}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/** Dérive lente de la caméra — le noyau n'est jamais tout à fait immobile. */
function CameraDrift({ driver }: CoreProps) {
  const { camera } = useThree();
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    const profile = driver.read();
    elapsed.current += delta;
    const t = elapsed.current;
    camera.position.x = Math.sin(t * 0.06) * 0.5;
    camera.position.y = Math.sin(t * 0.045) * 0.28;
    // En réflexion, la caméra se rapproche légèrement : on entre dans la machine.
    camera.position.z = 4.6 - profile.energy * 0.5;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/**
 * Unique avanceur de l'animation. Priorité -1 : R3F l'exécute avant tous les
 * autres `useFrame`, si bien que la scène entière lit un profil déjà à jour
 * pour l'image en cours.
 */
function Driver({ driver }: CoreProps) {
  useFrame((_, delta) => {
    driver.update(delta);
  }, -1);
  return null;
}

function Scene({ driver }: CoreProps) {
  return (
    <>
      <Driver driver={driver} />
      <CameraDrift driver={driver} />
      <Glow driver={driver} />
      <Circuits driver={driver} radius={1.65} opacity={0.85} />
      <Particles driver={driver} />

      {/* Trois anneaux gradués, inclinaisons et vitesses volontairement
          non harmoniques : des rapports simples donneraient un motif qui se
          répète, et l'œil décroche dès qu'il perçoit la boucle. */}
      <Ring driver={driver} radius={1.35} tube={0.012} tilt={[1.35, 0.2, 0]} speed={0.5} segments={140} opacity={0.85} />
      <Ring driver={driver} radius={1.62} tube={0.008} tilt={[-0.7, 0.9, 0.4]} speed={-0.31} segments={96} opacity={0.6} />
      <Ring driver={driver} radius={1.95} tube={0.006} tilt={[0.25, -1.1, 1.2]} speed={0.19} segments={220} opacity={0.42} tint={1} />

      {/* Engrenages : deux couronnes contrarotatives. */}
      <Gear driver={driver} radius={1.15} tilt={[0.1, 0.3, 0]} teeth={48} direction={1} opacity={0.5} />
      <Gear driver={driver} radius={0.85} tilt={[1.4, 0.1, 0.6]} teeth={32} direction={-1} opacity={0.38} />
    </>
  );
}

export interface HoloCoreProps {
  state: ValmontState;
  /** Niveau audio 0-1 : la voix qui sort ou la voix qui entre. */
  audioLevel?: number;
  className?: string;
}

export function HoloCore({ state, audioLevel = 0, className }: HoloCoreProps) {
  const driver = useMemo(() => new CoreDriver(), []);

  useEffect(() => {
    driver.setState(state);
  }, [driver, state]);

  useEffect(() => {
    driver.setAudioLevel(audioLevel);
  }, [driver, audioLevel]);

  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 4.6], fov: 42 }}
        dpr={[1, 2]}
        gl={{
          antialias: false, // le bloom masque l'aliasing et coûte moins cher
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
      >
        <Scene driver={driver} />

        <EffectComposer multisampling={0}>
          {/* Bloom : c'est lui qui transforme des points additifs en matière
              lumineuse. Seuil bas pour que même le cœur sombre diffuse. */}
          <Bloom
            intensity={1.35}
            luminanceThreshold={0.12}
            luminanceSmoothing={0.85}
            kernelSize={KernelSize.LARGE}
            mipmapBlur
          />
          {/* Aberration très légère : suggère une optique réelle. Au-delà de
              1‰ de l'écran, ça devient un effet « gamer ». */}
          <ChromaticAberration
            offset={[0.00018, 0.00026]}
            radialModulation={false}
            modulationOffset={0}
          />
          <Vignette eskil={false} offset={0.22} darkness={0.85} blendFunction={BlendFunction.NORMAL} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
