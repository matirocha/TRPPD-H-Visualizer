// Sección 01 · Carga del camión (junto al mapa).
//
// Vista lateral del camión (cabina a la izquierda, puerta trasera a la
// derecha) con cada unidad en su ranura física, un panel con los pasos de la
// Tabla 3 en la parada actual y barras de la carga a bordo por tramo.
// Una sola línea de tiempo de GSAP, construida desde sim, anima los viajes y
// las operaciones, y la mueve un reproductor (Iniciar / Pausar / Continuar):
// sin el modo continuo se detiene al final de cada paso de la Tabla 3 y de
// cada parada, para leer la explicación; con él recorre la ruta sin parar.
// Con movimiento reducido el reproductor salta de una pausa a la siguiente.
//
// Esta línea marca el paso del recorrido: en cada actualización publica
// estado.avance y el mapa se coloca en el mismo punto. Las paradas elegidas
// desde el mapa llegan como estado.pedirParada.
import { OPERACIONES } from './modelo.js';
import { PARAM_HTML, POLITICA_TEXTO, color, conTooltip, el, fmt, movimientoReducido, ocultarTooltip, svg } from './util.js';

// Duraciones dentro de la línea de tiempo (no son tiempos del modelo), en segundos de reproducción.
const DUR = { inicio: 0.4, viaje: 1, puerta: 0.3, op: 0.6, aparecer: 0.22, pausa: 0.25, fin: 0.5 };
// Con movimiento reducido y modo continuo: espera entre una explicación y la siguiente.
const ESPERA_REDUCIDA = 2.5;
// Las pausas quedan un poco antes del fin de su fase, para que esa fase siga activa en el panel.
const ANTES = 1e-4;

// Geometría del dibujo, en unidades del viewBox.
const G = {
  ancho: 1100, alto: 296,
  suelo: 240, piso: 192, techo: 116,
  cajaX0: 150, cajaX1: 790,
  X0: 158, X1: 782,              // ranuras, del frente (F) a la puerta (R)
  andenX0: 800, andenX1: 1096,
  zonaX0: 828, zonaX1: 976,      // zona del andén donde esperan las unidades
  cubetaX0: 984, cubetaX1: 1036, cubetaAlto: 30,
  letreroX: 1068, letreroY: 88,
  reglaY: 276,
  ruedas: [78, 650, 700], radioRueda: 20,
};

const OP_POR_PASO = Object.fromEntries(Object.values(OPERACIONES).map((o) => [o.paso, o]));
let contador = 0;

// --- Utilidades -------------------------------------------------------------

const sub = (base, i) => `${base}<sub>${i}</sub>`;
const cSub = (j, i) => sub('c', j < 10 && i < 10 ? `${j}${i}` : `${j},${i}`);
const t3 = (x) => fmt(x, 3);
const nombreNodo = (i) => (i === 0 ? 'el depósito' : `el cliente ${i}`);

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
    const cantidad = Math.round(b.unidades);
    for (let j = 0; j < cantidad; j++) mapa.set(`${base}-${k++}`, { slot: pos++, tipo: b.tipo, cliente: b.cliente, unidades: 1 });
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
    const hueco = Math.min(1.6, paso * 0.3);
    const alto = 56;
    const ancho = 46; // celda del andén
    return {
      ...base, paso, hueco, ancho, alto, letra: 10.5, rotulos: true, radio: 3,
      yPiso: G.piso - alto,
      ranura: (s) => ({ x: G.X0 + s * paso + hueco / 2, y: G.piso - alto }),
      cubeta: cubeta(alto, ancho),
    };
  }
  const paso = largo / ranuras;
  const hueco = Math.min(2.4, paso * 0.14);
  const ancho = paso - hueco;
  const alto = Math.min(56, Math.max(14, paso * 2.3));
  const letra = Math.min(12, ancho * 0.66, alto * 0.4);
  return {
    ...base, paso, hueco, ancho, alto, letra,
    rotulos: letra >= 5.5,
    radio: Math.min(3, ancho * 0.2),
    yPiso: G.piso - alto,
    ranura: (s) => ({ x: G.X0 + s * paso + hueco / 2, y: G.piso - alto }),
    cubeta: cubeta(alto, ancho),
  };
}

function leerColores() {
  const tinta = color('--tinta');
  return { y: color('--a'), w: color('--b-fondo'), z: color('--b-puerta'), texto: { y: tinta, z: tinta, w: color('--superficie') } };
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

/**
 * escena: bloque que se lleva a la vista al apretar Iniciar en escritorio (por defecto, el del camión).
 * controles: contenedor aparte para el reproductor (por defecto, dentro de la escena).
 * grafico: contenedor aparte para las barras de carga por tramo (por defecto, dentro de la escena).
 */
export function crear(raiz, estado, { escena = null, controles = null, grafico = null } = {}) {
  let v = null;
  let ctx = null;
  let mm = null;
  let ro = null;
  let bajas = [];

  function render(sim, salida) {
    destruir();
    if (!sim?.paradas?.length || !window.gsap) return;
    v = prepararVista(sim, salida, estado, { controlesAparte: Boolean(controles), graficoAparte: Boolean(grafico) });
    v.escena = escena ?? v.nodo;
    raiz.append(v.nodo);
    controles?.append(v.reproductor);
    grafico?.append(v.grafico);

    ctx = gsap.context(() => {}, raiz);
    v.ctx = ctx;
    mm = gsap.matchMedia(raiz);
    mm.add({ animado: '(prefers-reduced-motion: no-preference)', reducido: '(prefers-reduced-motion: reduce)' }, (contexto) => {
      const vista = v;
      montarLinea(vista, contexto.conditions.reducido ? 'reducido' : 'animado');
      return () => desmontarLinea(vista);
    });

    // Con movimiento reducido las barras se dibujan completas desde el principio
    // (antes se ocultaban con scaleY 0 y nunca crecían).
    v.crecido = movimientoReducido();
    dibujarGrafico(v);
    const vista = v;
    ro = new ResizeObserver(() => {
      cancelAnimationFrame(vista.rafGrafico);
      vista.rafGrafico = requestAnimationFrame(() => dibujarGrafico(vista));
    });
    ro.observe(v.lienzo);
    ctx.add(() => {
      if (!vista.crecido) ScrollTrigger.create({ trigger: vista.grafico, start: 'top 88%', once: true, onEnter: () => crecerGrafico(vista) });
    });

    bajas = [
      estado.on('hover', (c) => resaltar(vista, c)),
      estado.on('pedirParada', (pedido) => {
        if (pedido) irA(vista, pedido.indice);
      }),
      estado.on('modoContinuo', (continuo) => cambiarContinuo(vista, continuo)),
    ];
    resaltar(v, estado.get('hover'));
  }

  function destruir() {
    for (const baja of bajas) baja();
    bajas = [];
    ro?.disconnect();
    ro = null;
    if (v) {
      cancelAnimationFrame(v.rafGrafico);
      detener(v);
    }
    mm?.revert();
    mm = null;
    ctx?.revert();
    ctx = null;
    if (v) ocultarTooltip();
    raiz.replaceChildren();
    controles?.replaceChildren();
    grafico?.replaceChildren();
    v = null;
  }

  return { render, destruir };
}

// --- Construcción del DOM -----------------------------------------------------

function prepararVista(sim, salida, estado, { controlesAparte = false, graficoAparte = false } = {}) {
  const n = sim.paradas.length;
  const v = {
    sim, salida, estado, n,
    uid: ++contador,
    geo: geometria(sim),
    colores: leerColores(),
    fases: [], iFase: -1, kActual: null, andenActual: null,
    activos: new Set(), barras: [], crecido: false, tamGrafico: '',
    ultimaCarga: '', ultimoReloj: '', ultimoReproductor: '',
    tl: null, modo: null, reproduccion: null, reproduciendo: false, continuo: Boolean(estado.get('modoContinuo')),
    hist: new Map(), piezas: [], pausas: [],
  };

  // Cabecera: estado y paradas
  v.faseNodo = el('span', { class: 'camion-estado__fase' }, 'Depósito');
  v.textoNodo = el('span', { class: 'camion-estado__texto' });
  v.relojNodo = el('span', { class: 'camion-estado__reloj num', title: 'Instante del modelo' }, 't = 0');
  const indices = [-1, ...sim.paradas.map((_, k) => k), n];
  v.pills = indices.map((idx) => {
    const p = sim.paradas[idx];
    const clase = p ? (p.politica === 1 ? 'paso--p1' : 'paso--p2') : 'paso--deposito';
    const etiqueta = p
      ? `Parada ${p.k}: cliente ${p.cliente}, ${p.politica === 1 ? 'política 1' : 'política 2'}`
      : idx < 0 ? 'Depósito: carga inicial' : 'Regreso al depósito';
    const boton = el('button', { type: 'button', class: `paso ${clase}`, 'aria-label': etiqueta, title: etiqueta, onclick: () => irA(v, idx) }, p ? String(p.cliente) : '0');
    if (p) {
      boton.addEventListener('pointerenter', () => estado.set({ hover: p.cliente }));
      boton.addEventListener('pointerleave', () => estado.set({ hover: null }));
    }
    boton._cliente = p ? p.cliente : null;
    return boton;
  });
  const ruta = el('div', { class: `pasos camion-ruta${n > 10 ? ' camion-ruta--densa' : ''}`, role: 'group', 'aria-label': 'Paradas de la ruta' },
    v.pills.flatMap((b, j) => (j === 0 ? [b] : [el('span', { class: 'pasos__flecha', 'aria-hidden': 'true' }, '→'), b])));
  const cabecera = el('div', { class: 'camion-cabecera' },
    el('div', { class: 'camion-estado' }, v.faseNodo, v.textoNodo, v.relojNodo),
    ruta);

  // Figura del camión
  construirSVG(v);
  const seg = v.geo.segmentos;
  const leyenda = el('ul', { class: 'camion-leyenda', 'aria-label': 'Leyenda de la carga' },
    itemLeyenda('var(--a)', '<strong>y</strong> entrega · número = cliente de destino'),
    itemLeyenda('var(--b-fondo)', '<strong>w</strong> recogida al fondo · número = cliente de origen'),
    itemLeyenda('var(--b-puerta)', '<strong>z</strong> recogida junto a la puerta'),
    el('li', {}, el('span', { class: 'camion-muestra camion-muestra--libre' }), seg ? 'espacio libre' : 'ranura libre'),
    seg ? el('li', { class: 'camion-leyenda__nota', html: `Bloques a escala: <strong>y·3 (7)</strong> = 7 unidades para el cliente 3` }) : null);
  const figura = el('figure', { class: 'camion-figura' }, v.svgCamion, leyenda);

  // Reproductor
  construirReproductor(v);

  // Panel de operación
  construirPanel(v);

  // Gráfico de barras
  v.lienzo = el('div', { class: 'camion-grafico__lienzo' });
  v.grafico = el('div', { class: 'camion-grafico' },
    el('div', { class: 'camion-grafico__cabecera' },
      el('h3', { class: 'camion-grafico__titulo' }, 'Carga a bordo en cada tramo'),
      el('ul', { class: 'camion-grafico__leyenda', 'aria-hidden': 'true' },
        itemLeyenda('var(--b-fondo)', 'w'), itemLeyenda('var(--a)', 'y'), itemLeyenda('var(--b-puerta)', 'z'),
        el('li', {}, el('span', { class: 'camion-muestra camion-muestra--q' }), `Q = ${fmt(sim.Q)}`))),
    v.lienzo);

  v.nodo = el('div', { class: 'camion' },
    el('div', { class: 'camion-escena' }, cabecera, figura, controlesAparte ? null : v.reproductor, v.panel, graficoAparte ? null : v.grafico));
  return v;
}

// Las propiedades personalizadas (--color) no se pueden asignar con
// Object.assign(nodo.style, …): se pasan como texto del atributo style.
const conColor = (token) => `--color: ${token}`;

function itemLeyenda(colorToken, html) {
  return el('li', {}, el('span', { class: 'camion-muestra', style: conColor(colorToken) }), el('span', { html }));
}

function construirSVG(v) {
  const { geo, sim } = v;
  const idTrama = `camion-trama-${v.uid}`;
  const idTramaAnden = `camion-trama-anden-${v.uid}`;

  const defs = svg('defs', {},
    svg('pattern', { id: idTrama, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('line', { class: 'camion-trama', x1: 0, y1: 0, x2: 0, y2: 5 })),
    svg('pattern', { id: idTramaAnden, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' },
      svg('line', { class: 'camion-trama camion-trama--anden', x1: 0, y1: 0, x2: 0, y2: 7 })));

  // Calle: los trazos del carril se desplazan durante los viajes
  v.carril = svg('line', { class: 'camion-calle__carril', x1: -40, y1: G.suelo + 11, x2: G.ancho + 40, y2: G.suelo + 11, 'stroke-dashoffset': 0 });
  const calle = svg('g', { class: 'camion-calle' },
    svg('rect', { class: 'camion-calle__asfalto', x: 0, y: G.suelo, width: G.ancho, height: 22 }),
    v.carril,
    svg('line', { class: 'camion-calle__borde', x1: 0, y1: G.suelo, x2: G.ancho, y2: G.suelo }));

  // Andén (fondo, antes de las unidades) y frente de la cubeta (después)
  const placa = G.letreroY;
  v.letrero = {};
  v.letrero.num = svg('text', { class: 'camion-letrero__num', x: G.letreroX, y: placa }, '0');
  v.letrero.etq = svg('text', { class: 'camion-letrero__etq', x: G.letreroX, y: placa - 27 }, 'Depósito');
  v.letrero.nodo = svg('g', { class: 'camion-letrero camion-letrero--deposito' },
    svg('line', { class: 'camion-letrero__poste', x1: G.letreroX, y1: G.piso, x2: G.letreroX, y2: placa }),
    svg('circle', { class: 'camion-letrero__placa camion-letrero__placa--cliente', cx: G.letreroX, cy: placa, r: 17 }),
    svg('rect', { class: 'camion-letrero__placa camion-letrero__placa--deposito', x: G.letreroX - 16, y: placa - 16, width: 32, height: 32, rx: 5 }),
    v.letrero.num, v.letrero.etq);
  const anchoAnden = G.andenX1 - G.andenX0;
  const altoAnden = G.suelo - G.piso;
  const andenFondo = svg('g', { class: 'camion-anden camion-anden--deposito' },
    svg('rect', { class: 'camion-anden__base', x: G.andenX0, y: G.piso, width: anchoAnden, height: altoAnden }),
    svg('rect', { x: G.andenX0, y: G.piso, width: anchoAnden, height: altoAnden, fill: `url(#${idTramaAnden})` }),
    svg('line', { class: 'camion-anden__borde', x1: G.andenX0, y1: G.piso, x2: G.andenX1, y2: G.piso }),
    svg('rect', { class: 'camion-anden__tope', x: G.andenX0 - 5, y: G.piso + 3, width: 9, height: 16, rx: 2 }),
    svg('text', { class: 'camion-anden__rotulo', x: G.andenX0 + 14, y: G.piso + 29 }, 'ANDÉN'),
    svg('rect', { class: 'camion-cubeta camion-cubeta__fondo', x: G.cubetaX0 - 2, y: G.piso - G.cubetaAlto - 6, width: G.cubetaX1 - G.cubetaX0 + 4, height: G.cubetaAlto + 6, rx: 2 }),
    v.letrero.nodo);
  v.cubetaRotulo = svg('text', { class: 'camion-cubeta__rotulo', x: (G.cubetaX0 + G.cubetaX1) / 2, y: G.piso - G.cubetaAlto / 2 }, 'entrega');
  const andenFrente = svg('g', { class: 'camion-anden camion-anden--deposito' },
    svg('g', { class: 'camion-cubeta' },
      svg('path', { class: 'camion-cubeta__frente', d: `M${G.cubetaX0 - 4} ${G.piso - G.cubetaAlto} L${G.cubetaX1 + 4} ${G.piso - G.cubetaAlto} L${G.cubetaX1} ${G.piso} L${G.cubetaX0} ${G.piso} Z` }),
      v.cubetaRotulo));
  v.anden = [andenFondo, andenFrente];

  // Ranuras vacías (una por unidad, o una franja continua con segmentos), unidades y caja
  const ranuras = svg('g', { class: 'camion-ranuras' });
  if (geo.segmentos) {
    const x0 = geo.ranura(0).x;
    ranuras.append(svg('rect', {
      class: 'camion-ranura', x: x0, y: geo.yPiso, width: Math.max(1, sim.Q * geo.paso - geo.hueco), height: geo.alto, rx: geo.radio, fill: `url(#${idTrama})`,
    }));
    const cada = intervaloMarcas(geo.paso, 26, 10);
    for (let s = cada; s < sim.Q - 1e-9; s += cada) {
      const x = G.X0 + s * geo.paso;
      ranuras.append(svg('line', { class: 'camion-ranura__division', x1: x, y1: geo.yPiso + 4, x2: x, y2: G.piso - 4 }));
    }
  } else {
    for (let s = 0; s < geo.ranuras; s++) {
      const p = geo.ranura(s);
      ranuras.append(svg('rect', { class: 'camion-ranura', x: p.x, y: p.y, width: geo.ancho, height: geo.alto, rx: geo.radio, fill: `url(#${idTrama})` }));
    }
  }
  v.capaUnidades = svg('g', { class: 'camion-unidades' });
  crearUnidades(v);

  const altoPuerta = G.piso - G.techo - 6;
  const nervios = [];
  for (let y = G.techo + 13; y < G.piso - 4; y += 8) nervios.push(svg('line', { class: 'camion-puerta__nervio', x1: G.X1 + 1.5, y1: y, x2: G.X1 + 6.5, y2: y }));
  v.puerta = svg('g', { class: 'camion-puerta' },
    svg('rect', { class: 'camion-puerta__hoja', x: G.X1, y: G.techo + 6, width: 8, height: altoPuerta }),
    nervios,
    svg('rect', { class: 'camion-puerta__manija', x: G.X1 + 2.5, y: G.piso - 15, width: 3, height: 7, rx: 1 }));

  v.cuerpo = svg('g', { class: 'camion-cuerpo' },
    svg('rect', { class: 'camion-chasis', x: 30, y: 200, width: 760, height: 8, rx: 2 }),
    svg('rect', { class: 'camion-escape', x: 145.5, y: 96, width: 4, height: 106, rx: 2 }),
    svg('rect', { class: 'camion-escape', x: 144, y: 93, width: 7, height: 5, rx: 1.5 }),
    svg('path', { class: 'camion-cabina', d: 'M144 204 L144 128 L86 128 Q74 128 68 137 L50 166 L34 172 Q28 174 28 180 L28 200 Q28 204 32 204 Z' }),
    svg('path', { class: 'camion-ventana', d: 'M88 136 L136 136 L136 162 L60 162 L73 141 Q77 136 88 136 Z' }),
    svg('path', { class: 'camion-detalle', d: 'M100 136 L100 200 M108 177 L119 177' }),
    svg('rect', { class: 'camion-faro', x: 29, y: 180, width: 6, height: 7, rx: 1.5 }),
    svg('rect', { class: 'camion-chasis', x: 22, y: 192, width: 16, height: 12, rx: 3 }),
    svg('rect', { class: 'camion-caja__fondo', x: G.X0 - 2, y: G.techo + 6, width: G.X1 - G.X0 + 2, height: altoPuerta }),
    ranuras,
    v.capaUnidades,
    svg('rect', { class: 'camion-caja__marco', x: G.cajaX0, y: G.techo, width: G.cajaX1 - G.cajaX0, height: 6, rx: 2 }),
    svg('rect', { class: 'camion-caja__marco', x: G.cajaX0, y: G.piso, width: G.cajaX1 - G.cajaX0, height: 8, rx: 1.5 }),
    svg('rect', { class: 'camion-caja__marco', x: G.cajaX0, y: G.techo, width: 6, height: G.piso - G.techo + 8, rx: 1.5 }),
    v.puerta,
    svg('text', { class: 'camion-rotulo', x: G.cajaX0 + 10, y: G.techo - 9 }, 'F · frente'),
    svg('line', { class: 'camion-cota', x1: G.cajaX0 + 90, y1: G.techo - 13, x2: G.cajaX1 - 84, y2: G.techo - 13 }),
    svg('text', { class: 'camion-rotulo camion-rotulo--fin', x: G.cajaX1, y: G.techo - 9 }, 'R · puerta'));

  v.ruedas = G.ruedas.map((cx) => {
    const cy = G.suelo - G.radioRueda;
    return svg('g', { class: 'camion-rueda' },
      svg('circle', { class: 'camion-rueda__llanta', cx, cy, r: G.radioRueda }),
      svg('circle', { class: 'camion-rueda__aro', cx, cy, r: 10 }),
      svg('path', { class: 'camion-rueda__rayos', d: `M${cx - 9} ${cy} L${cx + 9} ${cy} M${cx} ${cy - 9} L${cx} ${cy + 9}` }),
      svg('circle', { class: 'camion-rueda__eje', cx, cy, r: 2.8 }));
  });

  v.svgCamion = svg('svg', {
    class: 'camion-svg', viewBox: `0 0 ${G.ancho} ${G.alto}`, preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': `Camión con ${fmt(sim.Q)} ranuras de carga`,
  },
  defs, calle, construirRegla(v),
  svg('ellipse', { class: 'camion-sombra', cx: 410, cy: G.suelo + 1, rx: 392, ry: 4 }),
  andenFondo,
  svg('g', { class: 'camion-vehiculo' }, v.cuerpo, v.ruedas),
  andenFrente);
}

/** Menor intervalo "redondo" (múltiplo de 5 y de `minimo`) cuyas marcas quedan a `px` o más. */
function intervaloMarcas(paso, px, minimo = 5) {
  const candidatos = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  return candidatos.find((c) => c >= minimo && c % minimo === 0 && c * paso >= px) ?? candidatos[candidatos.length - 1];
}

function construirRegla(v) {
  const { geo, sim } = v;
  const y = G.reglaY;
  const xDe = (s) => G.X0 + s * geo.paso;
  const fin = geo.segmentos ? geo.capacidad : geo.ranuras;
  const g = svg('g', { class: 'camion-regla', 'aria-hidden': 'true' },
    svg('line', { class: 'camion-regla__linea', x1: xDe(0), y1: y, x2: xDe(fin), y2: y }),
    svg('text', { class: 'camion-regla__titulo', x: G.X0 - 10, y: y + 4 }, geo.segmentos ? 'unidades' : 'ranuras'));
  // Marcas cada 5 unidades (o más, si quedan muy juntas) y cada unidad si hay espacio
  const mayor = intervaloMarcas(geo.paso, 7);
  const numero = intervaloMarcas(geo.paso, 34, mayor);
  const xQ = xDe(sim.Q);
  for (let s = 0; s <= fin + 1e-9; s++) {
    const esMayor = s % mayor === 0;
    if (!esMayor && geo.paso < 6) continue;
    g.append(svg('line', { class: `camion-regla__marca${esMayor ? ' camion-regla__marca--mayor' : ''}`, x1: xDe(s), y1: y - (esMayor ? 7 : 3), x2: xDe(s), y2: y }));
    const x = xDe(s);
    if (s % numero === 0 && (x < xQ - 18 || x > xQ + 64)) g.append(svg('text', { class: 'camion-regla__num', x, y: y + 14 }, String(s)));
  }
  g.append(svg('line', { class: 'camion-regla__q', x1: xQ, y1: y - 12, x2: xQ, y2: y + 5 }));
  g.append(svg('text', { class: 'camion-regla__rotulo', x: xQ + 7, y: y + 4 }, `Q = ${fmt(sim.Q)}`));
  return g;
}

function crearUnidades(v) {
  const { geo, sim } = v;
  v.unidades = [];
  v.porId = new Map();
  v.rotulosB = [];
  const crear = (id, pref, cliente, k, total, unidades) => {
    // Con segmentos el bloque mide lo que ocupa a bordo y se compacta en el andén.
    const anchoAbordo = geo.segmentos ? Math.max(0.8, unidades * geo.paso - geo.hueco) : geo.ancho;
    const anchoAnden = geo.segmentos ? Math.min(geo.ancho, Math.max(anchoAbordo, 10)) : geo.ancho;
    const minimo = Math.min(anchoAbordo, anchoAnden);
    const caja = svg('rect', { class: 'camion-u__caja', width: anchoAbordo, height: geo.alto, rx: Math.min(geo.radio, minimo * 0.2) });
    const textos = [];
    if (!geo.segmentos) {
      textos.push(svg('text', {
        class: `camion-u__num${geo.rotulos ? '' : ' camion-u__num--oculto'}`,
        x: anchoAbordo / 2, y: geo.alto / 2, 'font-size': geo.letra.toFixed(1),
      }, String(cliente)));
    } else if (minimo >= 32) {
      // Rótulo en dos líneas: "y·3" y "(7)"
      textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2 - 7, 'font-size': '11' }, `${pref === 'y' ? 'y' : 'z'}·${cliente}`));
      textos.push(svg('text', { class: 'camion-u__num camion-u__num--cant', x: anchoAbordo / 2, y: geo.alto / 2 + 9, 'font-size': '9.5' }, `(${fmt(unidades)})`));
    } else if (minimo >= 14) {
      textos.push(svg('text', { class: 'camion-u__num', x: anchoAbordo / 2, y: geo.alto / 2, 'font-size': '10' }, String(cliente)));
    }
    const g = svg('g', { class: `camion-u camion-u--${pref}`, dataset: { unidad: id } }, caja, textos);
    const u = {
      id, g, caja, textos, cliente, entrega: pref === 'y', k, total, unidades, anchoAbordo, anchoAnden,
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

function construirPanel(v) {
  const { sim, n } = v;
  v.vistas = new Map();
  v.titulos = [];
  v.bloquesOrden = [];
  v.vistas.set(-1, vistaInicio(v));
  sim.paradas.forEach((p, k) => v.vistas.set(k, vistaParada(v, p, k)));
  v.vistas.set(n, vistaRegreso(v));

  v.cont = {};
  const crearContador = (clave, html) => {
    v.cont[clave] = el('span', { class: 'camion-contador__valor num' }, '0');
    return el('div', { class: `camion-contador camion-contador--${clave.toLowerCase()}` },
      el('span', { class: 'camion-contador__etq', html }), v.cont[clave]);
  };
  v.seg = {
    w: el('span', { class: 'camion-ocupacion__seg camion-ocupacion__seg--w' }),
    y: el('span', { class: 'camion-ocupacion__seg camion-ocupacion__seg--y' }),
    z: el('span', { class: 'camion-ocupacion__seg camion-ocupacion__seg--z' }),
  };
  v.ocupacion = el('div', { class: 'camion-ocupacion', role: 'img', 'aria-label': 'Ocupación de la caja' }, v.seg.w, v.seg.y, v.seg.z);
  v.ocupTotal = el('span', {}, '');
  v.ocupPct = el('span', {}, '');
  const medidor = el('div', { class: 'camion-medidor' },
    el('p', { class: 'camion-medidor__titulo' }, 'A bordo ahora'),
    el('div', { class: 'camion-contadores' },
      crearContador('w', 'w · fondo'), crearContador('y', 'y · entregas'), crearContador('z', 'z · puerta'),
      crearContador('libre', 'libre'), crearContador('Q', 'Q')),
    v.ocupacion,
    el('p', { class: 'camion-ocupacion__nota' }, v.ocupTotal, v.ocupPct));
  v.cont.Q.textContent = fmt(sim.Q);

  v.panel = el('aside', { class: 'camion-panel', 'aria-label': 'Operaciones de carga en la parada' }, [...v.vistas.values()], medidor);
}

function tituloCliente(v, p, extra) {
  const titulo = el('h3', {
    class: 'camion-vista__titulo', tabindex: 0,
    onpointerenter: () => v.estado.set({ hover: p.cliente }),
    onpointerleave: () => v.estado.set({ hover: null }),
    onfocus: () => v.estado.set({ hover: p.cliente }),
    onblur: () => v.estado.set({ hover: null }),
  },
  el('span', { class: `cliente-chip${p.politica === 1 ? '' : ' cliente-chip--p2'}` }, String(p.cliente)),
  `Cliente ${p.cliente}`,
  extra);
  v.titulos.push({ nodo: titulo, cliente: p.cliente });
  return titulo;
}

function listaOrden(v, pila, etiqueta) {
  if (!pila.length) return el('p', { class: 'camion-orden__vacio' }, 'Caja vacía.');
  return el('ol', { class: 'camion-orden', 'aria-label': etiqueta },
    el('li', { class: 'camion-orden__extremo', title: 'Frente' }, 'F'),
    pila.map((b) => {
      const tipo = b.tipo === 'y' ? `entrega para el cliente ${b.cliente}` : `recogida en el cliente ${b.cliente} (${b.tipo})`;
      const nodo = el('li', {
        class: `camion-orden__bloque camion-orden__bloque--${b.tipo}`, title: `${fmt(b.unidades)} × ${tipo}`,
        onpointerenter: () => v.estado.set({ hover: b.cliente }),
        onpointerleave: () => v.estado.set({ hover: null }),
      }, String(b.cliente), el('small', {}, `×${fmt(b.unidades)}`));
      v.bloquesOrden.push({ nodo, cliente: b.cliente });
      return nodo;
    }),
    el('li', { class: 'camion-orden__extremo', title: 'Puerta' }, 'R'));
}

function vistaInicio(v) {
  const { sim } = v;
  return el('div', { class: 'camion-vista' },
    el('p', { class: 'camion-vista__ante' }, 'Antes de salir'),
    el('h3', { class: 'camion-vista__titulo' }, el('span', { class: 'camion-deposito', 'aria-hidden': 'true' }, '0'), 'Carga inicial'),
    el('p', {
      class: 'camion-vista__texto',
      html: `El camión sale del depósito con todas las entregas: ${fmt(sim.cargaInicial.y)} unidades en Q = ${fmt(sim.Q)}. Se cargan en orden inverso a la ruta, así la entrega del primer cliente queda junto a la puerta.`,
    }),
    listaOrden(v, sim.arcos[0].pila, 'Carga inicial, del frente a la puerta'));
}

function itemViaje(desde, hasta, c, inicio, fin, llegada) {
  return el('li', { class: 'camion-op camion-op--viaje', style: conColor('var(--viaje)'), dataset: { orden: 0 } },
    el('span', { class: 'camion-op__num', 'aria-hidden': 'true' }, '→'),
    el('div', { class: 'camion-op__cuerpo' },
      el('p', { class: 'camion-op__desc' }, `Viaje desde ${nombreNodo(desde)}`),
      el('p', { class: 'camion-op__formula', html: `${cSub(desde, hasta)} = <strong>${t3(c)}</strong>` }),
      el('p', { class: 'camion-op__t', html: `${t3(inicio)} → ${t3(fin)} = ${llegada}` })));
}

function hito(marca, valor, nota, orden) {
  return el('li', { class: 'camion-hito', dataset: { orden } },
    el('span', { class: 'camion-hito__marca', html: marca }),
    el('span', { class: 'camion-hito__valor' }, `= ${t3(valor)}`),
    el('span', {}, nota));
}

function vistaParada(v, p, k) {
  const { sim, n } = v;
  const i = p.cliente;
  const siguiente = sim.paradas[k + 1]?.cliente ?? 0;
  const items = [itemViaje(p.desde, i, p.c, p.salidaPrevia, p.T, sub('T', i))];
  for (const paso of [1, 2, 3, 4, 5]) {
    const op = p.ops.find((o) => o.paso === paso);
    items.push(op ? itemOp(op, p) : itemNoAplica(paso, p));
    if (paso === 2) items.push(hito(sub('D', i), p.D, 'entrega completa', 2.5));
  }
  items.push(hito(sub('F', i), p.F, `sale hacia ${nombreNodo(siguiente)}`, 6));

  const vista = el('div', { class: 'camion-vista', hidden: true },
    el('p', { class: 'camion-vista__ante' }, 'Secuencia de la Tabla 3'),
    tituloCliente(v, p, el('span', { class: 'camion-vista__parada' }, `· Parada ${p.k} de ${n}`)),
    el('span', { class: `politica-chip politica-chip--p${p.politica === 1 ? 1 : 2}` }, POLITICA_TEXTO[p.politica]),
    el('dl', { class: 'camion-vista__datos' },
      dato(sub('α', i), fmt(p.alpha), 'entregas'),
      dato(sub('β', i), fmt(p.beta), 'recogidas'),
      dato(sub('T', i), t3(p.T), 'llegada')),
    el('ol', { class: 'camion-pasos', 'aria-label': `Pasos de la Tabla 3 en el cliente ${i}` }, items),
    // Resumen legible en pantallas chicas (oculto con la escena fija)
    el('div', { class: 'camion-vista__orden' },
      el('p', { class: 'camion-vista__ante' }, `Al salir de ${i}, del frente a la puerta`),
      listaOrden(v, p.salida.pila, `Carga al salir del cliente ${i}, del frente a la puerta`)));
  vista._items = items;
  return vista;
}

function dato(simbolo, valor, nota) {
  return el('div', { class: 'camion-dato' }, el('dt', { html: `${simbolo} · ${nota}` }), el('dd', {}, valor));
}

function itemOp(op, p) {
  const i = p.cliente;
  const variable = { 1: 'z', 2: sub('α', i), 3: 'y', 4: `(z + ${sub('β', i)})`, 5: 'y' }[op.paso] ?? '';
  const cantidad = op.paso === 4 ? `(${fmt(p.zEntrada)} + ${fmt(p.beta)})` : fmt(op.unidades);
  const vacia = op.unidades === 0;
  // 4 decimales: con h = 0,1 y parámetros por cliente las tasas pueden ser de milésimas
  return el('li', { class: `camion-op${vacia ? ' camion-op--vacia' : ''}`, style: conColor(`var(--op-${op.param})`), dataset: { orden: op.paso } },
    el('span', { class: 'camion-op__num' }, String(op.paso)),
    el('div', { class: 'camion-op__cuerpo' },
      el('p', { class: 'camion-op__desc' }, op.etiqueta),
      el('p', { class: 'camion-op__formula', html: `${PARAM_HTML[op.param]} · ${variable} = ${fmt(op.tasa, 4)} × ${cantidad} = <strong>${fmt(op.duracion, 4)}</strong>` }),
      el('p', { class: 'camion-op__t' }, vacia ? `${t3(op.inicio)} · sin unidades` : `${t3(op.inicio)} → ${t3(op.fin)}`)));
}

function itemNoAplica(paso, p) {
  const info = OP_POR_PASO[paso];
  return el('li', { class: 'camion-op camion-op--na', style: conColor(`var(--op-${info?.param ?? 'ua'})`) },
    el('span', { class: 'camion-op__num' }, String(paso)),
    el('div', { class: 'camion-op__cuerpo' },
      el('p', { class: 'camion-op__desc' }, info?.etiqueta ?? `Paso ${paso}`),
      el('p', { class: 'camion-op__na' }, p.politica === 1 ? 'No aplica en P1' : 'Sin operación')));
}

function vistaRegreso(v) {
  const { sim, n } = v;
  const a = sim.arcos[n];
  const items = [
    itemViaje(a.desde, 0, a.c, a.inicio, a.fin, 'regreso'),
    hito('fin', sim.regreso, 'el camión vuelve al depósito', 6),
  ];
  const vista = el('div', { class: 'camion-vista', hidden: true },
    el('p', { class: 'camion-vista__ante' }, 'Fin de la ruta'),
    el('h3', { class: 'camion-vista__titulo' }, el('span', { class: 'camion-deposito', 'aria-hidden': 'true' }, '0'), 'Regreso al depósito'),
    el('ol', { class: 'camion-pasos', 'aria-label': 'Regreso al depósito' }, items),
    el('p', {
      class: 'camion-vista__texto',
      html: `Vuelve con ${fmt(a.carga.total)} recogidas a bordo (Σβ = ${fmt(sim.sumaBeta)}). La espera total de los clientes es Σ D<sub>i</sub> = <strong>${t3(sim.objetivo)}</strong>.`,
    }),
    listaOrden(v, a.pila, 'Carga al regresar, del frente a la puerta'));
  vista._items = items;
  return vista;
}

// --- Línea de tiempo ----------------------------------------------------------

function montarLinea(v, modo) {
  v.modo = modo;
  v.nodo.dataset.modo = modo;
  v.iFase = -1;
  v.kActual = null;
  v.andenActual = null;
  v.ultimaCarga = '';
  v.ultimoReloj = '';
  v.ultimoReproductor = '';
  // Siempre pausada: la mueve el reproductor con tweenTo (o seek, con movimiento reducido).
  const tl = construirLinea(v, true);
  v.tl = tl;
  v.pausas = calcularPausas(v);
  sincronizar(v, tl.time());
}

function desmontarLinea(v) {
  detener(v);
  v.tl = null;
}

function construirLinea(v, pausada) {
  const { sim, geo, colores, n } = v;
  const tl = gsap.timeline({ paused: pausada, onUpdate: () => sincronizar(v, tl.time()) });
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
    tl.to(v.ruedas, { rotation: -(k + 1) * 540, duration: d, ease: 'power1.inOut' }, t);
    tl.to(v.carril, { attr: { 'stroke-dashoffset': -(k + 1) * 552 }, duration: d, ease: 'power1.inOut' }, t);
    tl.to(v.cuerpo, { y: -1.8, duration: d / 8, repeat: 7, yoyo: true, ease: 'sine.inOut' }, t);
    tl.to(v.anden, { x: 90, autoAlpha: 0, duration: 0.24, ease: 'power2.in' }, t);
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
        tl.to(u.g, { autoAlpha: 1, y: c.y, duration: DUR.aparecer * 0.55, ease: 'power2.out' }, t + j * escalon);
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
          // Sale por la puerta deslizándose por el piso
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
          // Entra desde el andén hasta su ranura
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

  // --- Fases: lo que muestran el panel, la cabecera y el gráfico en cada tramo
  const Q = sim.Q;
  const textoCarga = (c) => `${fmt(c.total)} de ${fmt(Q)} ${seg ? 'unidades de capacidad' : 'ranuras'} ocupadas`;
  let t = 0;
  tl.addLabel('inicio', 0);
  const c0 = sim.arcos[0].carga;
  fases.push({
    tipo: 'inicio', k: -1, t0: 0, t1: DUR.inicio, orden: -1, carga0: c0, carga1: c0, reloj0: 0, reloj1: 0,
    anden: 0, arcos: [0], etiqueta: 'Depósito', clase: '', html: `Carga inicial · ${textoCarga(c0)}`,
  });
  t = DUR.inicio;

  sim.paradas.forEach((p, k) => {
    const i = p.cliente;
    const arcoK = sim.arcos[k];
    const claseServicio = p.politica === 1 ? 'camion-estado__fase--servicio' : 'camion-estado__fase--servicio-p2';
    const htmlViaje = `${p.desde} → ${i} · ${cSub(p.desde, i)} = ${t3(p.c)}`;
    const medio = (p.salidaPrevia + p.T) / 2;
    tl.addLabel(`p${k}`, t);
    viajar(t, k);
    const viaje = { tipo: 'viaje', k, orden: 0, carga0: arcoK.carga, carga1: arcoK.carga, arcos: [k], etiqueta: 'Viajando', clase: '', html: htmlViaje };
    fases.push({ ...viaje, t0: t, t1: t + DUR.viaje / 2, reloj0: p.salidaPrevia, reloj1: medio, anden: p.desde });
    fases.push({ ...viaje, t0: t + DUR.viaje / 2, t1: t + DUR.viaje, reloj0: medio, reloj1: p.T, anden: i });
    t += DUR.viaje;

    tl.addLabel(`llega${k}`, t);
    tl.to(v.puerta, { scaleY: 0.1, duration: DUR.puerta, ease: 'power2.inOut' }, t);
    const servicio = { k, anden: i, arcos: [k, k + 1], etiqueta: `Cliente ${i}`, clase: claseServicio };
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
      ...servicio, tipo: 'pausa', t0: t, t1: t + DUR.pausa, orden: 6, arcos: [k + 1],
      carga0: p.salida.carga, carga1: p.salida.carga, reloj0: p.F, reloj1: p.F,
      html: `Atendido en ${sub('D', i)} = ${t3(p.D)} · sale en ${sub('F', i)} = ${t3(p.F)}`,
    });
    t += DUR.pausa;
  });

  const ultimo = sim.arcos[n];
  const medio = (ultimo.inicio + ultimo.fin) / 2;
  tl.addLabel('regreso', t);
  viajar(t, n);
  const regreso = { tipo: 'regreso', k: n, orden: 0, carga0: ultimo.carga, carga1: ultimo.carga, arcos: [n], etiqueta: 'Viajando', clase: '', html: `${ultimo.desde} → 0 · ${cSub(ultimo.desde, 0)} = ${t3(ultimo.c)}` };
  fases.push({ ...regreso, t0: t, t1: t + DUR.viaje / 2, reloj0: ultimo.inicio, reloj1: medio, anden: ultimo.desde });
  fases.push({ ...regreso, t0: t + DUR.viaje / 2, t1: t + DUR.viaje, reloj0: medio, reloj1: ultimo.fin, anden: 0 });
  t += DUR.viaje;
  tl.addLabel('fin', t);
  // Al terminar no se destaca ningún tramo: el gráfico queda completo.
  fases.push({
    tipo: 'fin', k: n, t0: t, t1: t + DUR.fin, orden: 6, carga0: ultimo.carga, carga1: ultimo.carga,
    reloj0: sim.regreso, reloj1: sim.regreso, anden: 0, arcos: [], etiqueta: 'Depósito', clase: '',
    html: `Fin de la ruta · ${fmt(ultimo.carga.total)} recogidas a bordo`,
  });
  tl.to({}, { duration: DUR.fin }, t);

  // Piezas del avance que sigue el mapa: en el tramo k, el viaje va de 0 a 1 y el servicio
  // en el cliente de llegada de 0 a 0,5 hasta cerrar la puerta y de 0,5 a 1 en la pausa.
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

// --- Sincronización del panel, la cabecera y el gráfico -----------------------

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
  pintarContadores(v, f, u);
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

/** Punto del recorrido en el instante t de la línea, en las unidades que entiende el mapa. */
function avanceEn(v, t, reloj) {
  const pieza = v.piezas.find((p) => t < p.t1) ?? v.piezas[v.piezas.length - 1];
  const u = pieza.t1 > pieza.t0 ? Math.min(1, Math.max(0, (t - pieza.t0) / (pieza.t1 - pieza.t0))) : 1;
  const mezcla = ([a, b]) => a + (b - a) * u;
  return { tramo: pieza.tramo, viaje: mezcla(pieza.viaje), servicio: mezcla(pieza.servicio), reloj };
}

function aplicarFase(v, f) {
  const { n } = v;
  if (f.k !== v.kActual) {
    v.kActual = f.k;
    for (const [k, vista] of v.vistas) vista.hidden = k !== f.k;
    v.pills.forEach((b, j) => {
      const idx = j - 1;
      if (idx === f.k) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('paso--hecho', idx < f.k);
    });
  }
  const vista = v.vistas.get(f.k);
  for (const item of vista?._items ?? []) {
    const orden = Number(item.dataset.orden);
    item.classList.toggle('es-hecha', orden < f.orden);
    item.classList.toggle('es-activa', orden === f.orden);
    if (orden === f.orden) {
      item.setAttribute('aria-current', 'step');
      centrarEnPanel(v, item);
    } else item.removeAttribute('aria-current');
  }

  v.faseNodo.textContent = f.etiqueta;
  v.faseNodo.className = `camion-estado__fase ${f.clase}`.trim();
  v.textoNodo.innerHTML = f.html;

  v.activos = new Set(f.arcos.filter((k) => k >= 0 && k <= n));
  pintarActivos(v);
  // Por si el disparador del gráfico no llegó a activarse (p. ej. al cargar a mitad de página)
  if (!v.crecido && f.k >= 0) crecerGrafico(v);
  if (f.anden !== v.andenActual) pintarLetrero(v, f.anden);

  const c = f.carga1;
  v.svgCamion.setAttribute('aria-label',
    `Camión con ${fmt(v.sim.Q)} ranuras. A bordo: ${fmt(c.y)} entregas, ${fmt(c.w)} recogidas al fondo y ${fmt(c.z)} junto a la puerta; ${fmt(v.sim.Q - c.total)} libres.`);
}

/** Si el panel tiene alto fijo (escritorio) y no cabe todo, lleva el paso activo a la vista sin mover la página. */
function centrarEnPanel(v, item) {
  const panel = v.panel;
  if (panel.scrollHeight <= panel.clientHeight + 1) return;
  const arriba = item.offsetTop - panel.clientHeight / 2 + item.offsetHeight / 2;
  panel.scrollTop = Math.max(0, Math.min(arriba, panel.scrollHeight - panel.clientHeight));
}

function pintarContadores(v, f, u) {
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
  v.cont.w.textContent = fmt(w);
  v.cont.y.textContent = fmt(y);
  v.cont.z.textContent = fmt(z);
  v.cont.libre.textContent = fmt(Q - total);
  const ref = Math.max(Q, total) || 1;
  v.seg.w.style.width = `${(w / ref) * 100}%`;
  v.seg.y.style.width = `${(y / ref) * 100}%`;
  v.seg.z.style.width = `${(z / ref) * 100}%`;
  v.ocupTotal.textContent = `${fmt(total)} / ${fmt(Q)} a bordo`;
  v.ocupPct.textContent = `${fmt(Q > 0 ? (total / Q) * 100 : 0, 0)} %`;
  v.ocupacion.setAttribute('aria-label', `Ocupación: ${fmt(total)} de ${fmt(Q)}`);
}

function pintarLetrero(v, cliente) {
  v.andenActual = cliente;
  const p = v.sim.porCliente.get(cliente);
  for (const g of v.anden) g.classList.toggle('camion-anden--deposito', !p);
  v.letrero.nodo.classList.toggle('camion-letrero--deposito', !p);
  v.letrero.nodo.classList.toggle('camion-letrero--p2', Boolean(p) && p.politica === 0);
  v.letrero.num.textContent = String(cliente);
  v.letrero.etq.textContent = p ? 'Cliente' : 'Depósito';
  v.cubetaRotulo.textContent = p ? `Cliente ${cliente}` : '';
}

/** Elige una parada: -1 es el depósito al salir, k la llegada al cliente k y n el regreso. */
function irA(v, indice) {
  const tl = v.tl;
  if (!tl) return;
  const k = Math.max(-1, Math.min(v.n, indice));
  irATiempo(v, k < 0 ? 0 : k >= v.n ? tl.labels.fin : tl.labels[`llega${k}`]);
}

// --- Reproductor --------------------------------------------------------------
// Volver al inicio · pausa anterior · Iniciar / Pausar / Continuar / Repetir ·
// interruptor Modo continuo · barra de avance (clic o arrastre para saltar).

const ICONOS = {
  inicio: 'M3.5 3h2v10h-2zM13 3v10L6.5 8z',
  atras: 'M10.5 3.5 6 8l4.5 4.5',
  reproducir: 'M5 3v10l8-5z',
  pausar: 'M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z',
  repetir: 'M12.6 9.2A4.8 4.8 0 1 1 11.2 4.6M12.6 2.6v3.2H9.4',
};
const icono = (nombre) => svg('svg', { class: `camion-icono camion-icono--${nombre}`, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
  svg('path', { d: ICONOS[nombre] }));

function construirReproductor(v) {
  const boton = (clase, etiqueta, nombre, onclick) => el('button', {
    type: 'button', class: `camion-reproductor__boton ${clase}`, 'aria-label': etiqueta, title: etiqueta, onclick,
  }, icono(nombre));
  v.btnInicio = boton('', 'Volver al inicio', 'inicio', () => irATiempo(v, 0));
  v.btnAtras = boton('', 'Explicación anterior', 'atras', () => irATiempo(v, pausaAnterior(v, v.tl?.time() ?? 0)));
  v.btnPrincipalIcono = el('span', { class: 'camion-reproductor__icono' });
  v.btnPrincipalTexto = el('span', {});
  v.btnPrincipal = el('button', { type: 'button', class: 'camion-reproductor__principal', onclick: () => alternar(v) },
    v.btnPrincipalIcono, v.btnPrincipalTexto);
  v.interruptor = el('button', {
    type: 'button', role: 'switch', class: 'camion-reproductor__continuo', 'aria-checked': String(v.continuo),
    title: 'Encendido: el camión recorre la ruta sin parar. Apagado: se detiene en cada paso hasta apretar Continuar.',
    onclick: () => v.estado.set({ modoContinuo: !v.continuo }),
  }, el('span', { class: 'camion-reproductor__pista', 'aria-hidden': 'true' }, el('span', { class: 'camion-reproductor__perilla' })), 'Modo continuo');

  v.relleno = el('span', { class: 'camion-reproductor__relleno' });
  v.marcasAvance = el('span', { class: 'camion-reproductor__marcas' });
  v.barraAvance = el('div', { class: 'camion-reproductor__barra', 'aria-hidden': 'true', title: 'Clic o arrastre para ir a otro momento' },
    v.relleno, v.marcasAvance);
  const saltar = (e) => {
    const tl = v.tl;
    if (!tl) return;
    const caja = v.barraAvance.getBoundingClientRect();
    irATiempo(v, Math.min(1, Math.max(0, (e.clientX - caja.left) / (caja.width || 1))) * tl.duration());
  };
  v.barraAvance.addEventListener('pointerdown', (e) => {
    v.barraAvance.setPointerCapture(e.pointerId);
    saltar(e);
  });
  v.barraAvance.addEventListener('pointermove', (e) => {
    if (v.barraAvance.hasPointerCapture(e.pointerId)) saltar(e);
  });
  v.contadorAvance = el('span', { class: 'camion-reproductor__contador num' });
  v.notaReproductor = el('p', { class: 'camion-reproductor__nota', 'aria-live': 'polite' });

  v.reproductor = el('div', { class: 'camion-reproductor', role: 'group', 'aria-label': 'Reproducción del recorrido' },
    el('div', { class: 'camion-reproductor__botones' }, v.btnInicio, v.btnAtras, v.btnPrincipal, v.interruptor),
    el('div', { class: 'camion-reproductor__avance' }, v.barraAvance, v.contadorAvance),
    v.notaReproductor);
}

/**
 * Pausas del modo paso a paso: el final de cada paso de la Tabla 3, el final de
 * cada parada (D_i y F_i) y el final del recorrido.
 */
function calcularPausas(v) {
  const pausas = v.fases.filter((f) => f.tipo === 'op' || f.tipo === 'pausa').map((f) => f.t1 - ANTES);
  pausas.push(v.tl.duration());
  // Marcas de las paradas en la barra de avance
  const total = v.tl.duration() || 1;
  v.marcasAvance.replaceChildren(...v.sim.paradas.map((p, k) => el('span', {
    class: `camion-reproductor__marca camion-reproductor__marca--p${p.politica === 1 ? 1 : 2}`,
    style: { left: `${((v.tl.labels[`llega${k}`] / total) * 100).toFixed(2)}%` },
  })));
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
    // Sin animación: salta a la próxima pausa; en modo continuo, sigue tras unos segundos.
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
  // Corriendo: se recalcula el destino (el final o la próxima pausa) desde donde va.
  if (v.reproduciendo) {
    if (v.modo === 'reducido' && !v.continuo) detener(v);
    else if (v.modo !== 'reducido') reproducir(v);
  }
  pintarReproductor(v);
}

/** En escritorio, al empezar se alinea la escena bajo la barra para ver mapa y camión completos. */
function llevarAVista(v) {
  if (!window.matchMedia('(min-width: 960px)').matches || !window.ScrollToPlugin) return;
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
  v.contadorAvance.textContent = `${hechas} / ${v.pausas.length}`;
  v.contadorAvance.title = `Explicación ${hechas} de ${v.pausas.length}`;
  v.notaReproductor.textContent = {
    iniciar: v.continuo ? 'Iniciar recorre toda la ruta sin parar.' : 'Iniciar avanza hasta el primer paso y se detiene para leer la explicación.',
    pausar: v.continuo ? 'Recorriendo la ruta sin parar.' : 'Avanzando hasta el próximo paso…',
    continuar: v.continuo ? 'En pausa.' : 'Lee la explicación del paso y aprieta Continuar.',
    repetir: 'Fin del recorrido.',
  }[modo];
}

// --- Gráfico de barras ----------------------------------------------------------

function dibujarGrafico(v) {
  const d3 = window.d3;
  const lienzo = v.lienzo;
  if (!d3 || !lienzo?.isConnected) return;
  const ancho = Math.round(lienzo.clientWidth);
  const alto = Math.round(lienzo.clientHeight);
  if (ancho < 60 || alto < 60) return;
  const tam = `${ancho}x${alto}`;
  if (tam === v.tamGrafico) return;
  v.tamGrafico = tam;

  const { sim } = v;
  const arcos = sim.arcos;
  const Q = sim.Q;
  const m = { arriba: 20, derecha: ancho < 480 ? 50 : 62, abajo: 26, izquierda: 30 };
  const w = Math.max(10, ancho - m.izquierda - m.derecha);
  const h = Math.max(10, alto - m.arriba - m.abajo);
  const x = d3.scaleBand().domain(d3.range(arcos.length)).range([0, w]).paddingInner(0.3).paddingOuter(0.15);
  const y = d3.scaleLinear().domain([0, Math.max(Q, sim.cargaMaxima) * 1.1]).range([h, 0]).nice();
  const pilas = d3.stack().keys(['w', 'y', 'z'])(arcos.map((a) => a.carga));

  const raizSvg = d3.create('svg')
    .attr('class', 'camion-grafico__svg')
    .attr('viewBox', `0 0 ${ancho} ${alto}`)
    .attr('role', 'img')
    .attr('aria-label', `Carga a bordo en cada tramo de la ruta: ${arcos.map((a) => `${a.desde} a ${a.hasta}, ${fmt(a.carga.total)}`).join('; ')}. Capacidad Q = ${fmt(Q)}.`);
  const g = raizSvg.append('g').attr('transform', `translate(${m.izquierda},${m.arriba})`);

  const marcas = y.ticks(Math.max(2, Math.min(6, Math.floor(h / 38))));
  g.append('g').attr('class', 'camion-grafico__rejilla')
    .selectAll('line').data(marcas).join('line')
    .attr('x1', 0).attr('x2', w).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
  g.append('g').attr('class', 'camion-grafico__eje')
    .selectAll('text').data(marcas).join('text')
    .attr('x', -8).attr('y', (d) => y(d)).attr('dy', '0.32em').attr('text-anchor', 'end')
    .text((d) => fmt(d));

  const paso = x.step();
  const saltar = paso < 34 ? Math.ceil(34 / paso) : 1;
  v.barras = [];
  g.append('g').selectAll('g').data(arcos).join('g')
    .attr('class', 'camion-barra')
    .each(function (a, k) {
      const b = d3.select(this);
      const pila = b.append('g').attr('class', 'camion-barra__pila');
      ['w', 'y', 'z'].forEach((clave, s) => {
        const [y0, y1] = pilas[s][k];
        if (!(y1 > y0)) return;
        pila.append('rect')
          .attr('class', `camion-barra__seg camion-barra__seg--${clave}`)
          .attr('x', x(k)).attr('width', x.bandwidth())
          .attr('y', y(y1)).attr('height', Math.max(0.5, y(y0) - y(y1)));
      });
      const total = b.append('text').attr('class', 'camion-barra__total')
        .attr('x', x(k) + x.bandwidth() / 2).attr('y', y(a.carga.total) - 6)
        .text(fmt(a.carga.total));
      b.append('text').attr('class', 'camion-barra__eje')
        .attr('x', x(k) + x.bandwidth() / 2).attr('y', h + 17).attr('text-anchor', 'middle')
        .text(k % saltar === 0 ? `${a.desde}→${a.hasta}` : '');
      const zona = b.append('rect').attr('class', 'camion-barra__zona')
        .attr('x', x(k) - (paso - x.bandwidth()) / 2).attr('width', paso)
        .attr('y', -m.arriba).attr('height', h + m.arriba + m.abajo);
      const cliente = a.hasta || a.desde;
      conTooltip(zona.node(), () => htmlArco(v, a));
      zona.on('pointerenter', () => v.estado.set({ hover: cliente })).on('pointerleave', () => v.estado.set({ hover: null }));
      v.barras.push({ nodo: this, pila: pila.node(), total: total.node(), arco: a, k });
    });

  g.append('line').attr('class', 'camion-grafico__base').attr('x1', 0).attr('x2', w).attr('y1', h).attr('y2', h);
  g.append('line').attr('class', 'camion-grafico__q').attr('x1', 0).attr('x2', w).attr('y1', y(Q)).attr('y2', y(Q));
  g.append('text').attr('class', 'camion-grafico__q-rotulo').attr('x', w + 6).attr('y', y(Q)).attr('dy', '0.32em').text(`Q = ${fmt(Q)}`);

  v.svgGrafico = raizSvg.node();
  lienzo.replaceChildren(v.svgGrafico);
  if (!v.crecido && window.gsap) {
    gsap.set(v.barras.map((b) => b.pila), { scaleY: 0, transformOrigin: '50% 100%' });
    gsap.set(v.barras.map((b) => b.total), { opacity: 0 });
  }
  pintarActivos(v);
  resaltarBarras(v, v.estado.get('hover'));
}

function crecerGrafico(v) {
  if (v.crecido) return;
  v.crecido = true;
  const hacer = () => {
    gsap.to(v.barras.map((b) => b.pila), { scaleY: 1, duration: 0.8, ease: 'power3.out', stagger: 0.07 });
    gsap.to(v.barras.map((b) => b.total), { opacity: 1, duration: 0.4, delay: 0.35, stagger: 0.07 });
  };
  if (v.ctx) v.ctx.add(hacer);
  else hacer();
}

function pintarActivos(v) {
  if (!v.svgGrafico) return;
  v.svgGrafico.classList.toggle('tiene-foco', v.activos.size > 0);
  for (const b of v.barras) b.nodo.classList.toggle('es-activa', v.activos.has(b.k));
}

function htmlArco(v, a) {
  const Q = v.sim.Q;
  return `<div class="tt-titulo">Tramo ${a.desde} → ${a.hasta}</div>`
    + `<div class="tt-fila"><span>w · recogidas al fondo</span><span>${fmt(a.carga.w)}</span></div>`
    + `<div class="tt-fila"><span>y · entregas pendientes</span><span>${fmt(a.carga.y)}</span></div>`
    + `<div class="tt-fila"><span>z · recogidas junto a la puerta</span><span>${fmt(a.carga.z)}</span></div>`
    + '<div class="tt-sep"></div>'
    + `<div class="tt-fila"><span>A bordo</span><span>${fmt(a.carga.total)} / ${fmt(Q)}</span></div>`
    + `<div class="tt-fila"><span>Libre</span><span>${fmt(Q - a.carga.total)}</span></div>`
    + `<div class="tt-fila"><span>Viaje ${cSub(a.desde, a.hasta)}</span><span>${t3(a.c)}</span></div>`;
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
  const seg = v.geo.segmentos;
  let abordo = 'a bordo';
  if (e.slot != null) {
    abordo = seg
      ? `${fmt(e.slot)} a ${fmt(e.slot + u.unidades)} de ${fmt(v.sim.Q)} desde el frente`
      : `ranura ${e.slot + 1} de ${v.geo.ranuras} desde el frente`;
  }
  const lugar = {
    abordo,
    anden: 'en el andén',
    entregada: 'entregada',
    pendiente: 'aún no se recoge',
  }[e.lugar] ?? '';
  const p = v.sim.porCliente.get(u.cliente);
  return `<div class="tt-titulo">${titulo}</div>`
    + (seg
      ? `<div class="tt-fila"><span>Unidades</span><span>${fmt(u.unidades)}</span></div>`
      : `<div class="tt-fila"><span>Unidad</span><span>${u.k + 1} de ${u.total}</span></div>`)
    + `<div class="tt-fila"><span>Posición</span><span>${lugar}</span></div>`
    + (p ? `<div class="tt-fila"><span>Parada del cliente</span><span>${p.k} de ${v.n}</span></div>` : '');
}

function resaltar(v, c) {
  const activo = c != null && v.sim.porCliente.has(c);
  v.svgCamion.classList.toggle('camion-svg--hover', activo);
  for (const u of v.unidades) u.g.classList.toggle('es-resaltado', activo && u.cliente === c);
  for (const b of v.pills) b.classList.toggle('camion-paso--resaltado', activo && b._cliente === c);
  for (const t of v.titulos) t.nodo.classList.toggle('camion-vista__titulo--resaltado', activo && t.cliente === c);
  for (const b of v.bloquesOrden) b.nodo.classList.toggle('es-resaltado', activo && b.cliente === c);
  resaltarBarras(v, activo ? c : null);
}

function resaltarBarras(v, c) {
  for (const b of v.barras) b.nodo.classList.toggle('es-resaltado', c != null && (b.arco.hasta === c || b.arco.desde === c));
}
