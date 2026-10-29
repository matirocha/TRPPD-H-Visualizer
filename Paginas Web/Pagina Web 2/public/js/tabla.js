// Tiempo por cliente (bajo el mapa).
//
// Una fila por cliente en el orden de la ruta: viaje c_ij, los cuatro tiempos
// de manipulación, tiempo en el cliente (F_i − T_i) y total; al final el
// regreso y las sumas. Sigue el reloj que publica la carga (estado.avance):
// cada celda muestra lo acumulado hasta ese instante.
import { PARAMETROS, PARAMETRO_INFO } from './modelo.js';
import { PARAM_HTML, conTooltip, el, filaTooltip, fmt, ocultarTooltip, politicaCorta, sub, subIndice } from './util.js';

const EPS = 1e-9;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

export function crear(raiz, estado) {
  let vista = null;
  let bajas = [];

  function render(sim) {
    destruir();
    if (!sim?.paradas?.length) return;
    vista = construir(sim, estado);
    raiz.append(vista.nodo);
    vista.pintar(estado.get('avance'));
    bajas = [
      estado.on('avance', (avance) => vista?.pintar(avance)),
      estado.on('hover', (cliente) => vista?.resaltar(cliente)),
    ];
  }

  function destruir() {
    for (const baja of bajas) baja();
    bajas = [];
    if (vista) ocultarTooltip();
    raiz.replaceChildren();
    vista = null;
  }

  return { render, destruir };
}

function htmlCliente(p) {
  return `<div class="tt-titulo">Cliente ${p.cliente} · parada ${p.k} · ${politicaCorta(p.politica)}</div>`
    + filaTooltip(`Viaje c<sub>${subIndice(p.desde, p.cliente)}</sub>`, fmt(p.c))
    + PARAMETROS.map((q) => filaTooltip(`${PARAM_HTML[q]} · ${PARAMETRO_INFO[q].nombre.toLowerCase()}`,
      `${fmt(p.unidadesParam[q])} × ${fmt(p.tasa[q], 3)} = ${fmt(p.tiempoParam[q])}`)).join('')
    + '<div class="tt-sep"></div>'
    + filaTooltip(`Llega ${sub('T', p.cliente)}`, fmt(p.T))
    + filaTooltip(`Atendido ${sub('D', p.cliente)}`, `<strong>${fmt(p.D)}</strong>`)
    + filaTooltip(`Sale ${sub('F', p.cliente)}`, fmt(p.F));
}

function construir(sim, estado) {
  const n = sim.paradas.length;
  const regreso = sim.arcos[n];

  // Celda con texto en caché: se escribe en el DOM solo cuando cambia.
  const celda = (clase = '') => {
    const nodo = el('td', { class: clase });
    return { nodo, ultimo: null };
  };
  const escribir = (c, valor, pendiente = false) => {
    const texto = pendiente ? '·' : fmt(valor);
    const clave = `${texto}|${pendiente}`;
    if (clave === c.ultimo) return;
    c.ultimo = clave;
    c.nodo.textContent = texto;
    c.nodo.classList.toggle('tabla-celda--cero', !pendiente && Math.abs(valor) < EPS);
  };
  const ir = (indice) => estado.set({ pedirParada: { indice } });

  const filas = sim.paradas.map((p, k) => {
    const viaje = celda();
    const params = Object.fromEntries(PARAMETROS.map((q) => [q, celda()]));
    const servicio = celda('tabla-celda--servicio');
    const total = celda('tabla-celda--total');
    const tr = el('tr', {
      class: 'tabla-fila',
      tabindex: 0,
      'aria-label': `Cliente ${p.cliente}, parada ${p.k}: ir a esta parada`,
      onpointerenter: () => estado.set({ hover: p.cliente }),
      onpointerleave: () => estado.set({ hover: null }),
      onclick: () => ir(k),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ir(k);
        }
      },
    },
    el('th', { scope: 'row' },
      el('span', { class: `chip-cliente chip-cliente--p${p.politica === 1 ? 1 : 2}` }, String(p.cliente))),
    viaje.nodo, PARAMETROS.map((q) => params[q].nodo), servicio.nodo, total.nodo);
    conTooltip(tr, () => htmlCliente(p));
    return { p, k, tr, viaje, params, servicio, total, estado: '' };
  });

  const rViaje = celda();
  const rTotal = celda('tabla-celda--total');
  const filaRegreso = el('tr', {
    class: 'tabla-fila tabla-fila--regreso', tabindex: 0, 'aria-label': 'Regreso al depósito: ir al final',
    onclick: () => ir(n),
  },
  el('th', { scope: 'row' }, el('span', { class: 'chip-cliente chip-cliente--deposito' }, '0')),
  rViaje.nodo, el('td', { colspan: PARAMETROS.length + 1, class: 'tabla-nota' }, 'regreso'), rTotal.nodo);

  const sumas = { viaje: celda(), servicio: celda(), total: celda('tabla-celda--total') };
  const sumasParam = Object.fromEntries(PARAMETROS.map((q) => [q, celda()]));
  const filaSumas = el('tr', {},
    el('th', { scope: 'row' }, 'Σ'),
    sumas.viaje.nodo, PARAMETROS.map((q) => sumasParam[q].nodo), sumas.servicio.nodo, sumas.total.nodo);

  const cabecera = (html, titulo, colorCss) => el('th', { scope: 'col', title: titulo },
    colorCss ? el('span', { class: 'punto', style: { background: colorCss }, 'aria-hidden': 'true' }) : null,
    el('span', { html }));
  const tabla = el('table', { class: 'tabla' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Cliente'),
      cabecera('Viaje', 'Tiempo de viaje c_ij desde la parada anterior', 'var(--viaje)'),
      PARAMETROS.map((q) => cabecera(PARAM_HTML[q], `${PARAMETRO_INFO[q].nombre}: ${PARAMETRO_INFO[q].detalle} × unidades`, `var(--op-${q})`)),
      cabecera('En cliente', 'F_i − T_i: suma de los cuatro tiempos de manipulación'),
      cabecera('Total', 'Viaje + tiempo en el cliente'))),
    el('tbody', {}, filas.map((f) => f.tr), filaRegreso),
    el('tfoot', {}, filaSumas));
  const desplazable = el('div', { class: 'tabla-desplazable' }, tabla);

  const instante = el('span', { class: 'tabla-instante num' });
  const nodo = el('section', { class: 'tabla-bloque', 'aria-label': 'Tiempo por cliente' },
    el('header', { class: 'bloque-cabecera' },
      el('h2', { class: 'bloque-titulo' }, 'Tiempo por cliente'),
      instante),
    desplazable);

  let filaVisible = null;

  function pintar(avance) {
    const t = avance?.reloj ?? 0;
    const actual = avance && (avance.viaje > 0 || avance.servicio > 0) ? avance.tramo : null;
    const acum = { viaje: 0, servicio: 0, ua: 0, la: 0, ub: 0, lb: 0 };

    for (const f of filas) {
      const { p } = f;
      const empezo = t > p.salidaPrevia + EPS;
      const llego = empezo && t >= p.T - EPS;
      const viaje = limitar(t - p.salidaPrevia, 0, p.c);
      const tiempos = { ua: 0, la: 0, ub: 0, lb: 0 };
      if (llego) for (const op of p.ops) tiempos[op.param] += limitar(t - op.inicio, 0, op.duracion);
      const servicio = llego ? limitar(t - p.T, 0, p.F - p.T) : 0;

      escribir(f.viaje, viaje, !empezo);
      for (const q of PARAMETROS) {
        escribir(f.params[q], tiempos[q], !llego);
        acum[q] += tiempos[q];
      }
      escribir(f.servicio, servicio, !llego);
      escribir(f.total, viaje + servicio, !empezo);
      acum.viaje += viaje;
      acum.servicio += servicio;

      const estadoFila = actual === f.k ? 'actual' : !empezo ? 'pendiente' : 'hecha';
      if (estadoFila !== f.estado) {
        f.estado = estadoFila;
        f.tr.dataset.estado = estadoFila;
        if (estadoFila === 'actual') filaVisible = f.tr;
      }
    }

    const vRegreso = limitar(t - regreso.inicio, 0, regreso.c);
    const empezoRegreso = t > regreso.inicio + EPS;
    escribir(rViaje, vRegreso, !empezoRegreso);
    escribir(rTotal, vRegreso, !empezoRegreso);
    filaRegreso.dataset.estado = actual === n ? 'actual' : empezoRegreso ? 'hecha' : 'pendiente';
    acum.viaje += vRegreso;

    escribir(sumas.viaje, acum.viaje);
    for (const q of PARAMETROS) escribir(sumasParam[q], acum[q]);
    escribir(sumas.servicio, acum.servicio);
    escribir(sumas.total, acum.viaje + acum.servicio);
    const texto = `t = ${fmt(t)}`;
    if (instante.textContent !== texto) instante.textContent = texto;

    // Con muchas paradas la tabla tiene scroll propio: la fila actual queda a la vista.
    if (filaVisible && desplazable.scrollHeight > desplazable.clientHeight + 1) {
      const caja = filaVisible.getBoundingClientRect();
      const arriba = desplazable.scrollTop + caja.top - desplazable.getBoundingClientRect().top - desplazable.clientHeight / 2 + caja.height / 2;
      desplazable.scrollTop = limitar(arriba, 0, desplazable.scrollHeight - desplazable.clientHeight);
      filaVisible = null;
    }
  }

  function resaltar(cliente) {
    for (const f of filas) f.tr.classList.toggle('es-resaltada', cliente != null && f.p.cliente === cliente);
  }

  return { nodo, pintar, resaltar };
}
