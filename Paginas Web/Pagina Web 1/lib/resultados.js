// Resultados por instancia, los mismos de la hoja Resultados de
// Outputs/resumenes/gurobi_resultados.xlsx (notebooks/excel_resultados_trppdh3.py).
//
// El Excel guarda fórmulas sin valores calculados, así que se recalculan aquí desde sus
// mismas fuentes:
//   Outputs/gurobi/<variante>/<instancia>.json   las 4 variantes del modelo (n ≥ 10)
//   Outputs/resumenes/heuristicas_replicas.csv   las réplicas de las 5 heurísticas (y los
//                                                heuristicas_replicas_<k>.csv de cada proceso)
//
// BKS = menor Σ D entre la cota superior de las 4 variantes y el mejor costo (en sus réplicas)
// de cada heurística. GAP sol. entera = (cota superior − BKS) / BKS; en las heurísticas,
// GAP promedio = (costo promedio − BKS) / BKS y GAP mejor costo = (mejor costo − BKS) / BKS.
// Igual que el Excel, solo entran las instancias con corridas de Gurobi.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS, listarSalidas } from './salidas.js';

export const ALGORITMOS = ['dos_fases', 'ils_exacto', 'ils_heuristico', 'its_exacto', 'its_heuristico'];
// Carpetas de Gurobi en Outputs/gurobi y su clave en la página: explicitación (20)-(23) y latencia (24)-(29)
export const VARIANTES = { base: '00', explicitacion: '10', latencia: '01', completo: '11' };
const ARCHIVO_REPLICAS = /^heuristicas_replicas(_\d+)?\.csv$/;

/** Filas de un CSV simple (campos sin saltos de línea; comillas dobles opcionales). */
function leerCSV(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  const campos = (linea) => {
    const salida = [];
    let actual = '';
    let entreComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (entreComillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
        else if (c === '"') entreComillas = false;
        else actual += c;
      } else if (c === '"') entreComillas = true;
      else if (c === ',') { salida.push(actual); actual = ''; }
      else actual += c;
    }
    salida.push(actual);
    return salida;
  };
  const [cabecera, ...resto] = lineas.map(campos);
  return resto.map((valores) => Object.fromEntries(cabecera.map((k, i) => [k, valores[i] ?? ''])));
}

const numero = (v) => (v === '' || v == null ? null : Number(v));
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** {instancia: {algoritmo: {replicas, promedio, mejor, segundos, segundosIteracion}}} */
async function leerReplicas(dir) {
  const carpeta = path.join(dir, 'resumenes');
  let archivos = [];
  try {
    archivos = (await readdir(carpeta)).filter((a) => ARCHIVO_REPLICAS.test(a)).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const vistas = new Set();
  const grupos = new Map();
  for (const archivo of archivos) {
    for (const r of leerCSV(await readFile(path.join(carpeta, archivo), 'utf8'))) {
      // Una réplica repetida entre archivos cuenta una vez, como en el Excel
      const clave = `${r.instancia}|${r.algoritmo}|${r.replica}`;
      if (vistas.has(clave) || !ALGORITMOS.includes(r.algoritmo) || numero(r.costo) == null) continue;
      vistas.add(clave);
      const k = `${r.instancia}|${r.algoritmo}`;
      if (!grupos.has(k)) grupos.set(k, { instancia: r.instancia, algoritmo: r.algoritmo, costos: [], segundos: [], porIteracion: [] });
      const g = grupos.get(k);
      g.costos.push(numero(r.costo));
      if (numero(r.segundos) != null) g.segundos.push(numero(r.segundos));
      if (numero(r.segundos_por_iteracion) != null) g.porIteracion.push(numero(r.segundos_por_iteracion));
    }
  }
  const porInstancia = {};
  for (const g of grupos.values()) {
    (porInstancia[g.instancia] ??= {})[g.algoritmo] = {
      replicas: g.costos.length,
      promedio: media(g.costos),
      mejor: Math.min(...g.costos),
      segundos: media(g.segundos),
      // 2 fases no itera: null (— en el Excel)
      segundosIteracion: media(g.porIteracion),
    };
  }
  return { porInstancia, archivos };
}

/**
 * { generado, fuentes, instancias: [{ nombre, banco, n, id, h, bks, origen, gurobi, heuristicas }] }
 *   gurobi[clave]       { archivo, estado, costo (= cota superior), cota (inferior), gap, gapEntera, segundos, nodos }
 *   heuristicas[clave]  { archivo (mejor réplica), replicas, promedio, mejor, gapPromedio, gapMejor,
 *                         segundos (promedio), segundosIteracion (promedio) }
 */
export async function calcularResultados(salidas = null, dir = OUTPUTS) {
  salidas ??= await listarSalidas(dir);
  const { porInstancia: replicas, archivos } = await leerReplicas(dir);

  const instancias = new Map();
  for (const s of salidas) {
    const clave = VARIANTES[s.archivo.split('/')[1]];
    if (s.algoritmo.clave !== 'gurobi' || !clave || !(s.instancia.n >= 10) || s.objetivo == null) continue;
    if (!instancias.has(s.instancia.nombre)) instancias.set(s.instancia.nombre, { ...s.instancia, gurobi: {}, heuristicas: {} });
    instancias.get(s.instancia.nombre).gurobi[clave] = {
      archivo: s.archivo, estado: s.estado, costo: s.objetivo, cota: s.cota, gap: s.gap, segundos: s.segundos, nodos: s.nodos,
    };
  }
  // Archivo de la mejor réplica de cada heurística, para abrirla desde la tabla
  const archivoHeuristica = new Map(salidas.filter((s) => s.algoritmo.familia === 'erdogan')
    .map((s) => [`${s.instancia.nombre}|${s.algoritmo.clave}`, s.archivo]));

  const filas = [];
  for (const fila of instancias.values()) {
    for (const alg of ALGORITMOS) {
      const r = replicas[fila.nombre]?.[alg];
      if (r) fila.heuristicas[alg] = { archivo: archivoHeuristica.get(`${fila.nombre}|${alg}`) ?? null, ...r };
    }
    const candidatos = [
      ...Object.entries(fila.gurobi).map(([clave, g]) => [`gurobi:${clave}`, g.costo]),
      ...Object.entries(fila.heuristicas).map(([clave, h]) => [clave, h.mejor]),
    ];
    const bks = Math.min(...candidatos.map(([, v]) => v));
    // Mismo criterio del Excel para decidir si un método alcanza el BKS: diferencia relativa ≤ 1E-6
    fila.bks = bks;
    fila.origen = candidatos.filter(([, v]) => Math.abs(v - bks) <= 1e-6 * bks).map(([clave]) => clave);
    for (const g of Object.values(fila.gurobi)) g.gapEntera = (g.costo - bks) / bks;
    for (const h of Object.values(fila.heuristicas)) {
      h.gapPromedio = (h.promedio - bks) / bks;
      h.gapMejor = (h.mejor - bks) / bks;
    }
    filas.push(fila);
  }
  filas.sort((a, b) => a.n - b.n || a.banco.localeCompare(b.banco) || a.id - b.id || a.h - b.h);
  return {
    generado: new Date().toISOString(),
    fuentes: { gurobi: 'Outputs/gurobi/<variante>/<instancia>.json', replicas: archivos.map((a) => `Outputs/resumenes/${a}`) },
    instancias: filas,
  };
}
