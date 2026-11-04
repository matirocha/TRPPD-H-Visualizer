// Tabla comparativa de la sección Rendimiento: una fila por instancia del mismo banco y n
// y, por cada método, dos columnas: tiempo de ejecución y Σ D_i. Cada Σ D_i lleva una marca:
//   heurísticas  +x % sobre la mejor solución conocida de la instancia (la menor entre todos
//                los métodos y las cuatro variantes de Gurobi; desviacion del manifest)
//   Gurobi       ópt. si terminó con estado OPTIMAL; c.s. (cota superior) si no
// Gurobi aparece si tiene corridas en el grupo, con la variante elegida sobre la tabla (por
// omisión la mejor de las cuatro, como en la sección Heurísticas).
import { mismoGrupo, segundos } from './comparacion.js';
import { representante, serieDe } from './heuristicas.js';
import { VARIANTES, claveVariante, el, fmt } from './util.js';

const METODOS = [
  { clave: 'dos_fases', titulo: 'Heurística 2 fases' },
  { clave: 'ils_heuristico', titulo: 'ILS heurístico' },
  { clave: 'ils_exacto', titulo: 'ILS exacto' },
  { clave: 'its_heuristico', titulo: 'ITS heurístico' },
  { clave: 'its_exacto', titulo: 'ITS exacto' },
  { clave: 'gurobi', titulo: 'Gurobi' },
];
const OPCIONES_GUROBI = [{ clave: 'mejor', texto: 'Mejor de las 4' }, ...VARIANTES.map((v) => ({ clave: v.clave, texto: v.etiqueta }))];

const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
// La desviación del manifest es relativa: 1e-6 absorbe los decimales que redondea cada archivo
const enLaMejor = (s) => s.desviacion != null && s.desviacion <= 1e-6;
const textoDesviacion = (d) => (d <= 1e-6 ? '0 %' : d < 5e-5 ? '+<0,01 %' : `+${fmt(d * 100, 2)} %`);

/** Una fila por instancia: la salida de cada método y, en Gurobi, si probó optimalidad. */
function filasDe(manifest, mostrada, variante) {
  const porInstancia = new Map();
  for (const s of manifest) {
    if (!serieDe(s) || !mismoGrupo(s, mostrada)) continue;
    porInstancia.set(s.instancia.nombre, [...(porInstancia.get(s.instancia.nombre) ?? []), s]);
  }
  return [...porInstancia.values()].map((salidas) => {
    const gurobi = salidas.filter((s) => serieDe(s) === 'gurobi');
    const celdas = METODOS.map((m) => {
      const s = m.clave !== 'gurobi'
        ? salidas.find((x) => serieDe(x) === m.clave)
        : variante === 'mejor' ? representante(gurobi) : gurobi.find((g) => claveVariante(g.algoritmo.variante) === variante);
      if (s?.objetivo == null) return { s: null };
      return { s, gurobi: m.clave === 'gurobi', optimo: m.clave === 'gurobi' && s.estado === 'OPTIMAL' };
    });
    return { instancia: salidas[0].instancia, celdas };
  }).sort((a, b) => a.instancia.id - b.instancia.id || a.instancia.h - b.instancia.h);
}

/** Fila de botones de la tabla: etiqueta y un segmentado; elegir(clave) se llama al cambiar. */
function selector(etiqueta, aria, opciones, actual, elegir, clase = '') {
  return el('div', { class: `rend-control${clase}` },
    el('span', { class: 'rend-control__etiqueta', html: etiqueta }),
    el('div', { class: 'segmentado', role: 'group', 'aria-label': aria },
      opciones.map((o) => el('button', {
        type: 'button', 'aria-pressed': String(o.clave === actual),
        onclick: () => o.clave !== actual && elegir(o.clave),
      }, o.texto))));
}

/**
 * opciones: manifest, mostrada (salida del manifest), actual (archivo), elegir(archivo),
 * variante ('mejor' o clave de VARIANTES) y h ('todos' o un valor de h) con
 * alCambiarVariante(clave) y alCambiarH(valor) para recordarlos.
 */
export function tablaComparativa(opciones) {
  const { manifest, mostrada, actual, elegir, alCambiarVariante, alCambiarH } = opciones;
  let variante = opciones.variante;
  let h = opciones.h ?? 'todos';
  const tarjeta = el('article', { class: 'tarjeta rend-tarjeta rend-tarjeta--tabla rend-comp', 'aria-labelledby': 'rend-comp-titulo' });
  pintar();
  return tarjeta;

  function pintar() {
    const todas = filasDe(manifest, mostrada, variante);
    // Valores de h del grupo; si el elegido no existe en este n y banco, se muestran todos
    const valoresH = [...new Set(todas.map((f) => f.instancia.h).filter((v) => v != null))].sort((a, b) => a - b);
    if (h !== 'todos' && !valoresH.includes(h)) h = 'todos';
    const filas = h === 'todos' ? todas : todas.filter((f) => f.instancia.h === h);
    const grupo = `n = ${mostrada.instancia.n} · banco ${mostrada.instancia.banco}`;
    const hayGurobi = manifest.some((s) => serieDe(s) === 'gurobi' && mismoGrupo(s, mostrada));
    const metodos = METODOS.filter((m) => m.clave !== 'gurobi' || hayGurobi);
    const hayHeuristicas = todas.some((f) => f.celdas.slice(0, -1).some((c) => c.s));
    const textoGurobi = OPCIONES_GUROBI.find((o) => o.clave === variante)?.texto ?? '';

    const controles = el('div', { class: 'rend-comp__controles' },
      valoresH.length > 1 ? selector('h', 'Valor de h en la tabla',
        [{ clave: 'todos', texto: 'Todos' }, ...valoresH.map((v) => ({ clave: v, texto: fmt(v) }))], h, (v) => {
          h = v;
          alCambiarH(v);
          pintar();
        }, ' rend-comp__h-control') : null,
      hayGurobi ? selector('Gurobi', 'Variante de Gurobi en la tabla', OPCIONES_GUROBI, variante, (v) => {
        variante = v;
        alCambiarVariante(v);
        pintar();
      }) : null);

    // Gurobi: ópt. o c.s.; heurísticas: cuánto quedan sobre la mejor solución conocida
    const marca = ({ s, gurobi, optimo }) => (gurobi
      ? el('span', {
        class: `rend-comp__marca rend-comp__marca--${optimo ? 'opt' : 'cs'}`,
        title: optimo ? 'Óptimo probado' : 'Cota superior: solución entera sin optimalidad probada',
      }, optimo ? 'ópt.' : 'c.s.')
      : s.desviacion == null ? null : el('span', {
        class: `rend-comp__marca rend-comp__marca--desv${enLaMejor(s) ? ' rend-comp__marca--cero' : ''}`,
        title: enLaMejor(s) ? 'Alcanza la mejor solución conocida' : 'Sobre la mejor solución conocida de la instancia',
      }, textoDesviacion(s.desviacion)));

    const celdasFila = (f) => f.celdas.slice(0, metodos.length).flatMap((celda) => {
      const { s } = celda;
      if (!s) return [el('td', { class: 'rend-comp__vacia' }, '—'), el('td', { class: 'rend-comp__vacia rend-comp__fo' }, '—')];
      const mejor = enLaMejor(s);
      const esActual = s.archivo === actual;
      return [
        el('td', { class: `rend-comp__tiempo${esActual ? ' rend-comp__actual' : ''}` }, segundos(s.segundos)),
        el('td', { class: `rend-comp__fo${esActual ? ' rend-comp__actual' : ''}` },
          el('button', {
            type: 'button', class: `rend-comp__abrir${mejor ? ' rend-comp__mejor' : ''}`,
            title: `Abrir ${s.algoritmo.nombre} en ${s.instancia.nombre}`,
            onclick: () => s.archivo !== actual && elegir(s.archivo),
          }, fmt(s.objetivo)),
          marca(celda)),
      ];
    });

    // Pie: promedios y cuántas instancias son óptimas en cada método. Los promedios se toman
    // solo en las filas donde están todos los métodos, para que comparen las mismas instancias.
    const completas = filas.filter((f) => f.celdas.slice(0, metodos.length).every((c) => c.s));
    const rotuloPromedio = completas.length === filas.length
      ? 'Promedio'
      : el('span', { title: 'Solo las instancias que tienen resultados de todos los métodos' }, `Promedio (${completas.length} de ${filas.length})`);
    const pie = [
      el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, rotuloPromedio), metodos.flatMap((_, k) => {
        const conValor = completas.map((f) => f.celdas[k].s);
        const t = media(conValor.map((s) => s.segundos).filter((x) => x != null));
        const o = media(conValor.map((s) => s.objetivo));
        return [el('td', {}, t == null ? '—' : segundos(t)), el('td', { class: 'rend-comp__fo' }, o == null ? '—' : fmt(o))];
      })),
      el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, 'Sobre la mejor'), metodos.map((_, k) => {
        const d = media(completas.map((f) => f.celdas[k].s.desviacion).filter((x) => x != null));
        return el('td', { colspan: 2, class: 'rend-comp__conteo' }, d == null ? '—' : textoDesviacion(d));
      })),
      el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, 'Llega a la mejor'), metodos.map((_, k) => {
        const conValor = filas.map((f) => f.celdas[k].s).filter(Boolean);
        return el('td', { colspan: 2, class: 'rend-comp__conteo' },
          conValor.length ? `${conValor.filter(enLaMejor).length} de ${conValor.length}` : '—');
      })),
      // Optimalidad probada: solo la informa Gurobi
      hayGurobi ? el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, 'Óptimos probados'), metodos.map((m, k) => {
        if (m.clave !== 'gurobi') return el('td', { colspan: 2 });
        const conValor = filas.map((f) => f.celdas[k]).filter((c) => c.s);
        return el('td', { colspan: 2, class: 'rend-comp__conteo' },
          conValor.length ? `${conValor.filter((c) => c.optimo).length} de ${conValor.length}` : '—');
      })) : null,
    ];

    const tabla = el('table', { class: 'tabla rend-comp__tabla' },
      el('colgroup', {}, el('col', { span: 2 }), metodos.map(() => el('col', { span: 2, class: 'rend-comp__metodo' }))),
      el('thead', {},
        el('tr', {},
          el('th', { scope: 'col', rowspan: 2, class: 'rend-comp__fija rend-comp__id' }, 'ID'),
          el('th', { scope: 'col', rowspan: 2, class: 'rend-comp__fija rend-comp__h' }, 'h'),
          metodos.map((m) => el('th', { scope: 'colgroup', colspan: 2, class: 'rend-comp__grupo' },
            m.titulo, m.clave === 'gurobi' ? el('span', { class: 'rend-comp__variante' }, textoGurobi) : null))),
        el('tr', {}, metodos.flatMap(() => [
          el('th', { scope: 'col', title: 'Tiempo de ejecución en segundos' }, 'Tiempo'),
          el('th', { scope: 'col', class: 'rend-comp__fo', html: 'Σ D<sub>i</sub>' }),
        ]))),
      el('tbody', {}, filas.map((f) => el('tr', { class: f.instancia.nombre === mostrada.instancia.nombre ? 'resaltado' : '' },
        el('td', { class: 'rend-comp__fija rend-comp__id' }, String(f.instancia.id ?? '—')),
        el('td', { class: 'rend-comp__fija rend-comp__h' }, f.instancia.h == null ? '—' : fmt(f.instancia.h)),
        celdasFila(f)))),
      el('tfoot', {}, pie));

    tarjeta.replaceChildren(
      el('h3', { class: 'tarjeta__titulo', id: 'rend-comp-titulo' },
        `Comparación por instancia · ${grupo}`, h === 'todos' ? null : el('span', { class: 'rend-comp__h-titulo' }, ` · h = ${fmt(h)}`)),
      el('p', {
        class: 'rend-bajada',
        html: 'Tiempo de ejecución (en segundos) y función objetivo de cada método en cada instancia. '
          + 'En las heurísticas y metaheurísticas, el porcentaje es cuánto queda Σ D<sub>i</sub> sobre la <strong>mejor solución conocida</strong> de la instancia, '
          + 'la menor entre todos los métodos y las cuatro variantes de Gurobi; 0 % es que la alcanza. '
          + 'En Gurobi, <strong>ópt.</strong> es óptimo probado (estado OPTIMAL) y <strong>c.s.</strong> una cota superior: la mejor solución entera al alcanzar el límite de tiempo. '
          + 'En negrita, los valores que alcanzan la mejor solución conocida; clic en un valor para abrir esa solución.'
          + (hayHeuristicas ? '' : ` Todavía no hay corridas de las heurísticas para ${grupo}: <code>npm run heuristicas -- ${mostrada.instancia.n}</code>.`),
      }),
      controles,
      el('div', { class: 'tabla-desplazable' }, tabla));
  }
}
