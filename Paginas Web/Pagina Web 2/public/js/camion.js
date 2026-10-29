// Carga del camión y reproductor del recorrido.
//
// Vista lateral del camión (cabina a la izquierda, puerta trasera a la derecha)
// con cada unidad en su ranura, y un panel que explica los pasos de la Tabla 3
// en la parada actual. Una sola línea de tiempo de GSAP anima viajes y
// operaciones; la mueve el reproductor (Iniciar / Pausar / Continuar): sin el
// modo continuo se detiene al final de cada paso y de cada parada; con él
// recorre la ruta sin parar. Con movimiento reducido salta de pausa en pausa.
//
// En cada actualización publica estado.avance (el mapa y la tabla lo siguen) y
// atiende estado.pedirParada (clics en el mapa o en la tabla).
import { OPERACIONES } from './modelo.js';
import { PARAM_HTML, POLITICA_TEXTO, color, conTooltip, el, filaTooltip, fmt, movimientoReducido, ocultarTooltip, sub, subIndice, svg } from './util.js';

// Duraciones de reproducción (no son tiempos del modelo), en segundos.
const DUR = { inicio: 0.4, viaje: 1, puerta: 0.3, op: 0.6, aparecer: 0.22, pausa: 0.25, fin: 0.5 };
const ESPERA_REDUCIDA = 2.5;   // movimiento reducido + continuo: segundos entre explicaciones
const ANTES = 1e-4;            // las pausas quedan justo antes del fin de su fase

// Geometría del dibujo, en unidades del viewBox.
const G = {
  ancho: 1100, alto: 270,
  suelo: 236, piso: 190, techo: 112,
  cajaX0: 150, cajaX1: 790,
  X0: 158, X1: 782,              // ranuras, del frente (F) a la puerta (R)
  andenX0: 800, andenX1: 1096,
  zonaX0: 828, zonaX1: 976,      // zona del andén donde esperan las unidades
  cubetaX0: 984, cubetaX1: 1036, cubetaAlto: 28,
  letreroX: 1066, letreroY: 92,
  ruedas: [86, 650, 702], radioRueda: 19,
};

const OP_POR_PASO = Object.fromEntries(Object.values(OPERACIONES).map((o) => [o.paso, o]));
let contador = 0;

// --- Utilidades -------------------------------------------------------------

const cSub = (j, i) => sub('c', subIndice(j, i));
const t3 = (x) => fmt(x, 3);
const nombreNodo = (i) => (i === 0 ? 'el depósito' : `el cliente ${i}`);
const unidades = (x) => `${fmt(x)} ${Math.abs(x - 1) < 1e-9 ? 'unidad' : 'unidades'}`;

function resumen(pila) {
  const c = { w: 0, y: 0, z: 0, total: 0 };
  for (const b of pila) c[b.tipo] += b.unidades;
  c.total = c.w + c.y + c.z;
  return c;
}

const entero = (x) => Math.abs(x - Math.round(x)) < 1e-6;
const prefijo = (b) => (b.tipo === 'y' ? 'y' : 'b');

/**
 * id de cada unidad -> {slot, tipo, cliente, unidades}, empaquetando desde el frente.
 * Con unidades: 'y-3-0', 'b-4-2'... una por ranura. Con segmentos: un bloque por
 * cliente ('y-3', 'b-4') y slot es la posición (en unidades) de su borde delantero.
 */
function mapaPila(pila, segmentos = false) {
  const mapa = new Map();
  let pos = 0;
  if (segmentos) {
    for (const b of pila) {
      mapa.set(`${prefijo(b)}-${b.cliente}`, { slot: pos, tipo: b.tipo, cliente: b.cliente, unidades: b.unidades });
      pos += b.unidades;
    }
    return mapa;
  }
  const vistos = new Map();
  for (const b of pila) {
    const base = `${prefijo(b)}-${b.cliente}`;
    let k = vistos.get(base) ?? 0;
    for (let j = 0; j < Math.round(b.unidades); j++) mapa.set(`${base}-${k++}`, { slot: pos++, tipo: b.tipo, cliente: b.cliente, unidades: 1 });
    vistos.set(base, k);
  }
  return mapa;
}

function geometria(sim) {
  const capacidad = Math.max(sim.Q, sim.cargaMaxima, 1e-6);
  const ranuras = Math.max(1, Math.ceil(capacidad - 1e-9));
  const largo = G.X1 - G.X0;
  // Muchas ranuras o cantidades fraccionarias: bloques proporcionales en vez de unidades.
  const segmentos = capacidad > 60 || sim.paradas.some((p) => !entero(p.alpha) || !entero(p.beta));
  const base = { segmentos, ranuras, capacidad, xAnden: G.andenX0 + 3 };
  const cubeta = (alto, ancho) => (j, a = ancho) => ({
    x: G.cubetaX0 + (G.cubetaX1 - G.cubetaX0 - a) / 2 + ((j % 3) - 1) * 3,
    y: G.piso - alto,
  });
  if (segmentos) {
    const paso = largo / capacidad;
    const alto = 54;
    const ancho = 46;
    return {
      ...base, paso, hueco: Math.min(1.6, paso * 0.3), ancho, alto, letra: 10.5, rotulos: true, radio: 4,
      yPiso: G.piso - alto,
      ranura: (s) => ({ x: G.X0 + s * paso + Math.min(1.6, paso * 0.3) / 2, y: G.piso - alto }),
      cubeta: cubeta(alto, ancho),
    };
  }
  const paso = largo / ranuras;
  const hueco = Math.min(3, paso * 0.16);
  const ancho = paso - hueco;
  const alto = Math.min(54, Math.max(14, paso * 2.3));
  const letra = Math.min(12, ancho * 0.62, alto * 0.4);
  return {
    ...base, paso, hueco, ancho, alto, letra,
    rotulos: letra >= 5.5,
    radio: Math.min(4, ancho * 0.22),
    yPiso: G.piso - alto,
    ranura: (s) => ({ x: G.X0 + s * paso + hueco / 2, y: G.piso - alto }),
    cubeta: cubeta(alto, ancho),
  };
}

function leerColores() {
  const blanco = '#ffffff';
  return { y: color('--a'), w: color('--b-fondo'), z: color('--b-puerta'), texto: { y: blanco, z: color('--tinta'), w: blanco } };
}

/** Celdas del andén para una parada: se llenan por filas desde la cubeta hacia la puerta. */
function crearAnden(geo, total) {
  const ancho = G.zonaX1 - G.zonaX0;
  const altoDisponible = G.piso - 14;
  let f = 1;
  let porFila = 1;
  for (let intento = 0; intento < 20; intento++) {
    porFila = Math.max(1, Math.floor((ancho + 3 * f) / ((geo.ancho + 3) * f)));
    if (Math.ceil(Math.max(total, 1) / porFila) * (geo.alto + 3) * f <= altoDisponible || f <= 0.3) break;
    f = Math.max(0.3, f - 0.05);
  }
  const cw = (geo.ancho + 3) * f;
  const ch = (geo.alto + 3) * f;
  let usadas = 0;
  return {
    tomar() {
      const fila = Math.floor(usadas / porFila);
      const col = usadas % porFila;
      usadas++;
      return { x: G.zonaX1 - (col + 1) * cw + 3 * f, y: G.piso - geo.alto * f - fila * ch, s: f };
    },
    yMin() {
      const filas = Math.max(1, Math.ceil(usadas / porFila));
      return G.piso - geo.alto * f - (filas - 1) * ch;
    },
  };
}

/** Cuántas unidades pasan por el andén en una parada (para dimensionar sus celdas). */
function contarAnden(p, segmentos) {
  let total = p.beta > 1e-9 ? (segmentos ? 1 : Math.round(p.beta)) : 0;
  for (const op of p.ops) {
    if (op.clave === 'descargar') continue;
    const despues = mapaPila(op.pilaDespues, segmentos);
    for (const id of mapaPila(op.pilaAntes, segmentos).keys()) if (!despues.has(id)) total++;
  }
  return total;
}

// --- Módulo -----------------------------------------------------------------

/** escena: bloque que se lleva a la vista al apretar Iniciar; controles: contenedor del reproductor. */
export function crear(raiz, estado, { escena, controles }) {
  let v = null;
  let ctx = null;
  let mm = null;
  let bajas = [];

  function render(sim, salida) {
    destruir();
    if (!sim?.paradas?.length || !window.gsap) return;
    v = prepararVista(sim, salida, estado);
    v.escena = escena;
    raiz.append(v.nodo);
    controles.append(v.reproductor);

    ctx = gsap.context(() => {}, raiz);
    mm = gsap.matchMedia(raiz);
    mm.add({ animado: '(prefers-reduced-motion: no-preference)', reducido: '(prefers-reduced-motion: reduce)' }, (contexto) => {
      const vista = v;
      montarLinea(vista, contexto.conditions.reducido ? 'reducido' : 'animado');
      return () => {
        detener(vista);
        vista.tl = null;
      };
    });

    const vista = v;
    bajas = [
      estado.on('hover', (c) => resaltar(vista, c)),
      estado.on('pedirParada', (pedido) => {
        if (pedido) irA(vista, pedido.indice);
      }),
      estado.on('modoContinuo', (continuo) => cambiarContinuo(vista, continuo)),
    ];
  }

  function destruir() {
    for (const baja of bajas) baja();
    bajas = [];
    if (v) detener(v);
    mm?.revert();
    mm = null;
    ctx?.revert();
    ctx = null;
    if (v) ocultarTooltip();
    raiz.replaceChildren();
    controles?.replaceChildren();
    v = null;
  }

  return { render, destruir };
}

// --- Construcción del DOM -----------------------------------------------------

function prepararVista(sim, salida, estado) {
  const v = {
    sim, salida, estado, n: sim.paradas.length,
    uid: ++contador,
    geo: geometria(sim),
    colores: leerColores(),
    fases: [], iFase: -1, kActual: null, andenActual: null,
    ultimaCarga: '', ultimoReloj: '', ultimoReproductor: '',
    tl: null, modo: null, reproduccion: null, reproduciendo: false, continuo: Boolean(estado.get('modoContinuo')),
    hist: new Map(), piezas: [], pausas: [],
  };

  // Estado actual: fase, texto y reloj del modelo
  v.faseNodo = el('span', { class: 'camion-estado__fase' }, 'Depósito');
  v.textoNodo = el('span', { class: 'camion-estado__texto' });
  v.relojNodo = el('span', { class: 'camion-estado__reloj num', title: 'Instante del modelo' }, 't = 0');
  const estadoNodo = el('div', { class: 'camion-estado' }, v.faseNodo, v.textoNodo, v.relojNodo);

  construirSVG(v);
  construirReproductor(v);
  construirPanel(v);

  const leyenda = el('ul', { class: 'camion-leyenda', 'aria-label': 'Leyenda de la carga' },
    el('li', {}, el('span', { class: 'muestra muestra--y' }), 'Entrega (y)'),
    el('li', {}, el('span', { class: 'muestra muestra--w' }), 'Recogida al fondo (w)'),
    el('li', {}, el('span', { class: 'muestra muestra--z' }), 'Recogida en la puerta (z)'),
    el('li', { class: 'camion-leyenda__nota' }, 'número = cliente'));

  v.nodo = el('div', { class: 'camion' },
    el('div', { class: 'camion-figura tarjeta' },
      el('header', { class: 'bloque-cabecera' }, el('h2', { class: 'bloque-titulo' }, 'Carga del camión'), v.medidor),
      estadoNodo,
      v.svgCamion,
      leyenda),
    v.panel);
  return v;
}

function construirSVG(v) {
  const { geo, sim } = v;

  // Calle: los trazos del carril se desplazan durante los viajes
  v.carril = svg('line', { class: 'camion-carril', x1: -40, y1: G.suelo + 12, x2: G.ancho + 40, y2: G.suelo + 12 });
  const calle = svg('g', { 'aria-hidden': 'true' },
    svg('rect', { class: 'camion-calle', x: 0, y: G.suelo, width: G.ancho, height: 24, rx: 4 }),
    v.carril);

  // Andén (detrás de las unidades) y frente de la cubeta (delante)
  const placa = G.letreroY;
  v.letrero = {};
  v.letrero.num = svg('text', { class: 'camion-letrero__num', x: G.letreroX, y: placa }, '0');
  v.letrero.nodo = svg('g', { class: 'camion-letrero camion-letrero--deposito' },
    svg('line', { class: 'camion-letrero__poste', x1: G.letreroX, y1: G.piso, x2: G.letreroX, y2: placa }),
    svg('circle', { class: 'camion-letrero__placa', cx: G.letreroX, cy: placa, r: 17 }),
    v.letrero.num);
  const andenFondo = svg('g', { class: 'camion-anden' },
    svg('rect', { class: 'camion-anden__base', x: G.andenX0, y: G.piso, width: G.andenX1 - G.andenX0, height: G.suelo - G.piso, rx: 4 }),
    v.letrero.nodo);
  v.cubetaRotulo = svg('text', { class: 'camion-cubeta__rotulo', x: (G.cubetaX0 + G.cubetaX1) / 2, y: G.piso - G.cubetaAlto / 2 }, '');
  const andenFrente = svg('g', { class: 'camion-anden' },
    svg('path', { class: 'camion-cubeta', d: `M${G.cubetaX0 - 4} ${G.piso - G.cubetaAlto} L${G.cubetaX1 + 4} ${G.piso - G.cubetaAlto} L${G.cubetaX1} ${G.piso} L${G.cubetaX0} ${G.piso} Z` }),
    v.cubetaRotulo);
  v.anden = [andenFondo, andenFrente];

  // Ranuras vacías (una por unidad, o una franja continua con segmentos)
  const ranuras = svg('g', { class: 'camion-ranuras' });
  if (geo.segmentos) {
    ranuras.append(svg('rect', { class: 'camion-ranura', x: geo.ranura(0).x, y: geo.yPiso, width: Math.max(1, sim.Q * geo.paso - geo.hueco), height: geo.alto, rx: geo.radio }));
  } else {
    for (let s = 0; s < geo.ranuras; s++) {
      const p = geo.ranura(s);
      ranuras.append(svg('rect', { class: 'camion-ranura', x: p.x, y: p.y, width: geo.ancho, height: geo.alto, rx: geo.radio }));
    }
  }
  v.capaUnidades = svg('g', { class: 'camion-unidades' });
  crearUnidades(v);

  const altoPuerta = G.piso - G.techo - 4;
  v.puerta = svg('rect', { class: 'camion-puerta', x: G.X1 + 1, y: G.techo + 4, width: 7, height: altoPuerta, rx: 2 });

  v.cuerpo = svg('g', {},
    svg('rect', { class: 'camion-chasis', x: 36, y: 198, width: 754, height: 9, rx: 3 }),
    svg('path', { class: 'camion-cabina', d: 'M144 207 L144 124 L92 124 Q78 124 71 135 L46 172 Q40 176 40 184 L40 200 Q40 207 47 207 Z' }),
    svg('path', { class: 'camion-ventana', d: 'M94 134 L134 134 L134 162 L66 162 L80 141 Q84 134 94 134 Z' }),
    svg('rect', { class: 'camion-faro', x: 40, y: 182, width: 7, height: 8, rx: 2 }),
    svg('rect', { class: 'camion-caja', x: G.cajaX0, y: G.techo, width: G.cajaX1 - G.cajaX0, height: G.piso - G.techo + 8, rx: 8 }),
    ranuras,
    v.capaUnidades,
    v.puerta,
    svg('text', { class: 'camion-rotulo', x: G.cajaX0 + 12, y: G.techo - 10 }, 'Frente'),
    svg('text', { class: 'camion-rotulo camion-rotulo--fin', x: G.cajaX1, y: G.techo - 10 }, `Puerta · Q = ${fmt(sim.Q)}`));

  v.ruedas = G.ruedas.map((cx) => {
    const cy = G.suelo - G.radioRueda;
    return svg('g', { class: 'camion-rueda' },
      svg('circle', { class: 'camion-rueda__llanta', cx, cy, r: G.radioRueda }),
      svg('circle', { class: 'camion-rueda__aro', cx, cy, r: 8 }),
      svg('line', { class: 'camion-rueda__rayo', x1: cx - 7, y1: cy, x2: cx + 7, y2: cy }));
  });

  v.svgCamion = svg('svg', {
    class: 'camion-svg', viewBox: `0 0 ${G.ancho} ${G.alto}`, preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': `Camión con ${fmt(sim.Q)} ranuras de carga`,
  },
  calle, andenFondo,
  svg('g', {}, v.cuerpo, v.ruedas),
  andenFrente);
}

function crearUnidades(v) {
  const { geo, sim } = v;
  v.unidades = [];
  v.porId = new Map();
  v.rotulosB = [];
  const crear = (id, pref, cliente, k, total, cantidad) => {
    // Con segmentos el bloque mide lo que ocupa a bordo y se compacta en el andén.
    const anchoAbordo = geo.segmentos ? Math.max(0.8, cantidad * geo.paso - geo.hueco) : geo.ancho;
    const anchoAnden = geo.segmentos ? Math.min(geo.ancho, Math.max(anchoAbordo, 10)) : geo.ancho;
    const minimo = Math.min(anchoAbordo, anchoAnden);
    const caja = svg('rect', { class: 'camion-u__caja', width: anchoAbordo, height: geo.alto, rx: Math.min(geo.radio, minimo * 0.22) });
    const textos = [];
    if (!geo.segmentos) {
      if (geo.rotulos) textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2, 'font-size': geo.letra.toFixed(1) }, String(cliente)));
    } else if (minimo >= 32) {
      textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2 - 7, 'font-size': '11' }, `${pref === 'y' ? 'y' : 'z'}·${cliente}`));
      textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2 + 9, 'font-size': '9.5' }, `(${fmt(cantidad)})`));
    } else if (minimo >= 14) {
      textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2, 'font-size': '10' }, String(cliente)));
    }
    const g = svg('g', { class: 'camion-u', dataset: { unidad: id } }, caja, textos);
    const u = {
      id, g, caja, textos, cliente, entrega: pref === 'y', k, total, unidades: cantidad, anchoAbordo, anchoAnden,
      tipoRotulo: textos.length === 2 && pref === 'b' ? 'z' : null,
    };
    if (u.tipoRotulo) v.rotulosB.push(u);
    conTooltip(g, () => htmlUnidad(v, u));
    g.addEventListener('pointerenter', () => v.estado.set({ hover: u.cliente }));
    g.addEventListener('pointerleave', () => v.estado.set({ hover: null }));
    v.capaUnidades.append(g);
    v.unidades.push(u);
    v.porId.set(id, u);
  };
  for (const p of sim.paradas) {
    for (const [pref, cantidad] of [['y', p.alpha], ['b', p.beta]]) {
      if (!(cantidad > 1e-9)) continue;
      if (geo.segmentos) crear(`${pref}-${p.cliente}`, pref, p.cliente, 0, 1, cantidad);
      else {
        const total = Math.round(cantidad);
        for (let k = 0; k < total; k++) crear(`${pref}-${p.cliente}-${k}`, pref, p.cliente, k, total, 1);
      }
    }
  }
}

// --- Panel de explicaciones -----------------------------------------------------

function construirPanel(v) {
  const { sim, n } = v;
  v.vistas = new Map();
  v.titulos = [];
  v.vistas.set(-1, vistaInicio(v));
  sim.paradas.forEach((p, k) => v.vistas.set(k, vistaParada(v, p, k)));
  v.vistas.set(n, vistaRegreso(v));

  // Medidor de ocupación (en la cabecera del camión)
  v.cont = {};
  const contador_ = (clave, texto) => {
    v.cont[clave] = el('strong', { class: 'num' }, '0');
    return el('span', { class: `camion-medidor__dato camion-medidor__dato--${clave}` }, v.cont[clave], ` ${texto}`);
  };
  v.seg = { w: el('span', { class: 'seg seg--w' }), y: el('span', { class: 'seg seg--y' }), z: el('span', { class: 'seg seg--z' }) };
  v.ocupacion = el('div', { class: 'camion-medidor__barra', role: 'img' }, v.seg.w, v.seg.y, v.seg.z);
  v.medidor = el('div', { class: 'camion-medidor' },
    el('div', { class: 'camion-medidor__datos' }, contador_('total', `/ ${fmt(sim.Q)} a bordo`)),
    v.ocupacion);

  v.panel = el('aside', { class: 'camion-panel tarjeta', 'aria-label': 'Explicación paso a paso', 'aria-live': 'polite' }, [...v.vistas.values()]);
}

function tituloCliente(v, p) {
  const titulo = el('h3', {
    class: 'pasos-titulo', tabindex: 0,
    onpointerenter: () => v.estado.set({ hover: p.cliente }),
    onpointerleave: () => v.estado.set({ hover: null }),
  },
  el('span', { class: `chip-cliente chip-cliente--p${p.politica === 1 ? 1 : 2}` }, String(p.cliente)),
  `Cliente ${p.cliente}`);
  v.titulos.push({ nodo: titulo, cliente: p.cliente });
  return titulo;
}

function listaOrden(pila) {
  if (!pila.length) return el('p', { class: 'orden-vacio' }, 'Caja vacía.');
  return el('ol', { class: 'orden', 'aria-label': 'Carga del frente a la puerta' },
    el('li', { class: 'orden__extremo' }, 'Frente'),
    pila.map((b) => el('li', {
      class: `orden__bloque orden__bloque--${b.tipo}`,
      title: b.tipo === 'y' ? `${fmt(b.unidades)} para el cliente ${b.cliente}` : `${fmt(b.unidades)} recogidas en el cliente ${b.cliente}`,
    }, String(b.cliente), el('small', {}, `×${fmt(b.unidades)}`))),
    el('li', { class: 'orden__extremo' }, 'Puerta'));
}

function vistaInicio(v) {
  const { sim } = v;
  return el('div', { class: 'pasos-vista' },
    el('p', { class: 'pasos-ante' }, 'Antes de salir'),
    el('h3', { class: 'pasos-titulo' }, el('span', { class: 'chip-cliente chip-cliente--deposito' }, '0'), 'Depósito'),
    el('p', {
      class: 'pasos-texto',
      html: `El camión sale con <strong>todas las entregas</strong>: ${unidades(sim.cargaInicial.y)} de una capacidad Q = ${fmt(sim.Q)}.`,
    }),
    el('p', {
      class: 'pasos-texto',
      html: 'Se cargan en orden inverso a la ruta: la entrega del primer cliente queda junto a la puerta y la del último, al fondo. Así cada cliente encuentra su entrega a la mano.',
    }),
    listaOrden(sim.arcos[0].pila),
    el('p', { class: 'pasos-pista' }, 'Aprieta Iniciar para ver el primer viaje.'));
}

/** Paso del panel: número, título, explicación y la cuenta de su tiempo. */
function paso(orden, { num, colorCss, titulo, texto, formula, tiempo, clase = '' }) {
  return el('li', { class: `paso ${clase}`.trim(), style: { '--color': colorCss }, dataset: { orden } },
    el('span', { class: 'paso__num', 'aria-hidden': 'true' }, num),
    el('div', { class: 'paso__cuerpo' },
      el('p', { class: 'paso__titulo' }, titulo),
      texto ? el('p', { class: 'paso__texto', html: texto }) : null,
      formula ? el('p', { class: 'paso__formula num', html: formula }) : null,
      tiempo ? el('p', { class: 'paso__tiempo num', html: tiempo }) : null));
}

function pasoViaje(desde, hasta, c, inicio, fin, llegada) {
  return paso(0, {
    num: '→', colorCss: 'var(--viaje)',
    titulo: hasta === 0 ? 'Regreso al depósito' : `Viaje hasta el cliente ${hasta}`,
    texto: `El camión va desde ${nombreNodo(desde)} hasta ${nombreNodo(hasta)}.`,
    formula: `${cSub(desde, hasta)} = <strong>${t3(c)}</strong>`,
    tiempo: `t ${t3(inicio)} → ${t3(fin)}${llegada ? ` = ${llegada}` : ''}`,
  });
}

function hito(orden, marca, valor, texto) {
  return el('li', { class: 'hito', dataset: { orden } },
    el('span', { class: 'hito__marca num', html: `${marca} = ${t3(valor)}` }),
    el('span', { class: 'hito__texto' }, texto));
}

/** Explicación en palabras de cada paso de la Tabla 3 en la parada p. */
function explicar(op, p) {
  const i = p.cliente;
  const u = op.unidades;
  switch (op.paso) {
    case 1:
      return u > 0
        ? `Las ${unidades(u)} recogidas antes que viajan junto a la puerta (z) tapan la entrega del cliente ${i}. Se bajan al andén para despejar el paso.`
        : `No hay recogidas junto a la puerta: la entrega del cliente ${i} ya está a la mano. Este paso no toma tiempo.`;
    case 2:
      return u > 0
        ? `Se bajan las ${unidades(u)} que pidió el cliente ${i}. Al terminar este paso <strong>el cliente queda atendido</strong>: ese instante es su D<sub>${i}</sub>.`
        : `El cliente ${i} no recibe entrega; queda atendido al llegar.`;
    case 3:
      return u > 0
        ? `Con la Política 2 las recogidas van al fondo, y ahí están las entregas que faltan. Se bajan las ${unidades(u)} que siguen a bordo para hacerles espacio.`
        : 'Ya no quedan entregas a bordo: no hay nada que mover.';
    case 4: {
      const nuevas = p.beta;
      const vuelven = p.zEntrada;
      const que = [vuelven > 0 ? `las ${unidades(vuelven)} que se bajaron en el paso 1` : null, nuevas > 0 ? `las ${unidades(nuevas)} recogidas en este cliente` : null].filter(Boolean).join(' y ');
      if (!que) return 'No hay recogidas que subir.';
      return p.politica === 1
        ? `Suben ${que}. Quedan junto a la puerta (z): no estorban ahora, pero habrá que moverlas de nuevo en la próxima parada.`
        : `Suben ${que} y se acomodan al fondo (w). Ahí ya no estorban en ninguna de las próximas paradas.`;
    }
    case 5:
      return u > 0
        ? `Vuelven a subir las ${unidades(u)} pendientes, en el mismo orden: la del próximo cliente queda otra vez junto a la puerta.`
        : 'No hay entregas que recargar.';
    default:
      return '';
  }
}

function pasoOp(op, p) {
  const i = p.cliente;
  const variable = { 1: 'z', 2: sub('α', i), 3: 'y', 4: `(z + ${sub('β', i)})`, 5: 'y' }[op.paso] ?? '';
  const cantidad = op.paso === 4 ? `(${fmt(p.zEntrada)} + ${fmt(p.beta)})` : fmt(op.unidades);
  const vacia = op.unidades === 0;
  return paso(op.paso, {
    num: String(op.paso),
    colorCss: `var(--op-${op.param})`,
    clase: vacia ? 'paso--vacio' : '',
    titulo: op.etiqueta,
    texto: explicar(op, p),
    formula: `${PARAM_HTML[op.param]} · ${variable} = ${fmt(op.tasa, 4)} × ${cantidad} = <strong>${fmt(op.duracion, 4)}</strong>`,
    tiempo: vacia ? null : `t ${t3(op.inicio)} → ${t3(op.fin)}`,
  });
}

function pasoNoAplica(num) {
  const info = OP_POR_PASO[num];
  return paso(num, {
    num: String(num), colorCss: 'var(--linea)', clase: 'paso--na',
    titulo: info.etiqueta,
    texto: 'No aplica con la Política 1: las entregas pendientes no se mueven.',
  });
}

function vistaParada(v, p, k) {
  const { sim, n } = v;
  const i = p.cliente;
  const siguiente = sim.paradas[k + 1]?.cliente ?? 0;
  const items = [pasoViaje(p.desde, i, p.c, p.salidaPrevia, p.T, sub('T', i))];
  for (const num of [1, 2, 3, 4, 5]) {
    const op = p.ops.find((o) => o.paso === num);
    items.push(op ? pasoOp(op, p) : pasoNoAplica(num));
    if (num === 2) items.push(hito(2.5, sub('D', i), p.D, `cliente ${i} atendido`));
  }
  items.push(hito(6, sub('F', i), p.F, `sale hacia ${nombreNodo(siguiente)}`));

  const vista = el('div', { class: 'pasos-vista', hidden: true },
    el('p', { class: 'pasos-ante' }, `Parada ${p.k} de ${n}`),
    tituloCliente(v, p),
    el('p', { class: `pasos-politica pasos-politica--p${p.politica === 1 ? 1 : 2}` }, POLITICA_TEXTO[p.politica]),
    el('p', { class: 'pasos-datos num', html: `Entrega ${sub('α', i)} = ${fmt(p.alpha)} · Recogida ${sub('β', i)} = ${fmt(p.beta)}` }),
    el('ol', { class: 'pasos', 'aria-label': `Pasos en el cliente ${i}` }, items));
  vista._items = items;
  return vista;
}

function vistaRegreso(v) {
  const { sim, n } = v;
  const a = sim.arcos[n];
  const items = [pasoViaje(a.desde, 0, a.c, a.inicio, a.fin, null), hito(6, 'fin', sim.regreso, 'el camión vuelve al depósito')];
  const vista = el('div', { class: 'pasos-vista', hidden: true },
    el('p', { class: 'pasos-ante' }, 'Fin de la ruta'),
    el('h3', { class: 'pasos-titulo' }, el('span', { class: 'chip-cliente chip-cliente--deposito' }, '0'), 'Regreso'),
    el('ol', { class: 'pasos', 'aria-label': 'Regreso al depósito' }, items),
    el('p', { class: 'pasos-texto', html: `Vuelve con ${unidades(a.carga.total)} recogidas.` }),
    el('p', { class: 'pasos-total', html: `Espera total Σ D<sub>i</sub> = <strong class="num">${t3(sim.objetivo)}</strong>` }),
    el('p', { class: 'pasos-texto pasos-texto--suave', html: 'El regreso no cuenta en la espera: solo se suma el instante en que cada cliente recibe su entrega.' }),
    listaOrden(a.pila));
  vista._items = items;
  return vista;
}

// --- Línea de tiempo ----------------------------------------------------------

function montarLinea(v, modo) {
  v.modo = modo;
  v.iFase = -1;
  v.kActual = null;
  v.andenActual = null;
  v.ultimaCarga = '';
  v.ultimoReloj = '';
  v.ultimoReproductor = '';
  const tl = construirLinea(v);
  v.tl = tl;
  v.pausas = calcularPausas(v);
  sincronizar(v, tl.time());
}

function construirLinea(v) {
  const { sim, geo, colores, n } = v;
  const tl = gsap.timeline({ paused: true, onUpdate: () => sincronizar(v, tl.time()) });
  const fases = [];
  const est = new Map();
  const hist = new Map();
  const fijar = (id, t, e) => {
    est.set(id, e);
    hist.get(id).push({ t, ...e });
  };
  const seg = geo.segmentos;
  const pintar = (u, tipo, t, d) => {
    tl.to(u.caja, { fill: colores[tipo], duration: d, ease: 'none' }, t);
    if (u.textos.length) tl.to(u.textos, { fill: colores.texto[tipo], duration: d, ease: 'none' }, t);
  };
  // Con segmentos, el bloque se compacta al salir al andén y recupera su largo al entrar
  const anchoA = (u, ancho, t, d) => {
    if (u.anchoAbordo === u.anchoAnden) return;
    tl.to(u.caja, { attr: { width: ancho }, duration: d, ease: 'power1.inOut' }, t);
    if (u.textos.length) tl.to(u.textos, { attr: { x: ancho / 2 }, duration: d, ease: 'power1.inOut' }, t);
  };
  // x lineal; y sube y baja, para que la unidad pase por encima de las demás
  const arco = (g, desde, hasta, t, d, escala, pico) => {
    const yPico = pico ?? Math.min(desde.y, hasta.y) - 14;
    tl.to(g, { x: hasta.x, scale: escala, duration: d, ease: 'power1.inOut' }, t);
    tl.to(g, { keyframes: [{ y: yPico, duration: d * 0.45, ease: 'power2.out' }, { y: hasta.y, duration: d * 0.55, ease: 'power2.in' }] }, t);
  };

  // Estado inicial fuera de la línea: volver a t = 0 no lo deshace.
  gsap.set(v.ruedas, { rotation: 0, transformOrigin: '50% 50%' });
  gsap.set(v.puerta, { scaleY: 1, transformOrigin: '50% 0%' });
  gsap.set(v.anden, { x: 0, autoAlpha: 1 });
  gsap.set(v.cuerpo, { y: 0 });
  gsap.set(v.carril, { attr: { 'stroke-dashoffset': 0 } });
  const inicial = mapaPila(sim.arcos[0].pila, seg);
  for (const u of v.unidades) {
    const p = inicial.get(u.id);
    const e = p
      ? { lugar: 'abordo', ...geo.ranura(p.slot), s: 1, tipo: p.tipo, slot: p.slot }
      : { lugar: 'pendiente', x: G.zonaX1 - u.anchoAnden, y: geo.yPiso, s: 1, tipo: 'z', slot: null };
    est.set(u.id, e);
    hist.set(u.id, [{ t: -Infinity, ...e }]);
    gsap.set(u.g, { x: e.x, y: e.y, scale: 1, transformOrigin: '0px 0px', autoAlpha: p ? 1 : 0 });
    gsap.set(u.caja, { fill: colores[e.tipo] });
    if (u.textos.length) gsap.set(u.textos, { fill: colores.texto[e.tipo] });
    if (u.anchoAbordo !== u.anchoAnden) {
      const ancho = p ? u.anchoAbordo : u.anchoAnden;
      gsap.set(u.caja, { attr: { width: ancho } });
      if (u.textos.length) gsap.set(u.textos, { attr: { x: ancho / 2 } });
    }
  }

  const viajar = (t, k) => {
    const d = DUR.viaje;
    tl.to(v.ruedas, { rotation: (k + 1) * 540, duration: d, ease: 'power1.inOut' }, t);
    tl.to(v.carril, { attr: { 'stroke-dashoffset': (k + 1) * 560 }, duration: d, ease: 'power1.inOut' }, t);
    tl.to(v.cuerpo, { y: -1.6, duration: d / 8, repeat: 7, yoyo: true, ease: 'sine.inOut' }, t);
    tl.to(v.anden, { x: 120, autoAlpha: 0, duration: 0.24, ease: 'power2.in' }, t);
    tl.to(v.anden, { x: 0, autoAlpha: 1, duration: 0.26, ease: 'power2.out' }, t + d - 0.26);
  };

  const animarOp = (op, t, anden) => {
    const antes = mapaPila(op.pilaAntes, seg);
    const despues = mapaPila(op.pilaDespues, seg);
    const salen = [...antes.keys()].filter((id) => !despues.has(id) && v.porId.has(id)).sort((a, b) => antes.get(b).slot - antes.get(a).slot);
    const entran = [...despues.keys()].filter((id) => !antes.has(id) && v.porId.has(id)).sort((a, b) => despues.get(a).slot - despues.get(b).slot);
    const mueven = [...despues.keys()].filter((id) => antes.has(id) && v.porId.has(id)
      && (Math.abs(antes.get(id).slot - despues.get(id).slot) > 1e-6 || antes.get(id).tipo !== despues.get(id).tipo));
    const nuevas = entran.filter((id) => est.get(id).lugar === 'pendiente');
    let inicio = t;
    let duracion = DUR.op;

    // Paso 4: las recogidas nuevas aparecen primero en el andén
    if (nuevas.length) {
      const escalon = Math.min(0.025, (DUR.aparecer * 0.45) / nuevas.length);
      nuevas.forEach((id, j) => {
        const u = v.porId.get(id);
        const c = anden.tomar();
        tl.set(u.g, { x: c.x, y: c.y - 14, scale: c.s }, t);
        tl.set(u.caja, { fill: colores.z }, t);
        if (u.textos.length) tl.set(u.textos, { fill: colores.texto.z }, t);
        tl.to(u.g, { autoAlpha: 1, y: c.y, duration: DUR.aparecer * 0.55, ease: 'back.out(2)' }, t + j * escalon);
        fijar(id, t, { lugar: 'anden', x: c.x, y: c.y, s: c.s, tipo: 'z', slot: null });
      });
      inicio += DUR.aparecer;
      duracion += DUR.aparecer;
    }

    const descarga = op.clave === 'descargar';
    const lista = [...salen.map((id) => [id, 'sale']), ...entran.map((id) => [id, 'entra'])];
    if (lista.length) {
      const ventana = DUR.op - (descarga ? 0.14 : 0.04);
      const du = Math.min(0.42, ventana * 0.72);
      const escalon = lista.length > 1 ? (ventana - du) / (lista.length - 1) : 0;
      const puerta = { x: geo.xAnden, y: geo.yPiso };
      lista.forEach(([id, dir], j) => {
        const u = v.porId.get(id);
        const e = est.get(id);
        const ti = inicio + j * escalon;
        if (dir === 'sale') {
          tl.to(u.g, { x: puerta.x, duration: du * 0.5, ease: 'power1.in' }, ti);
          anchoA(u, u.anchoAnden, ti + du * 0.5, du * 0.5);
          if (descarga) {
            const c = geo.cubeta(j, u.anchoAnden);
            arco(u.g, puerta, c, ti + du * 0.5, du * 0.5, 1, Math.min(anden.yMin(), puerta.y) - 12);
            tl.to(u.g, { y: c.y + 8, autoAlpha: 0, duration: 0.12, ease: 'power1.in' }, ti + du);
            fijar(id, ti + du * 0.5, { lugar: 'entregada', x: c.x, y: c.y, s: 1, tipo: e.tipo, slot: null });
          } else {
            const c = anden.tomar();
            arco(u.g, puerta, c, ti + du * 0.5, du * 0.5, c.s);
            fijar(id, ti + du * 0.5, { lugar: 'anden', x: c.x, y: c.y, s: c.s, tipo: e.tipo, slot: null });
          }
        } else {
          const destino = despues.get(id);
          const pos = geo.ranura(destino.slot);
          arco(u.g, e, puerta, ti, du * 0.45, 1, Math.min(e.y, puerta.y) - 10);
          tl.to(u.g, { x: pos.x, duration: du * 0.55, ease: 'power2.out' }, ti + du * 0.45);
          anchoA(u, u.anchoAbordo, ti + du * 0.45, du * 0.55);
          if (destino.tipo !== e.tipo) pintar(u, destino.tipo, ti, du);
          fijar(id, ti + du * 0.45, { lugar: 'abordo', ...pos, s: 1, tipo: destino.tipo, slot: destino.slot });
        }
      });
    }

    // Unidades que siguen a bordo pero cambian de ranura o de tipo (no ocurre con la Tabla 3)
    for (const id of mueven) {
      const u = v.porId.get(id);
      const d = despues.get(id);
      const pos = geo.ranura(d.slot);
      tl.to(u.g, { x: pos.x, y: pos.y, duration: DUR.op * 0.8, ease: 'power2.inOut' }, inicio);
      if (d.tipo !== est.get(id).tipo) pintar(u, d.tipo, inicio, DUR.op * 0.8);
      fijar(id, inicio, { lugar: 'abordo', ...pos, s: 1, tipo: d.tipo, slot: d.slot });
    }
    return duracion;
  };

  // --- Fases: lo que muestran el panel y el estado en cada tramo
  let t = 0;
  const c0 = sim.arcos[0].carga;
  fases.push({ tipo: 'inicio', k: -1, t0: 0, t1: DUR.inicio, orden: -1, carga0: c0, carga1: c0, reloj0: 0, reloj1: 0, anden: 0, etiqueta: 'Depósito', clase: '', html: 'Listo para salir con todas las entregas' });
  t = DUR.inicio;

  sim.paradas.forEach((p, k) => {
    const i = p.cliente;
    const arcoK = sim.arcos[k];
    const claseServicio = p.politica === 1 ? 'es-p1' : 'es-p2';
    const htmlViaje = `${p.desde} → ${i} · ${cSub(p.desde, i)} = ${t3(p.c)}`;
    const medio = (p.salidaPrevia + p.T) / 2;
    tl.addLabel(`p${k}`, t);
    viajar(t, k);
    const viaje = { tipo: 'viaje', k, orden: 0, carga0: arcoK.carga, carga1: arcoK.carga, etiqueta: 'Viajando', clase: 'es-viaje', html: htmlViaje };
    fases.push({ ...viaje, t0: t, t1: t + DUR.viaje / 2, reloj0: p.salidaPrevia, reloj1: medio, anden: p.desde });
    fases.push({ ...viaje, t0: t + DUR.viaje / 2, t1: t + DUR.viaje, reloj0: medio, reloj1: p.T, anden: i });
    t += DUR.viaje;

    tl.addLabel(`llega${k}`, t);
    tl.to(v.puerta, { scaleY: 0.08, duration: DUR.puerta, ease: 'power2.inOut' }, t);
    const servicio = { k, anden: i, etiqueta: `Cliente ${i}`, clase: claseServicio };
    fases.push({ ...servicio, tipo: 'abrir', t0: t, t1: t + DUR.puerta, orden: 0.5, carga0: p.llegada.carga, carga1: p.llegada.carga, reloj0: p.T, reloj1: p.T, html: 'Se abre la puerta trasera' });
    t += DUR.puerta;

    const anden = crearAnden(geo, contarAnden(p, seg));
    for (const op of p.ops) {
      const d = animarOp(op, t, anden);
      fases.push({
        ...servicio, tipo: 'op', op, t0: t, t1: t + d, orden: op.paso,
        carga0: resumen(op.pilaAntes), carga1: resumen(op.pilaDespues), reloj0: op.inicio, reloj1: op.fin,
        html: `Paso ${op.paso} · ${op.etiqueta.charAt(0).toLowerCase()}${op.etiqueta.slice(1)}`,
      });
      t += d;
    }

    tl.to(v.puerta, { scaleY: 1, duration: DUR.puerta, ease: 'power2.inOut' }, t);
    fases.push({ ...servicio, tipo: 'cerrar', t0: t, t1: t + DUR.puerta, orden: 6, carga0: p.salida.carga, carga1: p.salida.carga, reloj0: p.F, reloj1: p.F, html: 'Se cierra la puerta' });
    t += DUR.puerta;
    tl.addLabel(`fin${k}`, t);
    fases.push({
      ...servicio, tipo: 'pausa', t0: t, t1: t + DUR.pausa, orden: 6,
      carga0: p.salida.carga, carga1: p.salida.carga, reloj0: p.F, reloj1: p.F,
      html: `Atendido en ${sub('D', i)} = ${t3(p.D)} · sale en ${sub('F', i)} = ${t3(p.F)}`,
    });
    t += DUR.pausa;
  });

  const ultimo = sim.arcos[n];
  const medio = (ultimo.inicio + ultimo.fin) / 2;
  tl.addLabel('regreso', t);
  viajar(t, n);
  const regreso = { tipo: 'regreso', k: n, orden: 0, carga0: ultimo.carga, carga1: ultimo.carga, etiqueta: 'Viajando', clase: 'es-viaje', html: `${ultimo.desde} → 0 · ${cSub(ultimo.desde, 0)} = ${t3(ultimo.c)}` };
  fases.push({ ...regreso, t0: t, t1: t + DUR.viaje / 2, reloj0: ultimo.inicio, reloj1: medio, anden: ultimo.desde });
  fases.push({ ...regreso, t0: t + DUR.viaje / 2, t1: t + DUR.viaje, reloj0: medio, reloj1: ultimo.fin, anden: 0 });
  t += DUR.viaje;
  tl.addLabel('fin', t);
  fases.push({
    tipo: 'fin', k: n, t0: t, t1: t + DUR.fin, orden: 6, carga0: ultimo.carga, carga1: ultimo.carga,
    reloj0: sim.regreso, reloj1: sim.regreso, anden: 0, etiqueta: 'Depósito', clase: '',
    html: `Fin · Σ D<sub>i</sub> = ${t3(sim.objetivo)}`,
  });
  tl.to({}, { duration: DUR.fin }, t);

  // Piezas del avance que siguen el mapa y la tabla: en el tramo k el viaje va de 0 a 1,
  // y el servicio en el cliente de llegada de 0 a 0,5 hasta cerrar la puerta y de 0,5 a 1 en la pausa.
  const L = tl.labels;
  const piezas = [{ t0: 0, t1: L.p0, tramo: 0, viaje: [0, 0], servicio: [0, 0] }];
  sim.paradas.forEach((_, k) => {
    piezas.push(
      { t0: L[`p${k}`], t1: L[`llega${k}`], tramo: k, viaje: [0, 1], servicio: [0, 0] },
      { t0: L[`llega${k}`], t1: L[`fin${k}`], tramo: k, viaje: [1, 1], servicio: [0, 0.5] },
      { t0: L[`fin${k}`], t1: k + 1 < n ? L[`p${k + 1}`] : L.regreso, tramo: k, viaje: [1, 1], servicio: [0.5, 1] });
  });
  piezas.push(
    { t0: L.regreso, t1: L.fin, tramo: n, viaje: [0, 1], servicio: [0, 0] },
    { t0: L.fin, t1: tl.duration(), tramo: n, viaje: [1, 1], servicio: [0, 1] });

  v.fases = fases;
  v.hist = hist;
  v.piezas = piezas;
  return tl;
}

// --- Sincronización -------------------------------------------------------------

function sincronizar(v, t) {
  const fases = v.fases;
  if (!fases.length) return;
  let i = Math.max(0, Math.min(v.iFase, fases.length - 1));
  while (i < fases.length - 1 && t >= fases[i].t1) i++;
  while (i > 0 && t < fases[i].t0) i--;
  const f = fases[i];
  if (i !== v.iFase) {
    v.iFase = i;
    aplicarFase(v, f);
  }
  const u = f.t1 > f.t0 ? Math.min(1, Math.max(0, (t - f.t0) / (f.t1 - f.t0))) : 1;
  pintarMedidor(v, f, u);
  // Rótulos "z·4" / "w·4" de los bloques de recogida (modo segmentos)
  for (const b of v.rotulosB) {
    const tipo = estadoEn(v, b, t)?.tipo ?? 'z';
    if (tipo !== b.tipoRotulo) {
      b.tipoRotulo = tipo;
      b.textos[0].textContent = `${tipo}·${b.cliente}`;
    }
  }
  const instante = f.reloj0 + (f.reloj1 - f.reloj0) * u;
  const reloj = `t = ${fmt(instante, 2)}`;
  if (reloj !== v.ultimoReloj) {
    v.ultimoReloj = reloj;
    v.relojNodo.textContent = reloj;
  }
  pintarReproductor(v);
  v.estado.set({ avance: avanceEn(v, t, instante) });
}

/** Punto del recorrido en el instante t de la línea, en las unidades que entienden el mapa y la tabla. */
function avanceEn(v, t, reloj) {
  const pieza = v.piezas.find((p) => t < p.t1) ?? v.piezas[v.piezas.length - 1];
  const u = pieza.t1 > pieza.t0 ? Math.min(1, Math.max(0, (t - pieza.t0) / (pieza.t1 - pieza.t0))) : 1;
  const mezcla = ([a, b]) => a + (b - a) * u;
  return { tramo: pieza.tramo, viaje: mezcla(pieza.viaje), servicio: mezcla(pieza.servicio), reloj };
}

function aplicarFase(v, f) {
  if (f.k !== v.kActual) {
    const anterior = v.vistas.get(v.kActual);
    v.kActual = f.k;
    for (const [k, vista] of v.vistas) vista.hidden = k !== f.k;
    const vista = v.vistas.get(f.k);
    // La explicación nueva entra con un desliz corto
    if (vista && anterior && !movimientoReducido()) {
      gsap.fromTo(vista, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
    }
    gsap.killTweensOf(v.panel);
    v.panel.scrollTop = 0;
    v.marcas.forEach((m, j) => {
      m.classList.toggle('es-actual', j === f.k);
      m.classList.toggle('es-hecha', j < f.k);
    });
  }
  const vista = v.vistas.get(f.k);
  for (const item of vista?._items ?? []) {
    const orden = Number(item.dataset.orden);
    item.classList.toggle('es-hecho', orden < f.orden);
    item.classList.toggle('es-activo', orden === f.orden);
    if (orden === f.orden) centrarEnPanel(v, item);
  }

  v.faseNodo.textContent = f.etiqueta;
  v.faseNodo.className = `camion-estado__fase ${f.clase}`.trim();
  v.textoNodo.innerHTML = f.html;
  if (f.anden !== v.andenActual) pintarLetrero(v, f.anden);

  const c = f.carga1;
  v.svgCamion.setAttribute('aria-label',
    `Camión con ${fmt(v.sim.Q)} ranuras. A bordo: ${fmt(c.y)} entregas, ${fmt(c.w)} recogidas al fondo y ${fmt(c.z)} junto a la puerta.`);
}

/** Si el panel tiene alto fijo y no cabe todo, lleva el paso activo a la vista sin mover la página. */
function centrarEnPanel(v, item) {
  const panel = v.panel;
  if (panel.scrollHeight <= panel.clientHeight + 1) return;
  const caja = item.getBoundingClientRect();
  const arriba = panel.scrollTop + caja.top - panel.getBoundingClientRect().top - panel.clientHeight / 2 + caja.height / 2;
  const y = Math.max(0, Math.min(arriba, panel.scrollHeight - panel.clientHeight));
  gsap.to(panel, { scrollTo: { y, autoKill: true }, duration: movimientoReducido() ? 0 : 0.35, ease: 'power2.out', overwrite: true });
}

function pintarMedidor(v, f, u) {
  const val = (a, b) => {
    const x = a + (b - a) * u;
    return Number.isInteger(a) && Number.isInteger(b) ? Math.round(x) : Math.round(x * 100) / 100;
  };
  const w = val(f.carga0.w, f.carga1.w);
  const y = val(f.carga0.y, f.carga1.y);
  const z = val(f.carga0.z, f.carga1.z);
  const clave = `${w}|${y}|${z}`;
  if (clave === v.ultimaCarga) return;
  v.ultimaCarga = clave;
  const Q = v.sim.Q;
  const total = w + y + z;
  v.cont.total.textContent = fmt(total);
  const ref = Math.max(Q, total) || 1;
  v.seg.w.style.width = `${(w / ref) * 100}%`;
  v.seg.y.style.width = `${(y / ref) * 100}%`;
  v.seg.z.style.width = `${(z / ref) * 100}%`;
  v.ocupacion.setAttribute('aria-label', `A bordo: ${fmt(w)} al fondo, ${fmt(y)} entregas, ${fmt(z)} junto a la puerta, de ${fmt(Q)}`);
}

function pintarLetrero(v, cliente) {
  v.andenActual = cliente;
  const p = v.sim.porCliente.get(cliente);
  v.letrero.nodo.classList.toggle('camion-letrero--deposito', !p);
  v.letrero.nodo.classList.toggle('camion-letrero--p2', Boolean(p) && p.politica === 0);
  v.letrero.num.textContent = String(cliente);
  v.cubetaRotulo.textContent = p ? String(cliente) : '';
}

/** Elige una parada: -1 es el depósito al salir, k la llegada al cliente k y n el regreso. */
function irA(v, indice) {
  const tl = v.tl;
  if (!tl) return;
  const k = Math.max(-1, Math.min(v.n, indice));
  irATiempo(v, k < 0 ? 0 : k >= v.n ? tl.labels.fin : tl.labels[`llega${k}`]);
}

// --- Reproductor --------------------------------------------------------------

const ICONOS = {
  inicio: 'M3.5 3h2v10h-2zM13 3v10L6.5 8z',
  atras: 'M10.5 3.5 6 8l4.5 4.5',
  reproducir: 'M5 3v10l8-5z',
  pausar: 'M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z',
  repetir: 'M12.6 9.2A4.8 4.8 0 1 1 11.2 4.6M12.6 2.6v3.2H9.4',
};
const icono = (nombre) => svg('svg', { class: `icono icono--${nombre}`, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { d: ICONOS[nombre] }));

function construirReproductor(v) {
  const boton = (etiqueta, nombre, onclick) => el('button', { type: 'button', class: 'repro-boton', 'aria-label': etiqueta, title: etiqueta, onclick }, icono(nombre));
  v.btnInicio = boton('Volver al inicio', 'inicio', () => irATiempo(v, 0));
  v.btnAtras = boton('Paso anterior', 'atras', () => irATiempo(v, pausaAnterior(v, v.tl?.time() ?? 0)));
  v.btnPrincipalIcono = el('span', { class: 'repro-principal__icono' });
  v.btnPrincipalTexto = el('span', {});
  v.btnPrincipal = el('button', { type: 'button', class: 'repro-principal', onclick: () => alternar(v) }, v.btnPrincipalIcono, v.btnPrincipalTexto);
  v.interruptor = el('button', {
    type: 'button', role: 'switch', class: 'repro-continuo', 'aria-checked': String(v.continuo),
    title: 'Encendido: recorre la ruta sin parar. Apagado: se detiene en cada paso.',
    onclick: () => v.estado.set({ modoContinuo: !v.continuo }),
  }, el('span', { class: 'repro-continuo__pista', 'aria-hidden': 'true' }, el('span', { class: 'repro-continuo__perilla' })), 'Continuo');

  v.relleno = el('span', { class: 'repro-relleno' });
  v.marcasNodo = el('span', { class: 'repro-marcas' });
  v.marcas = [];
  v.barraAvance = el('div', { class: 'repro-barra', title: 'Clic o arrastre para ir a otro momento' }, el('span', { class: 'repro-pista' }, v.relleno), v.marcasNodo);
  const saltar = (e) => {
    const tl = v.tl;
    if (!tl) return;
    const caja = v.barraAvance.getBoundingClientRect();
    irATiempo(v, Math.min(1, Math.max(0, (e.clientX - caja.left) / (caja.width || 1))) * tl.duration());
  };
  v.barraAvance.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.repro-marca')) return;
    v.barraAvance.setPointerCapture(e.pointerId);
    saltar(e);
  });
  v.barraAvance.addEventListener('pointermove', (e) => {
    if (v.barraAvance.hasPointerCapture(e.pointerId)) saltar(e);
  });
  v.contadorAvance = el('span', { class: 'repro-contador num' });

  v.reproductor = el('div', { class: 'repro', role: 'group', 'aria-label': 'Reproducción del recorrido' },
    el('div', { class: 'repro-botones' }, v.btnInicio, v.btnAtras, v.btnPrincipal),
    v.barraAvance,
    el('div', { class: 'repro-extra' }, v.contadorAvance, v.interruptor));
}

/** Pausas del modo paso a paso: el final de cada paso de la Tabla 3, de cada parada y del recorrido. */
function calcularPausas(v) {
  const pausas = v.fases.filter((f) => f.tipo === 'op' || f.tipo === 'pausa').map((f) => f.t1 - ANTES);
  pausas.push(v.tl.duration());
  // Una marca por parada en la barra: un botón con el número del cliente
  const total = v.tl.duration() || 1;
  v.marcas = v.sim.paradas.map((p, k) => {
    const marca = el('button', {
      type: 'button',
      class: `repro-marca repro-marca--p${p.politica === 1 ? 1 : 2}`,
      style: { left: `${((v.tl.labels[`llega${k}`] / total) * 100).toFixed(2)}%` },
      'aria-label': `Ir a la parada ${p.k}: cliente ${p.cliente}`,
      title: `Parada ${p.k} · cliente ${p.cliente}`,
      onclick: () => irA(v, k),
      onpointerenter: () => v.estado.set({ hover: p.cliente }),
      onpointerleave: () => v.estado.set({ hover: null }),
    }, String(p.cliente));
    return marca;
  });
  v.marcasNodo.replaceChildren(...v.marcas);
  return pausas;
}

const siguientePausa = (v, t) => v.pausas.find((p) => p > t + 1e-3) ?? v.tl.duration();
const pausaAnterior = (v, t) => [...v.pausas].reverse().find((p) => p < t - 1e-3) ?? 0;

function detener(v) {
  v.reproduccion?.kill();
  v.reproduccion = null;
  v.reproduciendo = false;
}

/** seek no dispara onUpdate: el panel, el reproductor y el mapa se actualizan aquí. */
function saltarA(v, t) {
  v.tl.seek(t);
  sincronizar(v, v.tl.time());
}

/** Avanza hasta la próxima pausa (o hasta el final, en modo continuo). */
function reproducir(v) {
  const tl = v.tl;
  if (!tl) return;
  detener(v);
  if (tl.time() >= tl.duration() - 1e-3) saltarA(v, 0);
  else if (tl.time() < 1e-3) llevarAVista(v);
  v.reproduciendo = true;
  if (v.modo === 'reducido') {
    saltarA(v, siguientePausa(v, tl.time()));
    if (v.continuo && tl.time() < tl.duration() - 1e-3) v.reproduccion = gsap.delayedCall(ESPERA_REDUCIDA, () => reproducir(v));
    else v.reproduciendo = false;
  } else {
    v.reproduccion = tl.tweenTo(v.continuo ? tl.duration() : siguientePausa(v, tl.time()), {
      onComplete: () => {
        v.reproduccion = null;
        v.reproduciendo = false;
        pintarReproductor(v);
      },
    });
  }
  pintarReproductor(v);
}

function alternar(v) {
  if (v.reproduciendo) {
    detener(v);
    pintarReproductor(v);
  } else reproducir(v);
}

/** Salta a un instante de la línea. Si estaba corriendo en modo continuo, sigue desde ahí. */
function irATiempo(v, t) {
  const tl = v.tl;
  if (!tl) return;
  const seguir = v.reproduciendo && v.continuo;
  detener(v);
  saltarA(v, Math.min(tl.duration(), Math.max(0, t)));
  if (seguir) reproducir(v);
  else pintarReproductor(v);
}

function cambiarContinuo(v, continuo) {
  v.continuo = Boolean(continuo);
  v.interruptor.setAttribute('aria-checked', String(v.continuo));
  if (v.reproduciendo) {
    if (v.modo === 'reducido' && !v.continuo) detener(v);
    else if (v.modo !== 'reducido') reproducir(v);
  }
  pintarReproductor(v);
}

/** En escritorio, al empezar se alinea la escena bajo la barra para ver mapa y camión completos. */
function llevarAVista(v) {
  if (!window.matchMedia('(min-width: 1080px)').matches || !window.ScrollToPlugin || !v.escena) return;
  const arriba = v.escena.getBoundingClientRect().top;
  if (Math.abs(arriba - 64) < 24) return;
  gsap.to(window, { scrollTo: { y: v.escena, offsetY: 64, autoKill: true }, duration: movimientoReducido() ? 0 : 0.7, ease: 'power2.inOut' });
}

function pintarReproductor(v) {
  const tl = v.tl;
  if (!tl || !v.pausas.length) return;
  const t = tl.time();
  const total = tl.duration();
  const alFinal = t >= total - 1e-3;
  const modo = v.reproduciendo ? 'pausar' : t < 1e-3 ? 'iniciar' : alFinal ? 'repetir' : 'continuar';
  const hechas = v.pausas.filter((p) => p <= t + 1e-3).length;
  v.relleno.style.transform = `scaleX(${(total > 0 ? t / total : 0).toFixed(4)})`;
  const clave = `${modo}|${hechas}|${v.continuo}`;
  if (clave === v.ultimoReproductor) return;
  v.ultimoReproductor = clave;

  const [texto, nombre] = {
    iniciar: ['Iniciar', 'reproducir'],
    pausar: ['Pausar', 'pausar'],
    continuar: ['Continuar', 'reproducir'],
    repetir: ['Repetir', 'repetir'],
  }[modo];
  v.btnPrincipalTexto.textContent = texto;
  v.btnPrincipalIcono.replaceChildren(icono(nombre));
  v.btnPrincipal.dataset.estado = modo;
  v.btnInicio.disabled = t < 1e-3 && !v.reproduciendo;
  v.btnAtras.disabled = t < 1e-3;
  v.contadorAvance.textContent = `${hechas}/${v.pausas.length}`;
  v.contadorAvance.title = `Paso ${hechas} de ${v.pausas.length}`;
}

// --- Tooltip de unidades y resaltado compartido ----------------------------------

function estadoEn(v, u, t) {
  const lista = v.hist.get(u.id);
  if (!lista?.length) return null;
  let e = lista[0];
  for (const x of lista) {
    if (x.t <= t) e = x;
    else break;
  }
  return e;
}

function htmlUnidad(v, u) {
  const e = estadoEn(v, u, v.tl ? v.tl.time() : 0) ?? { lugar: 'abordo', tipo: u.entrega ? 'y' : 'z' };
  let titulo;
  if (u.entrega) titulo = `Entrega para el cliente ${u.cliente}`;
  else if (e.lugar === 'abordo') titulo = `Recogida en el cliente ${u.cliente}, ${e.tipo === 'w' ? 'al fondo' : 'junto a la puerta'}`;
  else titulo = `Recogida en el cliente ${u.cliente}`;
  const lugar = {
    abordo: e.slot != null
      ? (v.geo.segmentos ? `${fmt(e.slot)} a ${fmt(e.slot + u.unidades)} desde el frente` : `ranura ${e.slot + 1} de ${v.geo.ranuras}`)
      : 'a bordo',
    anden: 'en el andén',
    entregada: 'entregada',
    pendiente: 'aún no se recoge',
  }[e.lugar] ?? '';
  return `<div class="tt-titulo">${titulo}</div>`
    + (v.geo.segmentos ? filaTooltip('Unidades', fmt(u.unidades)) : filaTooltip('Unidad', `${u.k + 1} de ${u.total}`))
    + filaTooltip('Posición', lugar);
}

function resaltar(v, c) {
  const activo = c != null && v.sim.porCliente.has(c);
  v.svgCamion.classList.toggle('camion-svg--hover', activo);
  for (const u of v.unidades) u.g.classList.toggle('es-resaltada', activo && u.cliente === c);
  for (const t of v.titulos) t.nodo.classList.toggle('es-resaltado', activo && t.cliente === c);
  v.sim.paradas.forEach((p, k) => v.marcas[k]?.classList.toggle('es-resaltada', activo && p.cliente === c));
}
