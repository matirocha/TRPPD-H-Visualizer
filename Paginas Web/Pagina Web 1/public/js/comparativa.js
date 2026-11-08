// Bajo el resumen de la sección Rendimiento, dos tarjetas con los resultados del Excel de
// resúmenes (Outputs/resumenes/gurobi_resultados.xlsx, recalculados en lib/resultados.js):
//
// 1. Comparación por instancia: una fila por instancia del n elegido, con la BKS (mejor solución
//    conocida), Gurobi (tiempo, cota superior, GAP y GAP sol. entera de la variante elegida o la
//    mejor de las 4) y cada heurística (tiempo promedio de sus réplicas y su mejor costo o su
//    costo promedio, con cuánto queda sobre la BKS). Selectores de n, h, variante de Gurobi y
//    costo de las heurísticas; el pie da promedios y cuántas instancias alcanzan la BKS.
// 2. Tiempo de ejecución según n (escalamiento.js), con la variante de Gurobi y el h de la tabla.
import { segundos } from './comparacion.js';
import { graficoTiempos } from './escalamiento.js';
import { VARIANTES, el, fmt } from './util.js';

export const HEURISTICAS = [
  { clave: 'dos_fases', titulo: 'Heurística 2 fases', corto: '2 fases' },
  { clave: 'ils_exacto', titulo: 'ILS exacto', corto: 'ILS exacto' },
  { clave: 'ils_heuristico', titulo: 'ILS heurístico', corto: 'ILS heurístico' },
  { clave: 'its_exacto', titulo: 'ITS exacto', corto: 'ITS exacto' },
  { clave: 'its_heuristico', titulo: 'ITS heurístico', corto: 'ITS heurístico' },
];
const OPCIONES_GUROBI = [{ clave: 'mejor', texto: 'Mejor de las 4' }, ...VARIANTES.map((v) => ({ clave: v.clave, texto: v.etiqueta }))];
const OPCIONES_COSTO = [{ clave: 'mejor', texto: 'Mejor réplica' }, { clave: 'promedio', texto: 'Promedio de las réplicas' }];
const ETIQUETA_VARIANTE = Object.fromEntries(VARIANTES.map((v) => [v.clave, v.etiqueta]));

// Mismo criterio del Excel: un costo alcanza la BKS si queda a 1E-6 relativo o menos
const TOL = 1e-6;
const alcanza = (gap) => gap != null && gap <= TOL;
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (g) => (g == null ? '—' : `${fmt(g * 100, 2)} %`);
const sobreBks = (g) => (g == null ? '—' : g <= TOL ? '0 %' : g < 5e-5 ? '+<0,01 %' : `+${fmt(g * 100, 2)} %`);
const claveGrupo = (g) => `${g.banco}|${g.n}`;

/**
 * Corrida de Gurobi de una fila: la variante pedida o, con 'mejor', la de menor cota superior;
 * a igual cota, la que probó optimalidad y después la más rápida (como en la sección Heurísticas).
 */
export function gurobiDe(fila, variante) {
  if (variante !== 'mejor') return fila.gurobi[variante] ? { clave: variante, ...fila.gurobi[variante] } : null;
  return Object.entries(fila.gurobi).map(([clave, g]) => ({ clave, ...g })).sort((a, b) =>
    (Math.abs(a.costo - b.costo) > TOL * b.costo ? a.costo - b.costo : 0)
    || (b.estado === 'OPTIMAL') - (a.estado === 'OPTIMAL')
    || (a.segundos ?? Infinity) - (b.segundos ?? Infinity))[0] ?? null;
}

/** Nombre legible de cada método que alcanza la BKS (origen del Excel). */
function textoOrigen(origen) {
  return origen.map((o) => (o.startsWith('gurobi:') ? `Gurobi ${ETIQUETA_VARIANTE[o.slice(7)]}` : HEURISTICAS.find((h) => h.clave === o)?.corto ?? o)).join(', ');
}

/** Fila de botones: etiqueta y un segmentado; elegir(clave) se llama al cambiar. */
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
 * opciones: resultados ({instancias} de lib/resultados.js o null), mostrada (salida del manifest),
 * actual (archivo), elegir(archivo) y preferencias {grupo, grupoMostrada, h, variante, costo}, que se
 * modifican al cambiar los selectores para conservarlos entre renders.
 * Devuelve {nodo: [tarjetas], destruir}.
 */
export function tablaComparativa({ resultados, mostrada, actual, elegir, preferencias: p }) {
  const instancias = resultados?.instancias ?? [];
  if (!instancias.length) {
    return el('article', { class: 'tarjeta rend-tarjeta rend-comp' },
      el('h3', { class: 'tarjeta__titulo' }, 'Comparación por instancia'),
      el('p', {
        class: 'rend-bajada',
        html: 'No se pudieron leer los resultados por instancia. La página los calcula desde <code>Outputs/gurobi</code> y '
          + '<code>Outputs/resumenes/heuristicas_replicas.csv</code> (<code>/api/resultados</code> con <code>npm start</code>, o '
          + '<code>datos/resultados.json</code> en la versión exportada).',
      }));
  }

  // n y banco disponibles; si un n tuviera los dos bancos, el botón los distingue
  const grupos = [...new Map(instancias.map((f) => [claveGrupo(f), { n: f.n, banco: f.banco }])).values()];
  const repetido = (g) => grupos.filter((x) => x.n === g.n).length > 1;
  // La tabla sigue al n de la solución mostrada hasta que se elige otro; al mostrar otro n, vuelve a seguirla
  const deMostrada = claveGrupo(mostrada.instancia);
  if (p.grupoMostrada !== deMostrada) {
    p.grupo = null;
    p.grupoMostrada = deMostrada;
  }

  const tarjeta = el('article', { class: 'tarjeta rend-tarjeta rend-tarjeta--tabla rend-comp', 'aria-labelledby': 'rend-comp-titulo' });
  const grafico = graficoTiempos({ instancias, heuristicas: HEURISTICAS, gurobiDe });
  pintar();
  return { nodo: [tarjeta, grafico.nodo], destruir: () => grafico.destruir() };

  function pintar() {
    const grupo = grupos.find((g) => claveGrupo(g) === p.grupo)
      ?? grupos.find((g) => claveGrupo(g) === deMostrada)
      ?? grupos.find((g) => g.n === mostrada.instancia.n)
      ?? grupos[0];
    const todas = instancias.filter((f) => f.n === grupo.n && f.banco === grupo.banco)
      .sort((a, b) => a.id - b.id || a.h - b.h);
    // Valores de h del grupo; si el elegido no existe en este n, se muestran todos
    const valoresH = [...new Set(todas.map((f) => f.h))].sort((a, b) => a - b);
    if (p.h !== 'todos' && !valoresH.includes(p.h)) p.h = 'todos';
    const filas = p.h === 'todos' ? todas : todas.filter((f) => f.h === p.h);
    const textoGrupo = `n = ${grupo.n} · banco ${grupo.banco}`;
    const textoGurobi = OPCIONES_GUROBI.find((o) => o.clave === p.variante)?.texto ?? '';
    const conMejor = p.costo === 'mejor';
    const rehacer = (cambio) => (v) => {
      cambio(v);
      pintar();
    };

    const controles = el('div', { class: 'rend-comp__controles' },
      selector('n', 'Número de clientes de la tabla', grupos.map((g) => ({ clave: claveGrupo(g), texto: repetido(g) ? `${g.n} · ${g.banco}` : String(g.n) })),
        claveGrupo(grupo), rehacer((v) => { p.grupo = v; }), ' rend-comp__minuscula'),
      valoresH.length > 1 ? selector('h', 'Valor de h en la tabla',
        [{ clave: 'todos', texto: 'Todos' }, ...valoresH.map((v) => ({ clave: v, texto: fmt(v) }))], p.h, rehacer((v) => { p.h = v; }), ' rend-comp__minuscula') : null,
      selector('Gurobi', 'Variante de Gurobi en la tabla y el gráfico', OPCIONES_GUROBI, p.variante, rehacer((v) => { p.variante = v; })),
      selector('Heurísticas', 'Costo de las heurísticas en la tabla', OPCIONES_COSTO, p.costo, rehacer((v) => { p.costo = v; })));

    // --- Cuerpo -------------------------------------------------------------------
    const esActual = (archivo) => archivo != null && archivo === actual;
    const abrir = (archivo, texto, titulo, mejor) => (archivo
      ? el('button', {
        type: 'button', class: `rend-comp__abrir${mejor ? ' rend-comp__mejor' : ''}`, title: titulo,
        onclick: () => archivo !== actual && elegir(archivo),
      }, texto)
      : el('span', { class: mejor ? 'rend-comp__mejor' : null }, texto));
    const vacias = (k) => Array.from({ length: k }, (_, i) => el('td', { class: `rend-comp__vacia${i === 0 ? ' rend-comp__inicio' : ''}` }, '—'));

    const celdasGurobi = (f) => {
      const g = gurobiDe(f, p.variante);
      if (!g) return vacias(4);
      const optimo = g.estado === 'OPTIMAL';
      const clase = esActual(g.archivo) ? ' rend-comp__actual' : '';
      const variante = ETIQUETA_VARIANTE[g.clave];
      return [
        el('td', { class: `rend-comp__tiempo rend-comp__inicio${clase}`, title: `${variante} · ${fmt(g.nodos, 0)} nodos B&B` }, segundos(g.segundos)),
        el('td', { class: `rend-comp__fo${clase}` },
          abrir(g.archivo, fmt(g.costo), `Abrir Gurobi ${variante} en ${f.nombre} · cota inferior ${fmt(g.cota)}`, alcanza(g.gapEntera)),
          el('span', {
            class: `rend-comp__marca rend-comp__marca--${optimo ? 'opt' : 'cs'}`,
            title: optimo ? 'Óptimo probado' : 'Cota superior: mejor solución entera al llegar al límite de tiempo',
          }, optimo ? 'ópt.' : 'c.s.')),
        el('td', { class: `rend-comp__gap${clase}` }, pct(g.gap)),
        el('td', { class: `rend-comp__gap${alcanza(g.gapEntera) ? ' rend-comp__mejor' : ''}${clase}` }, sobreBks(g.gapEntera)),
      ];
    };

    const celdasHeuristica = (f, m) => {
      const r = f.heuristicas[m.clave];
      if (!r) return vacias(2);
      const costo = conMejor ? r.mejor : r.promedio;
      const gap = conMejor ? r.gapMejor : r.gapPromedio;
      const clase = conMejor && esActual(r.archivo) ? ' rend-comp__actual' : '';
      const porIteracion = r.segundosIteracion != null ? ` · ${fmt(r.segundosIteracion, 6)} s por iteración` : '';
      return [
        el('td', { class: `rend-comp__tiempo rend-comp__inicio${clase}`, title: `Promedio de ${r.replicas} réplicas${porIteracion}` }, segundos(r.segundos)),
        el('td', { class: `rend-comp__fo${clase}` },
          conMejor
            ? abrir(r.archivo, fmt(costo), `Abrir la mejor réplica de ${m.titulo} en ${f.nombre}`, alcanza(gap))
            : el('span', { class: alcanza(gap) ? 'rend-comp__mejor' : null, title: `Promedio de ${r.replicas} réplicas; la mejor da ${fmt(r.mejor)}` }, fmt(costo)),
          el('span', {
            class: `rend-comp__marca rend-comp__marca--desv${alcanza(gap) ? ' rend-comp__marca--cero' : ''}`,
            title: alcanza(gap) ? 'Alcanza la BKS' : 'Sobre la BKS de la instancia',
          }, sobreBks(gap))),
      ];
    };

    const cuerpo = filas.map((f) => el('tr', { class: f.nombre === mostrada.instancia.nombre ? 'resaltado' : '' },
      el('td', { class: 'rend-comp__fija rend-comp__id' }, String(f.id)),
      el('td', { class: 'rend-comp__fija rend-comp__h' }, fmt(f.h)),
      el('td', { class: 'rend-comp__bks', title: `Alcanzada por ${textoOrigen(f.origen)}` }, fmt(f.bks)),
      celdasGurobi(f),
      HEURISTICAS.flatMap((m) => celdasHeuristica(f, m))));

    // --- Pie: promedios de cada columna y cuántas instancias alcanzan la BKS ------------
    const promedio = (valores) => media(valores.filter((x) => x != null));
    const corridasGurobi = filas.map((f) => gurobiDe(f, p.variante)).filter(Boolean);
    const conteo = (lista, prueba) => (lista.length ? `${lista.filter(prueba).length} de ${lista.length}` : '—');
    const textoSeg = (x) => (x == null ? '—' : segundos(x));
    const textoNum = (x) => (x == null ? '—' : fmt(x));
    const rotulo = (texto, titulo) => el('th', { scope: 'row', colspan: 2, class: 'rend-comp__fija rend-comp__pie-rotulo', title: titulo }, texto);
    const pie = [
      el('tr', {}, rotulo('Promedio', `Promedio de las ${filas.length} instancias de la tabla`),
        el('td', { class: 'rend-comp__bks' }, textoNum(promedio(filas.map((f) => f.bks)))),
        el('td', { class: 'rend-comp__inicio' }, textoSeg(promedio(corridasGurobi.map((g) => g.segundos)))),
        el('td', { class: 'rend-comp__fo' }, textoNum(promedio(corridasGurobi.map((g) => g.costo)))),
        el('td', { class: 'rend-comp__gap' }, pct(promedio(corridasGurobi.map((g) => g.gap)))),
        el('td', { class: 'rend-comp__gap' }, sobreBks(promedio(corridasGurobi.map((g) => g.gapEntera)))),
        HEURISTICAS.flatMap((m) => {
          const rs = filas.map((f) => f.heuristicas[m.clave]).filter(Boolean);
          const gap = promedio(rs.map((r) => (conMejor ? r.gapMejor : r.gapPromedio)));
          return [
            el('td', { class: 'rend-comp__inicio' }, textoSeg(promedio(rs.map((r) => r.segundos)))),
            el('td', { class: 'rend-comp__fo' }, textoNum(promedio(rs.map((r) => (conMejor ? r.mejor : r.promedio)))),
              rs.length ? el('span', { class: 'rend-comp__marca rend-comp__marca--desv' }, sobreBks(gap)) : null),
          ];
        })),
      el('tr', {}, rotulo('Alcanza la BKS', conMejor
        ? 'Instancias en que el método llega a la BKS: Gurobi con su cota superior y las heurísticas con su mejor réplica'
        : 'Instancias en que el método llega a la BKS: Gurobi con su cota superior y las heurísticas en todas sus réplicas (costo promedio = BKS)'),
      el('td'),
      el('td', { colspan: 4, class: 'rend-comp__conteo rend-comp__inicio' }, conteo(corridasGurobi, (g) => alcanza(g.gapEntera))),
      HEURISTICAS.map((m) => el('td', { colspan: 2, class: 'rend-comp__conteo rend-comp__inicio' },
        conteo(filas.map((f) => f.heuristicas[m.clave]).filter(Boolean), (r) => alcanza(conMejor ? r.gapMejor : r.gapPromedio))))),
      el('tr', {}, rotulo('Óptimos probados', 'Instancias en que Gurobi termina con estado OPTIMAL'),
        el('td'),
        el('td', { colspan: 4, class: 'rend-comp__conteo rend-comp__inicio' }, conteo(corridasGurobi, (g) => g.estado === 'OPTIMAL')),
        HEURISTICAS.map(() => el('td', { colspan: 2, class: 'rend-comp__inicio' }))),
    ];

    const tabla = el('table', { class: 'tabla rend-comp__tabla' },
      el('thead', {},
        el('tr', {},
          el('th', { scope: 'col', rowspan: 2, class: 'rend-comp__fija rend-comp__id' }, 'ID'),
          el('th', { scope: 'col', rowspan: 2, class: 'rend-comp__fija rend-comp__h' }, 'h'),
          el('th', { scope: 'col', rowspan: 2, class: 'rend-comp__bks', title: 'Mejor solución conocida: menor Σ Dᵢ entre la cota superior de las 4 variantes de Gurobi y el mejor costo de las 5 heurísticas' }, 'BKS'),
          el('th', { scope: 'colgroup', colspan: 4, class: 'rend-comp__grupo rend-comp__inicio' },
            'Gurobi', el('span', { class: 'rend-comp__variante' }, textoGurobi)),
          HEURISTICAS.map((m) => el('th', { scope: 'colgroup', colspan: 2, class: 'rend-comp__grupo rend-comp__inicio' },
            m.titulo, el('span', { class: 'rend-comp__variante' }, conMejor ? 'mejor réplica' : 'promedio de réplicas')))),
        el('tr', {},
          el('th', { scope: 'col', class: 'rend-comp__inicio', title: 'Tiempo de resolución en segundos (Runtime)' }, 'Tiempo'),
          el('th', { scope: 'col', class: 'rend-comp__fo', title: 'Valor de la mejor solución entera (ObjVal)' }, 'Cota sup.'),
          el('th', { scope: 'col', title: '(cota superior − cota inferior) / cota superior' }, 'GAP'),
          el('th', { scope: 'col', title: '(cota superior − BKS) / BKS' }, 'GAP sol. entera'),
          HEURISTICAS.flatMap(() => [
            el('th', { scope: 'col', class: 'rend-comp__inicio', title: 'Tiempo promedio de las réplicas, en segundos' }, 'Tiempo prom.'),
            el('th', { scope: 'col', class: 'rend-comp__fo', title: conMejor ? 'Menor Σ Dᵢ de las réplicas y cuánto queda sobre la BKS' : 'Σ Dᵢ promedio de las réplicas y cuánto queda sobre la BKS' },
              conMejor ? 'Mejor costo' : 'Costo prom.'),
          ]))),
      el('tbody', {}, cuerpo),
      el('tfoot', {}, pie));

    const replicas = Math.max(0, ...filas.flatMap((f) => Object.values(f.heuristicas).map((r) => r.replicas)));
    tarjeta.replaceChildren(
      el('h3', { class: 'tarjeta__titulo', id: 'rend-comp-titulo' },
        `Comparación por instancia · ${textoGrupo}`, p.h === 'todos' ? null : el('span', { class: 'rend-comp__minuscula' }, ` · h = ${fmt(p.h)}`)),
      el('p', {
        class: 'rend-bajada',
        html: 'Los resultados de la hoja Resultados de <code>gurobi_resultados.xlsx</code>. '
          + 'La <strong>BKS</strong> es la mejor solución conocida de la instancia: la menor entre la cota superior de las 4 variantes de Gurobi y el mejor costo de las 5 heurísticas. '
          + 'En Gurobi (límite de 3 600 s), <strong>ópt.</strong> es óptimo probado y <strong>c.s.</strong> la cota superior al llegar al límite; '
          + 'el <strong>GAP</strong> es (cota superior − cota inferior) / cota superior y el <strong>GAP sol. entera</strong>, (cota superior − BKS) / BKS. '
          + `En las heurísticas, con ${replicas || 10} réplicas cada una, el tiempo es el promedio de las réplicas y el porcentaje, cuánto queda el costo sobre la BKS. `
          + 'En negrita, los valores que alcanzan la BKS; clic en un valor para abrir esa solución.',
      }),
      controles,
      el('div', { class: 'tabla-desplazable' }, tabla));

    grafico.pintar({ variante: p.variante, textoVariante: textoGurobi, h: p.h, grupo });
  }
}
