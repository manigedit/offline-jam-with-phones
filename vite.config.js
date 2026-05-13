import { defineConfig } from 'vite';

export default defineConfig({
  base: "/offline-jam-with-phones/",
  server: { host: true },
  build: { target: 'es2020' }
});
