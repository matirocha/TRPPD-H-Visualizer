// Tabla comparativa de la sección Rendimiento: una fila por instancia del mismo banco y n
// y, por cada método, dos columnas: tiempo de ejecución y Σ D_i. Cada Σ D_i lleva una marca:
//   ópt.  óptimo probado: Gurobi terminó con estado OPTIMAL, o el método llega a ese valor
//   c.s.  cota superior: solución entera sin optimalidad probada (Gurobi por límite de
//         tiempo, o una heurística que no alcanza el óptimo conocido)
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

const alcanza = (v, z) => v <= z + 1e-6 * Math.max(1, Math.abs(z));
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Una fila por instancia: la salida de cada método, si es óptima y el menor Σ D de la fila. */
function filasDe(manifest, mostrada, variante) {
  const porInstancia = new Map();
  for (const s of manifest) {
    if (!serieDe(s) || !mismoGrupo(s, mostrada)) continue;
    porInstancia.set(s.instancia.nombre, [...(porInstancia.get(s.instancia.nombre) ?? []), s]);
  }
  return [...porInstancia.values()].map((salidas) => {
    const gurobi = salidas.filter((s) => serieDe(s) === 'gurobi');
    const probados = gurobi.filter((s) => s.estado === 'OPTIMAL' && s.objetivo != null);
    const optimo = probados.length ? Math.min(...probados.map((s) => s.objetivo)) : null;
    const celdas = METODOS.map((m) => {
      const s = m.clave !== 'gurobi'
        ? salidas.find((x) => serieDe(x) === m.clave)
        : variante === 'mejor' ? representante(gurobi) : gurobi.find((g) => claveVariante(g.algoritmo.variante) === variante);
      if (s?.objetivo == null) return { s: null };
      return { s, optimo: m.clave === 'gurobi' ? s.estado === 'OPTIMAL' : optimo != null && alcanza(s.objetivo, optimo) };
    });
    const valores = celdas.filter((c) => c.s).map((c) => c.s.objetivo);
    return { instancia: salidas[0].instancia, celdas, menor: valores.length ? Math.min(...valores) : null };
  }).sort((a, b) => a.instancia.id - b.instancia.id || a.instancia.h - b.instancia.h);
}

/**
 * opciones: manifest, mostrada (salida del manifest), actual (archivo), elegir(archivo),
 * variante ('mejor' o clave de VARIANTES) y alCambiarVariante(clave) para recordarla.
 */
export function tablaComparativa(opciones) {
  const { manifest, mostrada, actual, elegir, alCambiarVariante } = opciones;
  let variante = opciones.variante;
  const grupo = `n = ${mostrada.instancia.n} · banco ${mostrada.instancia.banco}`;
  const tarjeta = el('article', { class: 'tarjeta rend-tarjeta rend-tarjeta--tabla rend-comp', 'aria-labelledby': 'rend-comp-titulo' });
  pintar();
  return tarjeta;

  function pintar() {
    const filas = filasDe(manifest, mostrada, variante);
    const hayGurobi = manifest.some((s) => serieDe(s) === 'gurobi' && mismoGrupo(s, mostrada));
    const metodos = METODOS.filter((m) => m.clave !== 'gurobi' || hayGurobi);
    const hayHeuristicas = filas.some((f) => f.celdas.slice(0, -1).some((c) => c.s));
    const textoGurobi = OPCIONES_GUROBI.find((o) => o.clave === variante)?.texto ?? '';

    const control = hayGurobi ? el('div', { class: 'rend-control' },
      el('span', { class: 'rend-control__etiqueta' }, 'Gurobi'),
      el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Variante de Gurobi en la tabla' },
        OPCIONES_GUROBI.map((o) => el('button', {
          type: 'button', 'aria-pressed': String(o.clave === variante),
          onclick: () => {
            if (o.clave === variante) return;
            variante = o.clave;
            alCambiarVariante(o.clave);
            pintar();
          },
        }, o.texto)))) : null;

    const marca = (optimo) => el('span', {
      class: `rend-comp__marca rend-comp__marca--${optimo ? 'opt' : 'cs'}`,
      title: optimo ? 'Óptimo probado' : 'Cota superior: solución entera sin optimalidad probada',
    }, optimo ? 'ópt.' : 'c.s.');

    const celdasFila = (f) => f.celdas.slice(0, metodos.length).flatMap(({ s, optimo }) => {
      if (!s) return [el('td', { class: 'rend-comp__vacia' }, '—'), el('td', { class: 'rend-comp__vacia rend-comp__fo' }, '—')];
      const mejor = alcanza(s.objetivo, f.menor);
      const esActual = s.archivo === actual;
      return [
        el('td', { class: `rend-comp__tiempo${esActual ? ' rend-comp__actual' : ''}` }, segundos(s.segundos)),
        el('td', { class: `rend-comp__fo${esActual ? ' rend-comp__actual' : ''}` },
          el('button', {
            type: 'button', class: `rend-comp__abrir${mejor ? ' rend-comp__mejor' : ''}`,
            title: `Abrir ${s.algoritmo.nombre} en ${s.instancia.nombre}`,
            onclick: () => s.archivo !== actual && elegir(s.archivo),
          }, fmt(s.objetivo)),
          marca(optimo)),
      ];
    });

    // Pie: promedios y cuántas instancias son óptimas en cada método
    const pie = [
      el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, 'Promedio'), metodos.flatMap((_, k) => {
        const conValor = filas.map((f) => f.celdas[k].s).filter(Boolean);
        const t = media(conValor.map((s) => s.segundos).filter((x) => x != null));
        const o = media(conValor.map((s) => s.objetivo));
        return [el('td', {}, t == null ? '—' : segundos(t)), el('td', { class: 'rend-comp__fo' }, o == null ? '—' : fmt(o))];
      })),
      el('tr', {}, el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija' }, 'Óptimos'), metodos.map((_, k) => {
        const conValor = filas.map((f) => f.celdas[k]).filter((c) => c.s);
        return el('td', { colspan: 2, class: 'rend-comp__conteo' },
          conValor.length ? `${conValor.filter((c) => c.optimo).length} de ${conValor.length}` : '—');
      })),
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
      el('h3', { class: 'tarjeta__titulo', id: 'rend-comp-titulo' }, `Comparación por instancia · ${grupo}`),
      el('p', {
        class: 'rend-bajada',
        html: 'Tiempo de ejecución (en segundos) y función objetivo de cada método en cada instancia. '
          + '<strong>ópt.</strong>: óptimo probado (Gurobi terminó con estado OPTIMAL, o el método llega a ese mismo valor). '
          + '<strong>c.s.</strong>: cota superior, una solución entera sin optimalidad probada (Gurobi al alcanzar el límite de tiempo, o una heurística que no llega al óptimo). '
          + 'En negrita, el menor Σ D<sub>i</sub> de la fila; clic en un valor para abrir esa solución.'
          + (hayHeuristicas ? '' : ` Todavía no hay corridas de las heurísticas para ${grupo}: <code>npm run heuristicas -- ${mostrada.instancia.n}</code>.`),
      }),
      control,
      el('div', { class: 'tabla-desplazable' }, tabla));
  }
}
