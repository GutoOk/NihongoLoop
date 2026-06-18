import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'path';
import {defineConfig} from 'vite';

function gitValue(command: string, fallback: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const commitHash = gitValue('git rev-parse --short HEAD', 'dev');
const commitDate = gitValue('git log -1 --format=%cI', new Date().toISOString());
const commitCount = gitValue('git rev-list --count HEAD', '0');
const appVersion = `${commitCount}-${commitHash}`;

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __BUILD_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || appVersion),
      __APP_VERSION_INFO__: JSON.stringify({
        version: process.env.VITE_APP_VERSION || appVersion,
        commit: commitHash,
        commitDate,
        commitCount,
      }),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/lucide-react')) return 'icons';
            if (id.includes('node_modules/react')) return 'vendor';
            if (id.includes('node_modules/react-dom')) return 'vendor';
          },
        }
      }
    }
  };
});
