// Sección 03 · Heurísticas: las de Erdoğan et al. (2012) adaptadas al TRPPD-H3
// (lib/heuristicas.js, corridas con npm run heuristicas) frente a Gurobi.
//
// Una fila por algoritmo en los gráficos de comparacion.js. Gurobi entra con una sola
// corrida por instancia: la variante con menor Σ D y, entre ellas, la más rápida. Las
// fórmulas de las tarjetas de método (index.html) se dibujan con KaTeX al crear la sección.
import { crearComparacion, mismoGrupo, segundos } from './comparacion.js';
import { $$, fmt } from './util.js';

const pct = (x, d = 3) => (x == null ? '—' : `${fmt(x * 100, d)} %`);

const METRICAS = {
  segundos: {
    texto: 'Tiempo', unidad: ' s', log: true, formato: segundos,
    ayuda: 'Runtime de Gurobi; en las heurísticas, desde leer la instancia hasta la solución, con el TSP incluido. Escala logarítmica.',
  },
  objetivo: {
    texto: 'Función objetivo', unidad: '', decimales: 2,
    ayuda: 'Σ D<sub>i</sub> de la solución que entrega cada algoritmo.',
  },
  gap: {
    texto: 'GAP', unidad: ' %', decimales: 3, escala: 100,
    ayuda: '(Σ D<sub>i</sub> − cota inferior) / Σ D<sub>i</sub>. Las heurísticas no tienen cota propia: se usa la mejor de las cuatro variantes de Gurobi.',
  },
  gapEntera: {
    texto: 'GAP relajación lineal', unidad: ' %', decimales: 2, escala: 100,
    ayuda: '(Σ D<sub>i</sub> − relajación lineal) / Σ D<sub>i</sub>, con la mayor relajación lineal de las variantes de Gurobi (antes «GAP sol. entera»; el GAP sol. entera del Excel es la desviación).',
  },
  desviacion: {
    texto: 'Desviación', unidad: ' %', decimales: 3, escala: 100,
    ayuda: '(Σ D<sub>i</sub> − mejor Σ D<sub>i</sub> conocido) / mejor Σ D<sub>i</sub> conocido, entre todas las soluciones de la instancia; la Dev. (%) de Erdoğan et al.',
  },
};

// corta: eje de los gráficos · etiqueta: tabla y tooltip · nombre: texto de la nota
export const SERIES = [
  { clave: 'gurobi', corta: 'Gurobi', etiqueta: 'Gurobi · mejor variante', nombre: 'Gurobi', vecindario: 'modelo (1)–(19) y variantes' },
  { clave: 'dos_fases', corta: '2 fases', etiqueta: '2 fases · TSP + Algoritmo 2.1', nombre: '2 fases', vecindario: 'sin búsqueda local' },
  { clave: 'ils_heuristico', corta: 'ILS heur.', etiqueta: 'ILS heurístico', nombre: 'ILS heurístico', vecindario: 'umbral lineal, O(n)' },
  { clave: 'ils_exacto', corta: 'ILS exacto', etiqueta: 'ILS exacto', nombre: 'ILS exacto', vecindario: 'DP exacto, O(n²)' },
  { clave: 'its_heuristico', corta: 'ITS heur.', etiqueta: 'ITS heurístico', nombre: 'ITS heurístico', vecindario: 'umbral lineal, O(n)' },
  { clave: 'its_exacto', corta: 'ITS exacto', etiqueta: 'ITS exacto', nombre: 'ITS exacto', vecindario: 'DP exacto, O(n²)' },
];
const CLAVES = new Set(SERIES.map((v) => v.clave));

export function serieDe(s) {
  if (s.algoritmo.familia === 'erdogan') return CLAVES.has(s.algoritmo.clave) ? s.algoritmo.clave : null;
  return s.algoritmo.clave === 'gurobi' ? 'gurobi' : null;
}

/**
 * Menor Σ D; a igual Σ D, la que probó optimalidad y después la más rápida (para Gurobi,
 * que tiene cuatro variantes por instancia).
 */
export const representante = (salidas) => [...salidas].sort((a, b) => (a.objetivo ?? Infinity) - (b.objetivo ?? Infinity)
  || (b.estado === 'OPTIMAL') - (a.estado === 'OPTIMAL')
  || (a.segundos ?? Infinity) - (b.segundos ?? Infinity))[0];

const igual = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

function lista(nombres) {
  return nombres.length < 2 ? nombres.join('') : `${nombres.slice(0, -1).join(', ')} ${/^[iI]/.test(nombres.at(-1)) ? 'e' : 'y'} ${nombres.at(-1)}`;
}

/** Nota bajo el gráfico A: qué heurísticas llegan al mejor Σ D de la instancia y en cuánto tiempo. */
function nota(filas) {
  const conSolucion = filas.filter((d) => d.s?.objetivo != null);
  const heur = conSolucion.filter((d) => d.v.clave !== 'gurobi');
  if (!heur.length) return null;
  const mejor = Math.min(...conSolucion.map((d) => d.s.objetivo));
  const llegan = heur.filter((d) => igual(d.s.objetivo, mejor));
  const faltan = heur.filter((d) => !igual(d.s.objetivo, mejor));
  const gurobi = conSolucion.find((d) => d.v.clave === 'gurobi')?.s;
  const partes = [];
  if (llegan.length) {
    partes.push(`${lista(llegan.map((d) => d.v.nombre))} ${llegan.length === 1 ? 'llega' : 'llegan'} al mejor Σ D<sub>i</sub> conocido, ${fmt(mejor)}, en ${segundos(Math.max(...llegan.map((d) => d.s.segundos)))} s o menos.`);
  }
  if (faltan.length) {
    // Los que quedan a la misma distancia se nombran juntos
    const porDistancia = new Map();
    for (const d of faltan) {
      const texto = pct((d.s.objetivo - mejor) / mejor, 2);
      porDistancia.set(texto, [...(porDistancia.get(texto) ?? []), d.v.nombre]);
    }
    partes.push(`${[...porDistancia].map(([texto, nombres]) => `${lista(nombres)} ${nombres.length === 1 ? 'queda' : 'quedan'} a ${texto}`).join('; ')}.`);
  }
  if (gurobi) {
    const variante = gurobi.algoritmo.nombre.split(' · ')[1] ?? gurobi.algoritmo.nombre;
    partes.push(igual(gurobi.objetivo, mejor)
      ? `Gurobi ${gurobi.estado === 'OPTIMAL' ? 'prueba que es óptimo' : 'llega al mismo valor'} en ${segundos(gurobi.segundos)} s con su variante más rápida, ${variante}.`
      : `Gurobi termina en ${fmt(gurobi.objetivo)} (${pct((gurobi.objetivo - mejor) / mejor, 2)} sobre el mejor) tras ${segundos(gurobi.segundos)} s con ${variante}.`);
  }
  return faltan.length
    ? { clase: ' rend-nota--limite', icono: 'i', html: partes.join(' ') }
    : { clase: '', icono: '✓', html: partes.join(' ') };
}

function tooltip(s, v) {
  const variante = v.clave === 'gurobi' ? ` (${s.algoritmo.nombre.split(' · ')[1] ?? s.algoritmo.nombre})` : '';
  return `<strong>${v.etiqueta}</strong>${variante} · ${s.instancia.nombre}<br>`
    + `Tiempo ${segundos(s.segundos)} s<br>`
    + `Σ D<sub>i</sub> = ${fmt(s.objetivo)} · desviación ${pct(s.desviacion)}<br>`
    + `GAP ${pct(s.gap)} · GAP relajación lineal ${pct(s.gapEntera, 2)}`;
}

/** opciones: manifest() lista de salidas, actual() archivo mostrado, elegir(archivo). */
export function crear(raiz, _estado, opciones) {
  // Fórmulas de las tarjetas de método, fijas en index.html
  for (const nodo of $$('[data-tex]', raiz.closest('section') ?? document)) {
    if (window.katex) katex.render(nodo.dataset.tex, nodo, { throwOnError: false, displayMode: nodo.dataset.bloque != null });
    else nodo.textContent = nodo.dataset.tex;
  }
  return crearComparacion(raiz, opciones, {
    metricas: METRICAS,
    series: SERIES,
    serieDe,
    representante,
    hayDatos: (salidas, mostrada) => salidas.some((s) => s.algoritmo.familia === 'erdogan' && mismoGrupo(s, mostrada)),
    vacio: (mostrada) => `Todavía no hay corridas de las heurísticas para n = ${mostrada?.instancia.n ?? '—'} en Outputs. `
      + `Ejecuta <code>npm run heuristicas -- ${mostrada?.instancia.n ?? 10}</code> en <code>Paginas Web/Pagina Web 1</code> y recarga la página.`,
    titulos: {
      a: (mostrada) => `Esta instancia · ${mostrada.instancia.nombre}`,
      bajadaA: 'Una fila por algoritmo; en tinta, el que se está mostrando. Gurobi aparece con su variante más rápida entre las que llegan al menor Σ D<sub>i</sub>. Clic en una fila para abrir esa solución.',
      b: (grupo) => `Todas las instancias con ${grupo}`,
      bajadaB: (total) => `Un punto por instancia (${total} combinaciones de ID y h) y una raya en la mediana. El anillo es la instancia mostrada.`,
      tabla: (grupo, M) => `Resumen por algoritmo · ${grupo} · ${M.texto.toLowerCase()}`,
    },
    nota,
    tooltip,
    tabla: {
      encabezados: ['Algoritmo', 'Evaluación', 'Instancias', 'Llega al mejor', 'Mediana', 'Media', 'Máximo', 'Tiempo medio'],
      fila: (r, _resumen, texto) => {
        const tiempos = r.salidas.map((s) => s.segundos).filter((t) => t != null);
        return [
          r.v.etiqueta, r.v.vecindario, String(r.cantidad),
          `${r.salidas.filter((s) => s.desviacion != null && s.desviacion <= 1e-6).length} de ${r.cantidad}`,
          texto(r.mediana), texto(r.media), texto(r.max),
          tiempos.length ? `${segundos(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)} s` : '—',
        ];
      },
    },
  });
}
