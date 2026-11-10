import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O SDK vem do workspace em desenvolvimento; nos projetos do v0, do npm.
  transpilePackages: ['@adaflow/sdk'],
};

export default nextConfig;
