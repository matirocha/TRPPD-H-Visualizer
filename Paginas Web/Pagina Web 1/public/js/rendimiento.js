// Sección 02 · Rendimiento: tiempos de ejecución del modelo de Gurobi con y sin
// las restricciones (20)-(23) y (24)-(29).
//
// Una fila por variante en los gráficos de comparacion.js (esta instancia y todas las
// del mismo banco y n), con una tabla de óptimas, mediana, media y máximo. Con límite de
// tiempo los segundos se igualan y el GAP es la medida que distingue a las variantes.
// Debajo, la tabla comparativa por instancia de comparativa.js (heurísticas y Gurobi).
import { crearComparacion } from './comparacion.js';
import { tablaComparativa } from './comparativa.js';
import { VARIANTES, claveVariante, fmt } from './util.js';

const METRICAS = {
  segundos: {
    texto: 'Resolución', unidad: ' s', decimales: 3,
    ayuda: 'Tiempo que tarda Gurobi en resolver el modelo (Runtime).',
  },
  segundosTotal: {
    texto: 'Total', unidad: ' s', decimales: 3,
    ayuda: 'Construcción del modelo, resolución y lectura de la solución.',
  },
  nodos: {
    texto: 'Nodos B&B', unidad: '', decimales: 0,
    ayuda: 'Nodos del árbol de ramificación y acotamiento que explora Gurobi.',
  },
  objetivo: {
    texto: 'Función objetivo', unidad: '', decimales: 2,
    ayuda: 'Σ Dᵢ de la mejor solución de cada variante; con límite de tiempo no es necesariamente el óptimo.',
  },
  gap: {
    texto: 'GAP', unidad: ' %', decimales: 2, escala: 100,
    ayuda: 'Brecha final entre la mejor solución y la cota inferior (MIPGap); 0 % es óptimo probado.',
  },
  gapEntera: {
    texto: 'GAP sol. entera', unidad: ' %', decimales: 2, escala: 100,
    ayuda: '(Σ D<sub>i</sub> − relajación lineal) / Σ D<sub>i</sub>: mide la fuerza de la formulación; (20)–(29) buscan reducirlo.',
  },
};

// Etiquetas cortas para el eje de las variantes
const CORTA = { '00': '(1)–(19)', 10: '+ (20)–(23)', '01': '+ (24)–(29)', 11: '(1)–(29)' };
const ESTADOS = { OPTIMAL: 'óptima', TIME_LIMIT: 'límite de tiempo', SUBOPTIMAL: 'subóptima' };
const SERIES = VARIANTES.map((v) => ({ clave: v.clave, corta: CORTA[v.clave], etiqueta: v.etiqueta }));

/** Nota bajo el gráfico A: si las variantes llegan al mismo Σ D y si lo probaron óptimo. */
function nota(filas, { metrica }) {
  const conSolucion = filas.filter((d) => d.s);
  if (!conSolucion.length) return null;
  const objetivos = conSolucion.map((d) => d.s.objetivo);
  const iguales = objetivos.every((o) => Math.abs(o - objetivos[0]) < 1e-4);
  const sinProbar = conSolucion.filter((d) => d.s.estado && d.s.estado !== 'OPTIMAL').length;
  // Con límite de tiempo cada variante informa su mejor solución: que difieran no es un error
  const noProbaron = `${sinProbar} de ${conSolucion.length} ${sinProbar === 1 ? 'variante no probó' : 'variantes no probaron'}`;
  if (sinProbar) {
    return {
      clase: ' rend-nota--limite', icono: 'i',
      html: (iguales
        ? `Las ${objetivos.length} variantes llegan al mismo Σ D<sub>i</sub> = ${fmt(objetivos[0])}, pero ${noProbaron} que sea óptimo dentro del límite de tiempo.`
        : `${noProbaron} el óptimo dentro del límite de tiempo: Σ D<sub>i</sub> es la mejor solución que encontró cada una (${objetivos.map((o) => fmt(o)).join(' · ')}); la menor es ${fmt(Math.min(...objetivos))}.`)
        + (metrica === 'gap' ? '' : ' Elige la medida GAP para compararlas.'),
    };
  }
  return iguales
    ? { clase: '', icono: '✓', html: `Las ${objetivos.length} variantes llegan al mismo óptimo, Σ D<sub>i</sub> = ${fmt(objetivos[0])}: las restricciones (20)–(29) solo cambian el tiempo.` }
    : { clase: ' rend-nota--error', icono: '!', html: `Las variantes no llegan al mismo Σ D<sub>i</sub> (${objetivos.map((o) => fmt(o)).join(' · ')}); revisa el estado de cada una.` };
}

function tooltip(s, v, filas, { valor }) {
  const base = filas[0].s;
  const relacion = base && s !== base && valor(base) > 0 ? `<br>× ${fmt(valor(s) / valor(base), 2)} respecto de (1)–(19)` : '';
  return `<strong>${v.etiqueta}</strong> · ${s.instancia.nombre}<br>`
    + `Resolución ${fmt(s.segundos, 3)} s · total ${fmt(s.segundosTotal, 3)} s<br>`
    + `Nodos B&amp;B ${fmt(s.nodos, 0)}${s.gap != null ? ` · GAP ${fmt(s.gap * 100, 2)} %` : ''}`
    + `${s.gapEntera != null ? ` · GAP sol. entera ${fmt(s.gapEntera * 100, 2)} %` : ''}<br>`
    + `Σ D<sub>i</sub> = ${fmt(s.objetivo)}${s.estado ? ` (${ESTADOS[s.estado] ?? s.estado.toLowerCase()})` : ''}${relacion}`;
}

/** opciones: manifest() lista de salidas, actual() archivo mostrado, elegir(archivo). */
export function crear(raiz, _estado, opciones) {
  // Variante de Gurobi y h de la tabla comparativa: se conservan al cambiar de solución o de medida
  let varianteTabla = 'mejor';
  let hTabla = 'todos';
  return crearComparacion(raiz, opciones, {
    extra: (datos) => tablaComparativa({
      ...datos,
      variante: varianteTabla,
      h: hTabla,
      alCambiarVariante: (v) => { varianteTabla = v; },
      alCambiarH: (v) => { hTabla = v; },
    }),
    metricas: METRICAS,
    series: SERIES,
    serieDe: (s) => claveVariante(s.algoritmo.variante),
    vacio: () => 'No hay soluciones de Gurobi con variantes en Outputs. Ejecuta notebooks/modelo_trppdh3.py con RESTRICCIONES_20_23 y RESTRICCIONES_24_29 = [False, True].',
    titulos: {
      a: (mostrada) => `Esta instancia · ${mostrada.instancia.nombre}`,
      bajadaA: 'Una barra por variante del modelo; en tinta, la que se está mostrando. Clic en una barra para abrirla.',
      b: (grupo) => `Todas las instancias con ${grupo}`,
      bajadaB: (total) => `Un punto por instancia (${total} combinaciones de ID y h) y una raya en la mediana. El anillo es la instancia mostrada.`,
      tabla: (grupo, M) => `Resumen por variante · ${grupo} · ${M.texto.toLowerCase()}`,
    },
    nota,
    tooltip,
    tabla: {
      encabezados: ['Variante', 'Restricciones', 'Instancias', 'Óptimas', 'Mediana', 'Media', 'Máximo', 'Media vs (1)–(19)'],
      fila: (r, resumen, texto) => {
        const mediaBase = resumen[0].media;
        return [
          r.v.corta, r.v.etiqueta, String(r.cantidad), String(r.salidas.filter((s) => s.estado === 'OPTIMAL').length),
          texto(r.mediana), texto(r.media), texto(r.max),
          r.media == null || !mediaBase ? '—' : r.v.clave === '00' ? 'referencia' : `× ${fmt(r.media / mediaBase, 2)}`,
        ];
      },
    },
  });
}
