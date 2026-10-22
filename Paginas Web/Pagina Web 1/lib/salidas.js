// Lectura de la carpeta Outputs, compartida por el servidor y la exportación estática.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUTS = path.resolve(process.env.OUTPUTS_DIR ?? path.join(RAIZ, '..', '..', 'Outputs'));
export const PREFIJO_FORMATO = 'trppdh3-salida/';

// Archivos de node_modules que la página usa directamente, sin empaquetador.
export const VENDOR = {
  gsap: 'node_modules/gsap/dist',
  d3: 'node_modules/d3/dist',
  katex: 'node_modules/katex/dist',
  fraunces: 'node_modules/@fontsource-variable/fraunces',
  inter: 'node_modules/@fontsource-variable/inter',
  'plex-mono': 'node_modules/@fontsource/ibm-plex-mono',
};

async function* recorrer(dir) {
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* recorrer(ruta);
    else if (entrada.name.endsWith('.json')) yield ruta;
  }
}

function resumir(archivo, d) {
  const a = d.algoritmo ?? {};
  const i = d.instancia ?? {};
  const s = d.solucion ?? {};
  const clave = a.clave ?? archivo.split('/')[0];
  return {
    archivo,
    algoritmo: { clave, nombre: a.nombre ?? clave },
    instancia: { nombre: i.nombre ?? path.basename(archivo, '.json'), n: i.n, id: i.id ?? null, h: i.h ?? null },
    objetivo: s.objetivo ?? null,
    estado: s.estado ?? null,
    generado: d.generado ?? null,
  };
}

/** Resumen de cada JSON con formato trppdh3-salida/* dentro de dir (recursivo). */
export async function listarSalidas(dir = OUTPUTS) {
  const salidas = [];
  try {
    for await (const absoluta of recorrer(dir)) {
      try {
        const datos = JSON.parse(await readFile(absoluta, 'utf8'));
        if (!String(datos.formato ?? '').startsWith(PREFIJO_FORMATO)) continue;
        salidas.push(resumir(path.relative(dir, absoluta).split(path.sep).join('/'), datos));
      } catch {
        // JSON a medio escribir o ajeno al visualizador: se ignora
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return salidas.sort((x, y) =>
    x.algoritmo.clave.localeCompare(y.algoritmo.clave)
    || (x.instancia.n ?? 0) - (y.instancia.n ?? 0)
    || (x.instancia.id ?? 0) - (y.instancia.id ?? 0)
    || (x.instancia.h ?? 0) - (y.instancia.h ?? 0)
    || x.archivo.localeCompare(y.archivo));
}

/** Ruta absoluta de un archivo de dir, o null si sale de la carpeta o no es JSON. */
export function resolverSalida(relativa, dir = OUTPUTS) {
  const absoluta = path.resolve(dir, relativa);
  if (!absoluta.startsWith(dir + path.sep) || !absoluta.endsWith('.json')) return null;
  return absoluta;
}
