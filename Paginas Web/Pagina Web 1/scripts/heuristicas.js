// Corre las heurísticas de Erdoğan et al. (2012) adaptadas al TRPPD-H3 (lib/heuristicas.js)
// sobre las instancias de Instancias/ y guarda cada solución en
// Outputs/erdogan/<algoritmo>/<instancia>.json, más un resumen en
// Outputs/resumenes/heuristicas_erdogan.csv.
//
// Las medidas siguen las definiciones de notebooks/lote_trppdh3.py, con las referencias
// de las cuatro variantes de Gurobi de la misma instancia:
//   GAP              (Σ D − mejor cota inferior) / Σ D
//   GAP sol. entera  (Σ D − mayor relajación lineal) / Σ D
//   desviación       (Σ D − mejor Σ D de Gurobi) / mejor Σ D de Gurobi
//
// Uso: npm run heuristicas -- <n> [--alg a,b] [--iter 200] [--banco B|E] [--id 1-5] [--sin-resumen]
//   <n> e --id: 10 · 10,15 · 10-25 · all
//   --sin-resumen  no reescribe el CSV (para correr varios procesos en paralelo)
//   npm run heuristicas -- --resumen   solo reescribe el CSV con lo que hay en Outputs/erdogan
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALGORITMOS, resolver, semillaDe } from '../lib/heuristicas.js';
import { OUTPUTS, RAIZ, bancoDe, listarSalidas, resolverSalida } from '../lib/salidas.js';
import { normalizar, simular } from '../public/js/modelo.js';

const INSTANCIAS = path.resolve(process.env.INSTANCIAS_DIR ?? path.join(RAIZ, '..', '..', 'Instancias'));
const CARPETA = 'erdogan';
const NOMBRES = {
  dos_fases: '2 fases · TSP + Algoritmo 2.1 adaptado',
  ils_heuristico: 'ILS heurístico · Erdoğan et al. (2012)',
  ils_exacto: 'ILS exacto · Erdoğan et al. (2012)',
  its_heuristico: 'ITS heurístico · Erdoğan et al. (2012)',
  its_exacto: 'ITS exacto · Erdoğan et al. (2012)',
};

function argumentos(argv) {
  const opciones = {
    n: null, algoritmos: Object.keys(ALGORITMOS), iteraciones: 200, banco: null, id: 'all', resumen: true, soloResumen: false,
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--alg') opciones.algoritmos = argv[++k].split(',');
    else if (a === '--iter') opciones.iteraciones = Number(argv[++k]);
    else if (a === '--banco') opciones.banco = { B: 'Battarra', E: 'Erdogan' }[argv[++k].toUpperCase()];
    else if (a === '--id') opciones.id = argv[++k];
    else if (a === '--sin-resumen') opciones.resumen = false;
    else if (a === '--resumen') opciones.soloResumen = true;
    else opciones.n = a;
  }
  if (!opciones.n && !opciones.soloResumen) {
    console.error('Uso: npm run heuristicas -- <n> [--alg a,b] [--iter 200] [--banco B|E] [--id 1-5] [--sin-resumen]');
    process.exit(1);
  }
  const malos = opciones.algoritmos.filter((a) => !ALGORITMOS[a]);
  if (malos.length) {
    console.error(`Algoritmos desconocidos: ${malos.join(', ')}. Disponibles: ${Object.keys(ALGORITMOS).join(', ')}`);
    process.exit(1);
  }
  return opciones;
}

function aceptaN(spec, n) {
  if (spec === 'all') return true;
  return spec.split(',').some((parte) => {
    const [a, b] = parte.split('-').map(Number);
    return b ? n >= a && n <= b : n === a;
  });
}

/** Mejor cota, mayor relajación lineal y mejor Σ D de las variantes de Gurobi de la instancia. */
async function referencias(nombre) {
  const ref = { cota: null, relajacion_lineal: null, objetivo: null, variantes: 0 };
  let carpetas = [];
  try {
    carpetas = await readdir(path.join(OUTPUTS, 'gurobi'));
  } catch {
    return ref;
  }
  for (const variante of carpetas) {
    try {
      const s = JSON.parse(await readFile(path.join(OUTPUTS, 'gurobi', variante, `${nombre}.json`), 'utf8')).solucion;
      ref.variantes++;
      if (s.cota != null) ref.cota = Math.max(ref.cota ?? -Infinity, s.cota);
      if (s.relajacion_lineal != null) ref.relajacion_lineal = Math.max(ref.relajacion_lineal ?? -Infinity, s.relajacion_lineal);
      if (s.objetivo != null) ref.objetivo = Math.min(ref.objetivo ?? Infinity, s.objetivo);
    } catch {
      // esta variante no resolvió la instancia
    }
  }
  return ref;
}

const r6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
const porCliente = (sim, campo) => Object.fromEntries(sim.paradas.map((p) => [p.cliente, r6(p[campo])]));
// Hora local sin zona, como los JSON de Gurobi (2026-10-29T14:16:51)
const fecha = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};

async function correr(inst, clave, iteraciones, ref) {
  const res = resolver(inst, clave, { iteraciones, semilla: semillaDe(`${inst.nombre}|${clave}`) });
  const salida = {
    formato: 'trppdh3-salida/1',
    generado: fecha(),
    algoritmo: {
      clave,
      nombre: NOMBRES[clave],
      parametros: { familia: 'erdogan', ...res.parametros, motor: `Node.js ${process.version}` },
    },
    instancia: inst,
    solucion: { ruta: res.ruta, politica: res.politica },
  };
  // La simulación de la página da T, D, F y q; su Σ D debe coincidir con el del DP.
  const sim = simular(normalizar(salida, `${CARPETA}/${clave}/${inst.nombre}.json`));
  if (Math.abs(sim.objetivo - res.objetivo) > 1e-6 * Math.max(1, res.objetivo) || sim.avisos.length) {
    throw new Error(`${clave} ${inst.nombre}: la simulación da ${sim.objetivo} y el DP ${res.objetivo} ${sim.avisos.join('; ')}`);
  }
  const z = res.objetivo;
  Object.assign(salida.solucion, {
    estado: 'HEURISTICA',
    objetivo: r6(z),
    gap: ref.cota != null ? r6((z - ref.cota) / z) : null,
    gap_entera: ref.relajacion_lineal != null ? r6((z - ref.relajacion_lineal) / z) : null,
    desviacion_gurobi: ref.objetivo != null ? r6((z - ref.objetivo) / ref.objetivo) : null,
    referencia: { fuente: 'gurobi', ...ref },
    segundos: r6(res.segundos),
    segundos_inicial: r6(res.segundosInicial),
    segundos_total: r6(res.segundos),
    evaluaciones: res.evaluaciones,
    tsp: res.tsp,
    corridas: res.corridas.map((c) => ({ ...c, inicial: r6(c.inicial), final: r6(c.final), traza: c.traza.map(r6) })),
    T: porCliente(sim, 'T'),
    D: porCliente(sim, 'D'),
    F: porCliente(sim, 'F'),
    q: porCliente(sim, 'q'),
    viaje: r6(sim.viaje),
    manipulacion_adicional: r6(sim.manipulacionAdicional),
    regreso: r6(sim.regreso),
  });
  const destino = path.join(OUTPUTS, CARPETA, clave, `${inst.nombre}.json`);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');
  return salida;
}

/** Reescribe el CSV con todas las salidas de Outputs/erdogan (no solo las de esta corrida). */
async function escribirResumen() {
  const columnas = ['banco', 'instancia', 'n', 'id', 'h', 'algoritmo', 'evaluacion', 'costo', 'cota_inferior',
    'relajacion_lineal', 'gap', 'gap_entera', 'mejor_gurobi', 'desviacion_gurobi', 'segundos', 'segundos_inicial',
    'evaluaciones_exactas', 'evaluaciones_heuristicas', 'ruta', 'politica'];
  const filas = [];
  for (const { archivo } of (await listarSalidas()).filter((s) => s.archivo.startsWith(`${CARPETA}/`))) {
    const d = JSON.parse(await readFile(resolverSalida(archivo), 'utf8'));
    const s = d.solucion;
    const i = d.instancia;
    filas.push([bancoDe(i.nombre), i.nombre, i.n, i.id, i.h, d.algoritmo.clave, d.algoritmo.parametros.evaluacion,
      s.objetivo, s.referencia.cota, s.referencia.relajacion_lineal, s.gap, s.gap_entera, s.referencia.objetivo,
      s.desviacion_gurobi, s.segundos, s.segundos_inicial, s.evaluaciones.exactas, s.evaluaciones.heuristicas,
      s.ruta.join('-'), s.ruta.slice(1, -1).map((c) => s.politica[c]).join('')]);
  }
  const destino = path.join(OUTPUTS, 'resumenes', 'heuristicas_erdogan.csv');
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, [columnas, ...filas].map((f) => f.map((v) => v ?? '').join(',')).join('\n') + '\n', 'utf8');
  return { destino, filas: filas.length };
}

const opciones = argumentos(process.argv.slice(2));
if (opciones.soloResumen) {
  const { destino, filas } = await escribirResumen();
  console.log(`Resumen de ${filas} corridas en ${destino}`);
  process.exit(0);
}
const archivos = (await readdir(INSTANCIAS)).filter((a) => a.endsWith('.json')).sort();
const instancias = [];
for (const archivo of archivos) {
  const inst = JSON.parse(await readFile(path.join(INSTANCIAS, archivo), 'utf8'));
  if (!aceptaN(opciones.n, inst.n) || !aceptaN(opciones.id, inst.id)) continue;
  if (opciones.banco && bancoDe(inst.nombre) !== opciones.banco) continue;
  instancias.push(inst);
}
instancias.sort((a, b) => a.n - b.n || a.id - b.id || a.h - b.h || a.nombre.localeCompare(b.nombre));
if (!instancias.length) {
  console.error(`No hay instancias con n = ${opciones.n} en ${INSTANCIAS}`);
  process.exit(1);
}

console.log(`${instancias.length} instancias × ${opciones.algoritmos.length} algoritmos, N_iter = ${opciones.iteraciones}`);
const acumulado = Object.fromEntries(opciones.algoritmos.map((a) => [a, []]));
for (const inst of instancias) {
  const ref = await referencias(inst.nombre);
  const partes = [];
  for (const clave of opciones.algoritmos) {
    const { solucion: s } = await correr(inst, clave, opciones.iteraciones, ref);
    acumulado[clave].push(s);
    partes.push(`${ALGORITMOS[clave].nombre} ${s.objetivo.toFixed(2)} (${s.segundos.toFixed(3)} s)`);
  }
  console.log(`${inst.nombre.padEnd(26)} Gurobi ${ref.objetivo?.toFixed(2) ?? '—'} · ${partes.join(' · ')}`);
}

const prom = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(3)} %`);
console.log('\nAlgoritmo        tiempo prom.   GAP prom.   GAP sol. entera   desv. vs Gurobi   = Gurobi');
for (const [clave, sols] of Object.entries(acumulado)) {
  const desv = sols.map((s) => s.desviacion_gurobi).filter((x) => x != null);
  console.log([
    ALGORITMOS[clave].nombre.padEnd(16),
    `${prom(sols.map((s) => s.segundos)).toFixed(3)} s`.padStart(12),
    pct(prom(sols.map((s) => s.gap).filter((x) => x != null))).padStart(11),
    pct(prom(sols.map((s) => s.gap_entera).filter((x) => x != null))).padStart(17),
    pct(prom(desv)).padStart(17),
    `${desv.filter((x) => x <= 1e-6).length}/${sols.length}`.padStart(10),
  ].join(' '));
}
if (opciones.resumen) {
  const { destino, filas } = await escribirResumen();
  console.log(`\nResumen de ${filas} corridas en ${destino}`);
}
