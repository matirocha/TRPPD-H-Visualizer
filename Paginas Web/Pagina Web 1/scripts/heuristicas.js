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
//
// Réplicas: npm run heuristicas -- --replicas 10 --sel B:10-25,E:30-60 [--alg a,b] [--iter 200]
//   Corre cada algoritmo R veces por instancia, la réplica r con la semilla r (1..R); la de
//   2 fases no usa azar y se repite solo para promediar el tiempo. Recorre los pares
//   instancia-algoritmo de los más largos a los más cortos y, al completar las R réplicas de uno, agrega sus
//   filas a Outputs/resumenes/heuristicas_replicas.csv y guarda la mejor réplica en
//   Outputs/erdogan/<algoritmo>/<instancia>.json. Si se corta, al volver a lanzarlo se salta lo
//   que ya está en el CSV. --sel combina banco y n (B = Battarra, E = Erdogan); sin --sel usa
//   <n>, --banco e --id como siempre.
//   --trabajador k: varios procesos con el mismo comando y distinto k se reparten los pares
//   (candados en Outputs/resumenes/.candados_replicas, los más largos primero) y cada uno
//   escribe heuristicas_replicas_<k>.csv. Los candados de un proceso cortado se liberan solos.
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
    replicas: null, sel: null,
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--alg') opciones.algoritmos = argv[++k].split(',');
    else if (a === '--replicas') opciones.replicas = Number(argv[++k]);
    else if (a === '--trabajador') opciones.trabajador = Number(argv[++k]);
    else if (a === '--sel') {
      opciones.sel = argv[++k].split(',').map((parte) => {
        const [b, n] = parte.split(':');
        return { banco: { B: 'Battarra', E: 'Erdogan' }[b.toUpperCase()], n };
      });
      opciones.n ??= 'all';
    }
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

async function correr(inst, clave, iteraciones, ref, semilla = semillaDe(`${inst.nombre}|${clave}`)) {
  const { salida } = calcular(inst, clave, iteraciones, ref, semilla);
  await guardar(salida);
  return salida;
}

async function guardar(salida) {
  const destino = path.join(OUTPUTS, CARPETA, salida.algoritmo.clave, `${salida.instancia.nombre}.json`);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');
}

/** Resuelve, comprueba Σ D con la simulación de la página y arma el JSON (sin guardarlo). */
function calcular(inst, clave, iteraciones, ref, semilla) {
  const res = resolver(inst, clave, { iteraciones, semilla });
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
    segundos_busqueda: r6(res.segundosBusqueda),
    iteraciones: res.iteracionesTotales,
    segundos_por_iteracion: r6(res.segundosPorIteracion),
    iteracion_mejor: res.iteracionMejor,
    segundos_mejor: r6(res.segundosMejor),
    evaluaciones: res.evaluaciones,
    tsp: res.tsp,
    corridas: res.corridas.map((c) => ({
      ...c, inicial: r6(c.inicial), final: r6(c.final), traza: c.traza.map(r6), tiempos: c.tiempos.map(r6),
    })),
    T: porCliente(sim, 'T'),
    D: porCliente(sim, 'D'),
    F: porCliente(sim, 'F'),
    q: porCliente(sim, 'q'),
    viaje: r6(sim.viaje),
    manipulacion_adicional: r6(sim.manipulacionAdicional),
    regreso: r6(sim.regreso),
  });
  return { salida, res };
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

const COLUMNAS_REPLICAS = ['banco', 'instancia', 'n', 'id', 'h', 'algoritmo', 'replica', 'semilla', 'costo',
  'segundos', 'segundos_inicial', 'segundos_busqueda', 'iteraciones', 'segundos_por_iteracion', 'iteracion_mejor',
  'segundos_mejor', 'evaluaciones_exactas', 'evaluaciones_heuristicas', 'n_iter', 'motor', 'fecha', 'ruta', 'politica'];
const RESUMENES = path.join(OUTPUTS, 'resumenes');
// heuristicas_replicas.csv (un proceso) o heuristicas_replicas_<k>.csv (trabajador k)
const ES_CSV_REPLICAS = /^heuristicas_replicas(_\d+)?\.csv$/;
const CANDADOS = path.join(RESUMENES, '.candados_replicas');
// Peso relativo de cada algoritmo (× n⁴) para repartir primero los pares más largos
const PESO = { ils_exacto: 1, ils_heuristico: 0.15, its_exacto: 0.08, its_heuristico: 0.012, dos_fases: 0.0005 };

/** Pares "instancia|algoritmo" con todas sus réplicas en alguno de los CSV de réplicas. */
async function replicasHechas(R) {
  const cuenta = new Map();
  await mkdir(RESUMENES, { recursive: true });
  for (const archivo of (await readdir(RESUMENES)).filter((a) => ES_CSV_REPLICAS.test(a))) {
    const [cabecera, ...filas] = (await readFile(path.join(RESUMENES, archivo), 'utf8')).trim().split('\n');
    const col = Object.fromEntries(cabecera.split(',').map((c, i) => [c, i]));
    for (const fila of filas) {
      const v = fila.split(',');
      const clave = `${v[col.instancia]}|${v[col.algoritmo]}`;
      cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    }
  }
  return new Set([...cuenta].filter(([, k]) => k >= R).map(([c]) => c));
}

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** Reserva un par para este proceso (varios trabajadores comparten la cola). Un candado cuyo
 *  dueño ya no existe (proceso cortado) se toma; uno marcado "hecho" no. */
async function reservar(nombre) {
  const archivo = path.join(CANDADOS, nombre.replace('|', '__'));
  try {
    await writeFile(archivo, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    const contenido = await readFile(archivo, 'utf8').catch(() => 'hecho');
    if (contenido === 'hecho' || vivo(Number(contenido))) return false;
    await writeFile(archivo, String(process.pid));
    return true;
  }
}

async function correrReplicas(instancias, { algoritmos, iteraciones, replicas: R, trabajador }) {
  const hechas = await replicasHechas(R);
  const csv = path.join(RESUMENES, trabajador ? `heuristicas_replicas_${trabajador}.csv` : 'heuristicas_replicas.csv');
  try {
    await readFile(csv);
  } catch {
    await writeFile(csv, `${COLUMNAS_REPLICAS.join(',')}\n`, 'utf8');
  }
  await mkdir(CANDADOS, { recursive: true });
  const pares = [];
  for (const clave of algoritmos) {
    for (const inst of instancias) if (!hechas.has(`${inst.nombre}|${clave}`)) pares.push({ clave, inst });
  }
  // Los más largos primero, para que al final no quede un solo proceso trabajando
  pares.sort((a, b) => PESO[b.clave] * b.inst.n ** 4 - PESO[a.clave] * a.inst.n ** 4
    || a.inst.n - b.inst.n || a.inst.id - b.inst.id || a.inst.h - b.inst.h);
  console.log(`${instancias.length} instancias × ${algoritmos.length} algoritmos × ${R} réplicas, N_iter = ${iteraciones}; `
    + `faltan ${pares.length} pares instancia-algoritmo (${hechas.size} ya hechos). Escribe en ${csv}`);
  const motor = `Node.js ${process.version}`;
  const refs = new Map();
  for (const { clave, inst } of pares) {
    {
      const nombrePar = `${inst.nombre}|${clave}`;
      if (!(await reservar(nombrePar))) continue;
      if (!refs.has(inst.nombre)) refs.set(inst.nombre, await referencias(inst.nombre));
      const ref = refs.get(inst.nombre);
      const filas = [];
      let mejor = null;
      for (let r = 1; r <= R; r++) {
        const { salida, res } = calcular(inst, clave, iteraciones, ref, r);
        const s = salida.solucion;
        if (!mejor || res.objetivo < mejor.solucion.objetivo - 1e-9) mejor = salida;
        filas.push([bancoDe(inst.nombre), inst.nombre, inst.n, inst.id, inst.h, clave, r,
          ALGORITMOS[clave].metodo ? r : '', s.objetivo, s.segundos, s.segundos_inicial, s.segundos_busqueda,
          s.iteraciones, s.segundos_por_iteracion, s.iteracion_mejor, s.segundos_mejor, s.evaluaciones.exactas,
          s.evaluaciones.heuristicas, iteraciones, motor, salida.generado, s.ruta.join('-'),
          s.ruta.slice(1, -1).map((c) => s.politica[c]).join('')]);
      }
      await guardar(mejor);
      await appendFile(csv, filas.map((f) => f.map((v) => v ?? '').join(',')).join('\n') + '\n', 'utf8');
      await writeFile(path.join(CANDADOS, nombrePar.replace('|', '__')), 'hecho');
      const costos = filas.map((f) => f[8]);
      const tiempos = filas.map((f) => f[9]);
      console.log(`${clave.padEnd(15)} ${inst.nombre.padEnd(26)} Σ D mejor ${Math.min(...costos).toFixed(2)} `
        + `prom ${(costos.reduce((a, b) => a + b, 0) / R).toFixed(2)} · ${(tiempos.reduce((a, b) => a + b, 0) / R).toFixed(3)} s/réplica`);
    }
  }
  console.log(`Listo: ${csv}`);
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
  if (opciones.sel && !opciones.sel.some((s) => s.banco === bancoDe(inst.nombre) && aceptaN(s.n, inst.n))) continue;
  instancias.push(inst);
}
instancias.sort((a, b) => a.n - b.n || a.id - b.id || a.h - b.h || a.nombre.localeCompare(b.nombre));
if (!instancias.length) {
  console.error(`No hay instancias con n = ${opciones.n} en ${INSTANCIAS}`);
  process.exit(1);
}

if (opciones.replicas) {
  await correrReplicas(instancias, opciones);
  process.exit(0);
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
