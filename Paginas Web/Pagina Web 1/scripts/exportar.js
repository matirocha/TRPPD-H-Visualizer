// Copia la página, sus dependencias y las soluciones de Outputs en dist/, para
// publicarla en cualquier hosting estático (GitHub Pages, Netlify, etc.).
// La página busca primero /api/salidas y, si no existe, datos/manifest.json (y lo mismo con
// /api/resultados y datos/resultados.json).
//
// Uso: npm run exportar [-- carpeta_destino]
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS, RAIZ, VENDOR, listarSalidas, resolverSalida } from '../lib/salidas.js';
import { calcularResultados } from '../lib/resultados.js';

const destino = path.resolve(process.argv[2] ?? path.join(RAIZ, 'dist'));

// Sin soluciones la página publicada quedaría vacía: mejor que el build falle.
const salidas = await listarSalidas();
if (!salidas.length) {
  console.error(`No se encontraron soluciones en ${OUTPUTS}.`);
  console.error('En Vercel, activa "Include files outside the root directory in the Build Step" '
    + '(Settings → Build and Deployment → Root Directory), o define OUTPUTS_DIR.');
  process.exit(1);
}

await rm(destino, { recursive: true, force: true });
await cp(path.join(RAIZ, 'public'), destino, { recursive: true });
for (const [nombre, carpeta] of Object.entries(VENDOR)) {
  await cp(path.join(RAIZ, carpeta), path.join(destino, 'vendor', nombre), {
    recursive: true,
    filter: (origen) => !/\.(map|ts|scss|md)$/.test(origen),
  });
}

await mkdir(path.join(destino, 'datos'), { recursive: true });
for (const { archivo } of salidas) {
  const salida = path.join(destino, 'datos', archivo);
  await mkdir(path.dirname(salida), { recursive: true });
  await cp(resolverSalida(archivo), salida);
}
await writeFile(path.join(destino, 'datos', 'manifest.json'), JSON.stringify({ salidas }, null, 2));
// Resultados del Excel de resúmenes: si no se pueden leer, la página igual se publica y la tabla
// de Rendimiento explica qué falta
let resultados = null;
try {
  resultados = await calcularResultados(salidas);
  await writeFile(path.join(destino, 'datos', 'resultados.json'), JSON.stringify(resultados));
} catch (error) {
  console.warn(`Aviso: sin datos/resultados.json. ${error.message}`);
}

console.log(`${salidas.length} soluciones de ${OUTPUTS} exportadas a ${destino}`);
if (resultados) {
  console.log(`Resultados de ${resultados.instancias.length} instancias (${resultados.fuente.excel}, ${resultados.fuente.modo}) en datos/resultados.json`);
}
