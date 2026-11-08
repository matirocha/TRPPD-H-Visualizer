// Sección 02 · Rendimiento: tiempos de ejecución del modelo de Gurobi con y sin
// las restricciones (20)-(23) y (24)-(29).
//
// Una fila por variante en los gráficos de comparacion.js (esta instancia, como lista con el valor
// en grande, y todas las del mismo banco y n), con una tabla de óptimas, mediana, media y máximo.
// Con límite de tiempo los segundos se igualan y el GAP es la medida que distingue a las variantes.
// Debajo, la tabla comparativa por instancia y el tiempo según n de comparativa.js (resultados del
// Excel de resúmenes: Gurobi y las réplicas de las heurísticas).
import { crearComparacion } from './comparacion.js';
import { tablaComparativa } from './comparativa.js';
import { VARIANTES, claveVariante, fmt } from './util.js';

const METRICAS = {
  segundos: {
    texto: 'Tiempo', unidad: ' s', decimales: 3, relativo: 'veces', mas: 'más lento', menos: 'más rápido',
    ayuda: 'Tiempo que tarda Gurobi en resolver el modelo (Runtime), sin construirlo; el límite es 3 600 s.',
  },
  segundosTotal: {
    texto: 'Total', unidad: ' s', decimales: 3, relativo: 'veces', mas: 'más lento', menos: 'más rápido',
    ayuda: 'Construcción del modelo, resolución y lectura de la solución.',
  },
  nodos: {
    texto: 'Nodos B&B', unidad: '', decimales: 0, relativo: 'veces', mas: 'más nodos', menos: 'menos nodos',
    ayuda: 'Nodos del árbol de ramificación y acotamiento que explora Gurobi.',
  },
  objetivo: {
    texto: 'Función objetivo', unidad: '', decimales: 2, relativo: 'porcentaje',
    ayuda: 'Σ Dᵢ de la mejor solución de cada variante (cota superior); con límite de tiempo no es necesariamente el óptimo.',
  },
  gap: {
    texto: 'GAP', unidad: ' %', decimales: 2, escala: 100, relativo: 'puntos',
    ayuda: '(Cota superior − cota inferior) / cota superior al terminar (MIPGap); 0 % es óptimo probado.',
  },
  // La desviación del manifest respecto de la mejor solución conocida es, en Gurobi, el GAP sol. entera
  desviacion: {
    texto: 'GAP sol. entera', unidad: ' %', decimales: 2, escala: 100, relativo: 'puntos',
    ayuda: '(Cota superior − BKS) / BKS, con BKS la mejor solución conocida: la menor entre las 4 variantes y las 5 heurísticas. 0 % es que la alcanza.',
  },
};

// Etiquetas cortas para el eje de las variantes
const CORTA = { '00': '(1)–(19)', 10: '+ (20)–(23)', '01': '+ (24)–(29)', 11: '(1)–(29)' };
const DESCRIPCION = { '00': 'modelo base', 10: 'con explicitación de cargas', '01': 'con desigualdad de latencia', 11: 'modelo completo' };
const ESTADOS = { OPTIMAL: 'óptima', TIME_LIMIT: 'límite de tiempo', SUBOPTIMAL: 'subóptima' };
const SERIES = VARIANTES.map((v) => ({ clave: v.clave, corta: CORTA[v.clave], etiqueta: v.etiqueta, descripcion: DESCRIPCION[v.clave] }));

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
        + (metrica === 'gap' || metrica === 'desviacion' ? '' : ' Elige la medida GAP o GAP sol. entera para compararlas.'),
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
    + `Tiempo ${fmt(s.segundos, 3)} s · total ${fmt(s.segundosTotal, 3)} s<br>`
    + `Nodos B&amp;B ${fmt(s.nodos, 0)}${s.gap != null ? ` · GAP ${fmt(s.gap * 100, 2)} %` : ''}`
    + `${s.desviacion != null ? ` · GAP sol. entera ${fmt(s.desviacion * 100, 2)} %` : ''}<br>`
    + `Σ D<sub>i</sub> = ${fmt(s.objetivo)}${s.estado ? ` (${ESTADOS[s.estado] ?? s.estado.toLowerCase()})` : ''}${relacion}`;
}

/** opciones: manifest() lista de salidas, resultados() del Excel, actual() archivo mostrado, elegir(archivo). */
export function crear(raiz, _estado, opciones) {
  // Selectores de la tabla comparativa (n, h, variante de Gurobi y costo de las heurísticas):
  // tablaComparativa los guarda aquí para conservarlos al cambiar de solución o de medida
  const preferencias = { grupo: null, grupoMostrada: null, h: 'todos', variante: 'mejor', costo: 'mejor' };
  return crearComparacion(raiz, opciones, {
    extra: (datos) => tablaComparativa({ ...datos, preferencias }),
    metricas: METRICAS,
    series: SERIES,
    serieDe: (s) => claveVariante(s.algoritmo.variante),
    vacio: () => 'No hay soluciones de Gurobi con variantes en Outputs. Ejecuta notebooks/modelo_trppdh3.py con RESTRICCIONES_20_23 y RESTRICCIONES_24_29 = [False, True].',
    estiloA: 'lista',
    estadoA: (s) => (s.estado ? { texto: ESTADOS[s.estado] ?? s.estado.toLowerCase(), clase: s.estado === 'OPTIMAL' ? 'opt' : 'limite' } : null),
    titulos: {
      a: (mostrada) => `Esta instancia · ${mostrada.instancia.nombre}`,
      bajadaA: 'Una fila por variante del modelo, con la barra a escala de la mayor; en tinta, la que se está mostrando. Bajo cada barra, si probó el óptimo y cuánto cambia respecto de (1)–(19). Clic en una fila para abrirla.',
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
