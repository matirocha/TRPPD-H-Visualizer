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

// Banco de pruebas de la instancia, según el sufijo del nombre: _Erdogan (Erdoğan et al.,
// 2012) o, sin sufijo o con _Battarra, el de Battarra et al. (2010).
export const bancoDe = (nombre) => (/_Erdogan$/.test(nombre) ? 'Erdogan' : 'Battarra');

function resumir(archivo, d) {
  const a = d.algoritmo ?? {};
  const i = d.instancia ?? {};
  const s = d.solucion ?? {};
  const clave = a.clave ?? archivo.split('/')[0];
  const p = a.parametros ?? {};
  // Variante del modelo de Gurobi: con o sin (20)-(23) y (24)-(29); null en otros algoritmos.
  const variante = typeof p.explicitacion === 'boolean' && typeof p.latencia === 'boolean'
    ? { explicitacion: p.explicitacion, latencia: p.latencia }
    : null;
  const nombre = i.nombre ?? path.basename(archivo, '.json');
  // GAP sol. entera de notebooks/lote_trppdh3.py: (Σ D − relajación lineal) / Σ D. Las heurísticas
  // lo traen calculado con la mayor relajación de las variantes de Gurobi.
  const gapEntera = s.gap_entera
    ?? (s.objetivo && s.relajacion_lineal != null ? (s.objetivo - s.relajacion_lineal) / s.objetivo : null);
  return {
    archivo,
    // familia: 'erdogan' en las heurísticas de Erdoğan et al. (2012) adaptadas
    algoritmo: { clave, nombre: a.nombre ?? clave, variante, familia: p.familia ?? null },
    instancia: { nombre, n: i.n, id: i.id ?? null, h: i.h ?? null, banco: bancoDe(nombre) },
    objetivo: s.objetivo ?? null,
    estado: s.estado ?? null,
    // Brecha final y cota inferior: con límite de tiempo comparan mejor que los segundos
    gap: s.gap ?? null,
    gapEntera,
    cota: s.cota ?? null,
    // Tiempos de ejecución, para comparar variantes sin abrir cada archivo
    segundos: s.segundos ?? null,
    segundosTotal: s.segundos_total ?? null,
    nodos: s.nodos ?? null,
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
  // Desviación respecto de la mejor solución conocida de la instancia (cualquier algoritmo),
  // como la columna Dev. (%) de Erdoğan et al. (2012)
  const mejor = new Map();
  for (const s of salidas) {
    if (s.objetivo != null) mejor.set(s.instancia.nombre, Math.min(mejor.get(s.instancia.nombre) ?? Infinity, s.objetivo));
  }
  for (const s of salidas) {
    const m = mejor.get(s.instancia.nombre);
    s.desviacion = s.objetivo != null && m > 0 ? (s.objetivo - m) / m : null;
  }
  return salidas.sort((x, y) =>
    x.algoritmo.clave.localeCompare(y.algoritmo.clave)
    || x.instancia.banco.localeCompare(y.instancia.banco)
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
