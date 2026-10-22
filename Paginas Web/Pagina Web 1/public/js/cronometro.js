// Sección 01 · Tiempo por cliente (bajo el mapa, junto a la carga).
//
// Una fila por cliente en el orden de la ruta con el tiempo de viaje c_ij, los
// cuatro tiempos de manipulación u_a, ℓ_a, u_b, ℓ_b, el tiempo en el cliente
// (F_i − T_i) y el total (viaje + cliente); al final, el regreso al depósito y
// las sumas. Sigue el reloj del modelo que publica la carga (estado.avance):
// cada celda muestra lo que lleva hasta ese instante, así se ve crecer el
// tiempo del cliente que se está atendiendo.
import { PARAMETROS, PARAMETRO_INFO } from './modelo.js';
import { PARAM_HTML, conTooltip, el, fmt, ocultarTooltip, politicaCorta } from './util.js';

const EPS = 1e-9;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const subIndice = (i, j) => (i > 9 || j > 9 ? `${i},${j}` : `${i}${j}`);

export function crear(raiz, estado) {
  let vista = null;
  let bajas = [];

  function render(sim) {
    destruir();
    if (!sim?.paradas?.length) return;
    vista = construir(sim, estado);
    raiz.append(vista.nodo);
    vista.pintar(estado.get('avance'));
    vista.resaltar(estado.get('hover'));
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
  const fila = (etiqueta, valor) => `<div class="tt-fila"><span>${etiqueta}</span><span>${valor}</span></div>`;
  return `<div class="tt-titulo">Cliente ${p.cliente} · parada ${p.k} · ${politicaCorta(p.politica)}</div>`
    + fila(`Viaje c<sub>${subIndice(p.desde, p.cliente)}</sub>`, `${fmt(p.salidaPrevia)} → ${fmt(p.T)} = ${fmt(p.c)}`)
    + '<div class="tt-sep"></div>'
    + PARAMETROS.map((q) => fila(`${PARAM_HTML[q]} · ${PARAMETRO_INFO[q].nombre.toLowerCase()}`,
      `${fmt(p.unidadesParam[q])} × ${fmt(p.tasa[q], 3)} = ${fmt(p.tiempoParam[q])}`)).join('')
    + '<div class="tt-sep"></div>'
    + fila(`Llegada T<sub>${p.cliente}</sub>`, fmt(p.T))
    + fila(`Entrega D<sub>${p.cliente}</sub>`, fmt(p.D))
    + fila(`Salida F<sub>${p.cliente}</sub>`, fmt(p.F))
    + fila(`En el cliente F<sub>${p.cliente}</sub> − T<sub>${p.cliente}</sub>`, fmt(p.servicio));
}

function construir(sim, estado) {
  const n = sim.paradas.length;
  const regreso = sim.arcos[n];
  const maxViaje = Math.max(EPS, ...sim.arcos.map((a) => a.c));
  const maxServicio = Math.max(EPS, ...sim.paradas.map((p) => p.servicio));

  // Celda con texto en caché: se escribe en el DOM solo cuando cambia.
  const celda = (clase = '') => {
    const texto = el('span', { class: 'crono-valor' });
    const nodo = el('td', { class: clase }, texto);
    return { nodo, texto, ultimo: null };
  };
  const escribir = (c, valor, { pendiente = false } = {}) => {
    const texto = pendiente ? '—' : fmt(valor);
    const clave = `${texto}|${!pendiente && Math.abs(valor) < EPS}`;
    if (clave === c.ultimo) return;
    c.ultimo = clave;
    c.texto.textContent = texto;
    c.nodo.classList.toggle('crono-celda--cero', !pendiente && Math.abs(valor) < EPS);
  };
  const barra = (color) => {
    const relleno = el('span', { class: 'crono-barra__relleno', style: { background: color } });
    return { nodo: el('span', { class: 'crono-barra', 'aria-hidden': 'true' }, relleno), relleno };
  };

  const filas = sim.paradas.map((p, k) => {
    const viaje = celda('crono-celda--viaje');
    const bViaje = barra('var(--viaje)');
    viaje.nodo.append(bViaje.nodo);
    const params = Object.fromEntries(PARAMETROS.map((q) => [q, celda()]));
    const servicio = celda('crono-celda--servicio');
    const segmentos = Object.fromEntries(PARAMETROS.map((q) => [q, el('span', { class: 'crono-pila__seg', style: { background: `var(--op-${q})` } })]));
    servicio.nodo.append(el('span', { class: 'crono-pila', 'aria-hidden': 'true' }, PARAMETROS.map((q) => segmentos[q])));
    const total = celda('crono-celda--total');
    const tr = el('tr', {
      class: `crono-fila crono-fila--p${p.politica === 1 ? 1 : 2}`,
      tabindex: 0,
      'aria-label': `Cliente ${p.cliente}, parada ${p.k}: ir a esta parada`,
      onpointerenter: () => estado.set({ hover: p.cliente }),
      onpointerleave: () => estado.set({ hover: null }),
      onclick: () => estado.set({ pedirParada: { indice: k } }),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          estado.set({ pedirParada: { indice: k } });
        }
      },
    },
    el('th', { scope: 'row', class: 'crono-parada' },
      el('span', { class: 'crono-orden num' }, `#${p.k}`),
      el('span', { class: `cliente-chip crono-chip${p.politica === 1 ? '' : ' cliente-chip--p2'}` }, String(p.cliente))),
    viaje.nodo, PARAMETROS.map((q) => params[q].nodo), servicio.nodo, total.nodo);
    conTooltip(tr, () => htmlCliente(p));
    return { p, k, tr, viaje, bViaje, params, servicio, segmentos, total, estado: '' };
  });

  // Regreso al depósito (solo viaje) y sumas de la ruta hasta el instante actual
  const rViaje = celda('crono-celda--viaje');
  const rTotal = celda('crono-celda--total');
  const rBarra = barra('var(--viaje)');
  rViaje.nodo.append(rBarra.nodo);
  const filaRegreso = el('tr', {
    class: 'crono-fila crono-fila--regreso', tabindex: 0, 'aria-label': 'Regreso al depósito: ir al final',
    onclick: () => estado.set({ pedirParada: { indice: n } }),
  },
  el('th', { scope: 'row', class: 'crono-parada' }, el('span', { class: 'crono-deposito', 'aria-hidden': 'true' }, '0'), 'Regreso'),
  rViaje.nodo, el('td', { colspan: PARAMETROS.length + 1, class: 'crono-nota' }, 'no pesa en Σ D'), rTotal.nodo);
  const sumas = { viaje: celda(), servicio: celda(), total: celda('crono-celda--total') };
  const sumasParam = Object.fromEntries(PARAMETROS.map((q) => [q, celda()]));
  const filaSumas = el('tr', { class: 'crono-sumas' },
    el('th', { scope: 'row' }, 'Σ ruta'),
    sumas.viaje.nodo, PARAMETROS.map((q) => sumasParam[q].nodo), sumas.servicio.nodo, sumas.total.nodo);

  const cabecera = (html, titulo, color) => el('th', { scope: 'col', title: titulo },
    color ? el('span', { class: 'crono-muestra', style: { background: color }, 'aria-hidden': 'true' }) : null,
    el('span', { html }));
  const tabla = el('table', { class: 'crono-tabla' },
    el('caption', { class: 'visualmente-oculto' }, 'Tiempo por cliente: viaje, manipulación y tiempo en el cliente hasta el instante actual'),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Parada'),
      cabecera('Viaje c<sub>ij</sub>', 'Tiempo de viaje desde la parada anterior', 'var(--viaje)'),
      PARAMETROS.map((q) => cabecera(PARAM_HTML[q], `${PARAMETRO_INFO[q].nombre}: ${PARAMETRO_INFO[q].detalle} × unidades`, `var(--op-${q})`)),
      cabecera('En el cliente', 'F_i − T_i: suma de los cuatro tiempos de manipulación'),
      cabecera('Total', 'Viaje + tiempo en el cliente'))),
    el('tbody', {}, filas.map((f) => f.tr), filaRegreso),
    el('tfoot', {}, filaSumas));
  const desplazable = el('div', { class: 'crono-desplazable' }, tabla);

  const instante = el('span', { class: 'crono-instante num' });
  const nodo = el('section', { class: 'crono', 'aria-label': 'Tiempo por cliente' },
    el('header', { class: 'crono-cabecera' },
      el('h3', { class: 'crono-titulo' }, 'Tiempo por cliente'),
      el('p', { class: 'crono-ayuda' }, 'Lo que lleva cada cliente hasta este instante: viaje + manipulación en el cliente.'),
      instante),
    desplazable);

  let filaVisible = null;

  function pintar(avance) {
    const t = avance?.reloj ?? 0;
    const actual = avance && (avance.viaje > 0 || avance.servicio > 0) ? avance.tramo : null;
    const acum = { viaje: 0, servicio: 0, ...Object.fromEntries(PARAMETROS.map((q) => [q, 0])) };

    for (const f of filas) {
      const { p } = f;
      const empezo = t > p.salidaPrevia + EPS;
      const llego = empezo && t >= p.T - EPS;
      const viaje = limitar(t - p.salidaPrevia, 0, p.c);
      const tiempos = Object.fromEntries(PARAMETROS.map((q) => [q, 0]));
      if (llego) for (const op of p.ops) tiempos[op.param] += limitar(t - op.inicio, 0, op.duracion);
      const servicio = llego ? limitar(t - p.T, 0, p.F - p.T) : 0;

      escribir(f.viaje, viaje, { pendiente: !empezo });
      f.bViaje.relleno.style.transform = `scaleX(${(viaje / maxViaje).toFixed(4)})`;
      for (const q of PARAMETROS) {
        escribir(f.params[q], tiempos[q], { pendiente: !llego });
        f.segmentos[q].style.width = `${((tiempos[q] / maxServicio) * 100).toFixed(2)}%`;
        acum[q] += tiempos[q];
      }
      escribir(f.servicio, servicio, { pendiente: !llego });
      escribir(f.total, viaje + servicio, { pendiente: !empezo });
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
    escribir(rViaje, vRegreso, { pendiente: !empezoRegreso });
    escribir(rTotal, vRegreso, { pendiente: !empezoRegreso });
    rBarra.relleno.style.transform = `scaleX(${(vRegreso / maxViaje).toFixed(4)})`;
    filaRegreso.dataset.estado = actual === n ? 'actual' : empezoRegreso ? 'hecha' : 'pendiente';
    acum.viaje += vRegreso;

    escribir(sumas.viaje, acum.viaje);
    for (const q of PARAMETROS) escribir(sumasParam[q], acum[q]);
    escribir(sumas.servicio, acum.servicio);
    escribir(sumas.total, acum.viaje + acum.servicio);
    const textoInstante = `t = ${fmt(t)} de ${fmt(sim.regreso)}`;
    if (instante.textContent !== textoInstante) instante.textContent = textoInstante;

    // Con muchas paradas la tabla tiene scroll propio: la fila actual queda a la vista.
    if (filaVisible && desplazable.scrollHeight > desplazable.clientHeight + 1) {
      const arriba = filaVisible.offsetTop - desplazable.clientHeight / 2 + filaVisible.offsetHeight / 2;
      desplazable.scrollTop = limitar(arriba, 0, desplazable.scrollHeight - desplazable.clientHeight);
      filaVisible = null;
    }
  }

  function resaltar(cliente) {
    for (const f of filas) f.tr.classList.toggle('crono-fila--resaltada', cliente != null && f.p.cliente === cliente);
  }

  return { nodo, pintar, resaltar };
}
