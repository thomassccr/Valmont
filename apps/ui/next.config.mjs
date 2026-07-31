/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les paquets de l'atelier sont livrés en TypeScript source : Next les
  // transpile lui-même, ce qui évite une étape de build entre chaque
  // modification d'un type partagé.
  transpilePackages: ['@valmont/types'],
  experimental: {
    optimizePackageImports: ['three', '@react-three/drei'],
  },
};

export default nextConfig;
