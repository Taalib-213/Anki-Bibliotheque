import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tout ce qui est dans /public est servi à la racine du site
// (en local avec `npm run dev` ET en production sur Netlify).
// C'est pour ça que `data/` et `anki/` sont placés dans `/public`.
export default defineConfig({
  plugins: [react()],
  publicDir: 'public'
})
