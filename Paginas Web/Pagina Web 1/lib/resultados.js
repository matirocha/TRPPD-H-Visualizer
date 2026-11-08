// Resultados por instancia leídos de Outputs/resumenes/gurobi_resultados.xlsx (el Excel que arma
// notebooks/excel_resultados_trppdh3.py), hoja Resultados, más el estado de cada corrida de Gurobi
// (hoja Detalle).
//
// Si el libro trae guardados los valores de sus fórmulas (se abrió y se guardó en Excel), se usan
// tal cual. Si no (el script lo escribe con openpyxl, que deja las fórmulas sin resultado), se
// calculan con las mismas fórmulas del Excel desde los datos de sus propias hojas:
//   BKS              = MIN(cota superior de las 4 variantes, mejor costo de las 5 heurísticas)
//   GAP sol. entera  = (cota superior − BKS) / BKS
//   Costo Promedio, Mejor Costo, Tiempo Promedio (s) y Tiempo Promedio Iteraciones (s) = promedio,
//                      mínimo y promedios de las réplicas (hoja Heurísticas y metaheurísticas)
//   GAP Promedio / GAP Mejor Costo = (costo − BKS) / BKS
// Las columnas se ubican por sus encabezados (filas 1 y 2), no por su letra.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS, listarSalidas } from './salidas.js';
import { leerLibro } from './xlsx.js';

export const ARCHIVO_EXCEL = path.join('resumenes', 'gurobi_resultados.xlsx');
export const ALGORITMOS = ['dos_fases', 'ils_exacto', 'ils_heuristico', 'its_exacto', 'its_heuristico'];
// Carpeta de Gurobi (columna Variante de Detalle) y clave de la página: explicitación (20)-(23) y latencia (24)-(29)
export const VARIANTES = { base: '00', explicitacion: '10', latencia: '01', completo: '11' };
const HOJA_REPLICAS = 'Heurísticas y metaheurísticas';
const TOL = 1e-6; // mismo criterio del Excel para decidir si un costo alcanza la BKS

// Títulos de bloque de la hoja Resultados (sin tildes, espacios ni guiones) → clave
const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s\-–—]+/g, '');
const BLOQUE_VARIANTE = { '(1)(19)': '00', '(1)(19)+(20)(23)': '10', '(1)(19)+(24)(29)': '01', '(1)(29)': '11' };
const BLOQUE_HEURISTICA = {
  heuristica2fases: 'dos_fases', '2fases': 'dos_fases', ilsexacto: 'ils_exacto', ilsheuristico: 'ils_heuristico',
  itsexacto: 'its_exacto', itsheuristico: 'its_heuristico',
};
// Nombres del Origen BKS y de la columna Algoritmo de la hoja de réplicas → clave
const NOMBRE_METODO = {
  ...Object.fromEntries(Object.entries(BLOQUE_VARIANTE).map(([k, v]) => [`gurobi${k}`, `gurobi:${v}`])),
  ...BLOQUE_HEURISTICA,
};

const numero = (c) => (typeof c?.valor === 'number' && Number.isFinite(c.valor) ? c.valor : null);
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Columnas de una hoja con encabezados en una fila y, opcional, títulos de bloque en la anterior. */
function columnas(filas, filaEncabezado, filaBloque = null) {
  const encabezados = filas.get(filaEncabezado) ?? [];
  const bloques = filaBloque ? filas.get(filaBloque) ?? [] : [];
  const lista = [];
  let bloque = null;
  for (let c = 1; c < Math.max(encabezados.length, bloques.length); c++) {
    if (bloques[c]?.valor != null && bloques[c].valor !== '') bloque = String(bloques[c].valor);
    if (encabezados[c]?.valor != null) lista.push({ c, bloque, encabezado: String(encabezados[c].valor) });
  }
  return lista;
}

/** Número de columna por encabezado (y bloque); null si no está. */
function buscador(lista) {
  return (encabezado, bloque) => lista.find((x) => normal(x.encabezado) === normal(encabezado)
    && (bloque === undefined || normal(x.bloque) === normal(bloque)))?.c ?? null;
}

let cache = null;

/** Lee y resume el Excel; se vuelve a leer solo si el archivo cambió. */
async function leerExcel(ruta) {
  const info = await stat(ruta);
  const firma = `${info.mtimeMs}|${info.size}`;
  if (cache?.ruta === ruta && cache.firma === firma) return cache.datos;
  const buf = await readFile(ruta);
  const { Resultados: res, Detalle: det, Definiciones: defs } = leerLibro(buf, ['Resultados', 'Detalle', 'Definiciones']);
  if (!res) throw new Error(`${path.basename(ruta)} no tiene la hoja Resultados`);

  // --- Hoja Resultados: bloques en la fila 1, encabezados en la 2, datos desde la 3 -----------
  const col = columnas(res, 2, 1);
  const buscar = buscador(col);
  const cInstancia = buscar('Instancia');
  if (!cInstancia) throw new Error('la hoja Resultados no tiene la columna Instancia');
  const cGurobi = {};
  const cHeur = {};
  for (const { bloque } of col) {
    const v = BLOQUE_VARIANTE[normal(bloque)];
    const h = BLOQUE_HEURISTICA[normal(bloque)];
    if (v && !cGurobi[v]) {
      cGurobi[v] = Object.fromEntries(Object.entries({
        costo: 'Costo', cota: 'Cota inferior', cotaSuperior: 'Cota superior', gap: 'GAP', gapEntera: 'GAP sol. entera', segundos: 'Tiempo (s)', nodos: 'Nodos',
      }).map(([k, e]) => [k, buscar(e, bloque)]));
    }
    if (h && !cHeur[h]) {
      cHeur[h] = Object.fromEntries(Object.entries({
        promedio: 'Costo Promedio', mejor: 'Mejor Costo', gapPromedio: 'GAP Promedio', gapMejor: 'GAP Mejor Costo',
        segundos: 'Tiempo Promedio (s)', segundosIteracion: 'Tiempo Promedio Iteraciones (s)',
      }).map(([k, e]) => [k, buscar(e, bloque)]));
    }
  }
  const cBks = buscar('BKS');
  const cOrigen = buscar('Origen BKS');

  // Estado de cada corrida (Detalle: una fila por instancia × variante)
  const estados = new Map();
  if (det) {
    const b = buscador(columnas(det, 1));
    const [ci, cv, ce] = [b('Instancia'), b('Variante'), b('Estado')];
    for (const [r, fila] of det) {
      if (r < 2 || !fila[ci]?.valor) continue;
      estados.set(`${fila[ci].valor}|${VARIANTES[fila[cv]?.valor] ?? ''}`, fila[ce]?.valor ?? null);
    }
  }
  // Réplicas por heurística, de la hoja Definiciones («… × 10 réplicas»)
  let replicas = null;
  for (const fila of defs?.values() ?? []) {
    const m = String(fila[2]?.valor ?? '').match(/×\s*(\d+)\s*réplicas/);
    if (m) { replicas = Number(m[1]); break; }
  }

  const filas = [];
  for (const [r, fila] of res) {
    if (r < 3 || !fila[cInstancia]?.valor) continue;
    const celda = (c) => (c ? fila[c] : undefined);
    const nombre = String(fila[cInstancia].valor);
    const f = {
      nombre,
      banco: celda(buscar('Banco'))?.valor ?? (nombre.endsWith('_Erdogan') ? 'Erdogan' : 'Battarra'),
      n: numero(celda(buscar('N'))), id: numero(celda(buscar('ID'))), h: numero(celda(buscar('h'))),
      bks: numero(celda(cBks)), origenTexto: celda(cOrigen)?.valor ?? null, gurobi: {}, heuristicas: {},
    };
    for (const [clave, c] of Object.entries(cGurobi)) {
      const costo = numero(celda(c.cotaSuperior)) ?? numero(celda(c.costo));
      if (costo == null) continue;
      f.gurobi[clave] = {
        estado: estados.get(`${nombre}|${clave}`) ?? null, costo, cota: numero(celda(c.cota)), gap: numero(celda(c.gap)),
        gapEntera: numero(celda(c.gapEntera)), segundos: numero(celda(c.segundos)), nodos: numero(celda(c.nodos)),
      };
    }
    for (const [clave, c] of Object.entries(cHeur)) {
      f.heuristicas[clave] = Object.fromEntries(Object.entries(c).map(([k, cc]) => [k, numero(celda(cc))]));
    }
    filas.push(f);
  }

  // ¿Trae el libro los valores de sus fórmulas? Basta con que falte el BKS en una fila para recalcular
  const conValores = filas.length > 0 && filas.every((f) => f.bks != null);
  if (!conValores) await recalcular(buf, filas);
  for (const f of filas) {
    f.origen = conValores && f.origenTexto != null
      ? String(f.origenTexto).split(',').map((s) => NOMBRE_METODO[normal(s)]).filter(Boolean)
      : [...Object.entries(f.gurobi).filter(([, g]) => Math.abs(g.costo - f.bks) <= TOL * f.bks).map(([k]) => `gurobi:${k}`),
        ...Object.entries(f.heuristicas).filter(([, h]) => h.mejor != null && Math.abs(h.mejor - f.bks) <= TOL * f.bks).map(([k]) => k)];
    delete f.origenTexto;
    for (const [clave, h] of Object.entries(f.heuristicas)) {
      if (h.promedio == null && h.mejor == null) delete f.heuristicas[clave];
      else h.replicas ??= replicas;
    }
  }
  const datos = { modo: conValores ? 'valores' : 'formulas', replicas, filas };
  cache = { ruta, firma, datos };
  return datos;
}

/** Fórmulas del Excel, calculadas desde los datos de sus hojas (para un libro sin valores guardados). */
async function recalcular(buf, filas) {
  const hoja = leerLibro(buf, [HOJA_REPLICAS])[HOJA_REPLICAS];
  const grupos = new Map();
  if (hoja) {
    const b = buscador(columnas(hoja, 1));
    const [ci, ca, cc, ct, cp] = [b('Instancia'), b('Algoritmo'), b('Costo'), b('Tiempo (s)'), b('Tiempo por iteración (s)')];
    for (const [r, fila] of hoja) {
      const costo = numero(fila[cc]);
      const alg = BLOQUE_HEURISTICA[normal(fila[ca]?.valor)];
      if (r < 2 || costo == null || !alg) continue;
      const k = `${fila[ci]?.valor}|${alg}`;
      if (!grupos.has(k)) grupos.set(k, { costos: [], segundos: [], porIteracion: [] });
      const g = grupos.get(k);
      g.costos.push(costo);
      if (numero(fila[ct]) != null) g.segundos.push(numero(fila[ct]));
      if (numero(fila[cp]) != null) g.porIteracion.push(numero(fila[cp]));
    }
  }
  for (const f of filas) {
    f.heuristicas = {};
    for (const alg of ALGORITMOS) {
      const g = grupos.get(`${f.nombre}|${alg}`);
      if (g) {
        f.heuristicas[alg] = {
          replicas: g.costos.length, promedio: media(g.costos), mejor: Math.min(...g.costos),
          segundos: media(g.segundos), segundosIteracion: media(g.porIteracion),
        };
      }
    }
    const candidatos = [...Object.values(f.gurobi).map((g) => g.costo), ...Object.values(f.heuristicas).map((h) => h.mejor)];
    f.bks = candidatos.length ? Math.min(...candidatos) : null;
    if (f.bks == null) continue;
    for (const g of Object.values(f.gurobi)) g.gapEntera = (g.costo - f.bks) / f.bks;
    for (const h of Object.values(f.heuristicas)) {
      h.gapPromedio = (h.promedio - f.bks) / f.bks;
      h.gapMejor = (h.mejor - f.bks) / f.bks;
    }
  }
}

/**
 * { generado, fuente: {excel, modo: 'valores' | 'formulas'}, instancias: [{ nombre, banco, n, id, h, bks, origen, gurobi, heuristicas }] }
 *   gurobi[clave]       { archivo, estado, costo (= cota superior), cota (inferior), gap, gapEntera, segundos, nodos }
 *   heuristicas[clave]  { archivo (mejor réplica), replicas, promedio, mejor, gapPromedio, gapMejor,
 *                         segundos (promedio), segundosIteracion (promedio) }
 * salidas (opcional): el manifest, para enlazar cada fila con su solución en Outputs.
 */
export async function calcularResultados(salidas = null, dir = OUTPUTS) {
  const ruta = path.join(dir, ARCHIVO_EXCEL);
  let datos;
  try {
    datos = await leerExcel(ruta);
  } catch (error) {
    throw new Error(error.code === 'ENOENT'
      ? `No está ${path.join('Outputs', ARCHIVO_EXCEL)}: genéralo con python notebooks/excel_resultados_trppdh3.py`
      : error.code === 'EBUSY' || error.code === 'EPERM'
        ? `No se pudo abrir ${path.join('Outputs', ARCHIVO_EXCEL)} (${error.code}): ciérralo en Excel y recarga`
        : `No se pudo leer ${path.join('Outputs', ARCHIVO_EXCEL)}: ${error.message}`);
  }
  salidas ??= await listarSalidas(dir);
  const archivos = new Map(salidas.map((s) => [
    s.algoritmo.familia === 'erdogan' ? `${s.instancia.nombre}|${s.algoritmo.clave}` : `${s.instancia.nombre}|gurobi:${VARIANTES[s.archivo.split('/')[1]]}`,
    s.archivo,
  ]));
  const instancias = datos.filas.map((f) => ({
    ...f,
    gurobi: Object.fromEntries(Object.entries(f.gurobi).map(([k, g]) => [k, { archivo: archivos.get(`${f.nombre}|gurobi:${k}`) ?? null, ...g }])),
    heuristicas: Object.fromEntries(Object.entries(f.heuristicas).map(([k, h]) => [k, { archivo: archivos.get(`${f.nombre}|${k}`) ?? null, ...h }])),
  })).sort((a, b) => a.n - b.n || a.banco.localeCompare(b.banco) || a.id - b.id || a.h - b.h);
  return {
    generado: new Date().toISOString(),
    fuente: { excel: `Outputs/${ARCHIVO_EXCEL.split(path.sep).join('/')}`, modo: datos.modo },
    instancias,
  };
}
