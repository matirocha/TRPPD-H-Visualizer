// Servidor del visualizador TRPPD-H3.
//
//   GET /api/salidas           lista de soluciones encontradas en Outputs
//   GET /api/salidas/<archivo> contenido de una solución (p. ej. gurobi/base/vigo_n5_id1_h0.5.json)
//
// Los cambios en Outputs se ven al recargar la página.
// Uso: npm start  (PORT y OUTPUTS_DIR son opcionales)
import express from 'express';
import path from 'node:path';
import { OUTPUTS, RAIZ, VENDOR, listarSalidas, resolverSalida } from './lib/salidas.js';

const PUERTO = Number(process.env.PORT ?? 3001);
const app = express();
app.disable('x-powered-by');

app.get('/api/salidas', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').json({ salidas: await listarSalidas() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/salidas/*archivo', (req, res) => {
  const absoluta = resolverSalida(req.params.archivo.join('/'));
  if (!absoluta) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.set('Cache-Control', 'no-store').sendFile(absoluta, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Archivo no encontrado' });
  });
});

for (const [nombre, carpeta] of Object.entries(VENDOR)) {
  app.use(`/vendor/${nombre}`, express.static(path.join(RAIZ, carpeta), { maxAge: '7d' }));
}
app.use(express.static(path.join(RAIZ, 'public')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

app.listen(PUERTO, () => {
  console.log(`Visualizador TRPPD-H3 (diseño 2) en http://localhost:${PUERTO}`);
  console.log(`Leyendo soluciones de ${OUTPUTS}`);
});
