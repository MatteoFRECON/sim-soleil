import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Outil de développement uniquement : la page peut envoyer une capture de la scène
 * (POST /__shot?name=x, corps = data URL JPEG) -> enregistrée dans .shots/x.jpg.
 * Sert à vérifier les modes de vue sans écran. Absent du build de production.
 */
function shotPlugin(): Plugin {
  return {
    name: 'sim-soleil-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = resolve(__dirname, '.shots');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.jpg`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

// Port fixe pour l'aperçu ; base relative pour ouvrir dist/ n'importe où.
export default defineConfig({
  base: './',
  server: { port: 5199, strictPort: true },
  plugins: [shotPlugin()],
});
