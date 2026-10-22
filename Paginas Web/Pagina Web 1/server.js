// Servidor del visualizador TRPPD-H3.
//
//   GET /api/salidas           lista de soluciones encontradas en Outputs
//   GET /api/salidas/<archivo> contenido de una solución (p. ej. gurobi/vigo_n5_id1_h0.5.json)
//   GET /api/eventos           Server-Sent Events: avisa cuando cambia Outputs
//
// Uso: npm start  (PORT y OUTPUTS_DIR son opcionales)
import express from 'express';
import { watch } from 'node:fs';
import path from 'node:path';
import { OUTPUTS, RAIZ, VENDOR, listarSalidas, resolverSalida } from './lib/salidas.js';

const PUERTO = Number(process.env.PORT ?? 3000);
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

const clientes = new Set();
app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clientes.add(res);
  const latido = setInterval(() => res.write(': latido\n\n'), 25000);
  req.on('close', () => {
    clearInterval(latido);
    clientes.delete(res);
  });
});

function emitir(evento, datos) {
  const mensaje = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const res of clientes) res.write(mensaje);
}

// Un algoritmo escribe varios archivos seguidos: se agrupan los avisos.
let pendiente = null;
const cambiados = new Set();
try {
  watch(OUTPUTS, { recursive: true }, (_tipo, archivo) => {
    if (!archivo?.endsWith('.json')) return;
    cambiados.add(archivo.split(path.sep).join('/'));
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      emitir('cambio', { archivos: [...cambiados] });
      cambiados.clear();
    }, 400);
  });
} catch (error) {
  console.warn(`No se pudo vigilar ${OUTPUTS}: ${error.message}`);
}

for (const [nombre, carpeta] of Object.entries(VENDOR)) {
  app.use(`/vendor/${nombre}`, express.static(path.join(RAIZ, carpeta), { maxAge: '7d' }));
}
app.use(express.static(path.join(RAIZ, 'public')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

app.listen(PUERTO, () => {
  console.log(`Visualizador TRPPD-H3 en http://localhost:${PUERTO}`);
  console.log(`Leyendo soluciones de ${OUTPUTS}`);
});
