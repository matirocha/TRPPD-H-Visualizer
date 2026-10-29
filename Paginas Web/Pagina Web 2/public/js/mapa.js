// Mapa de la ruta.
//
// Un nodo por cliente con su tarjeta uₐ ℓₐ u_b ℓ_b, arcos con el tiempo de viaje
// c_ij y un camión que recorre la ruta. La línea de tiempo dura n + 1: el tramo
// k se recorre en [k, k + 0,7] y el cliente se atiende en [k + 0,7, k + 1].
// No tiene reproductor propio: sigue a la carga del camión (estado.avance) y
// los clics en nodos se le piden a la carga (estado.pedirParada).
import { PARAMETROS, PARAMETRO_INFO } from './modelo.js';
import {
  PARAM_HTML, POLITICA_TEXTO, conTooltip, el, filaTooltip, fmt, mostrarTooltip, ocultarTooltip,
  paramSVG, politicaCorta, sub, subIndice, svg,
} from './util.js';

const VIAJE = 0.7;               // fracción de cada tramo de la línea dedicada al viaje
const SUAVE = 'power1.inOut';
const MEDIO_CAMION = 14;
const TARJETA = { w: 148, h: 82 };
const DIRECCIONES = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
const FRACCIONES_PILDORA = [0.5, 0.42, 0.58, 0.35, 0.65, 0.28, 0.72];

// Pantalla ancha: tarjetas dentro del SVG. Estrecha: solo nodos, más grandes
// (los tiempos de cada cliente siguen en la tabla de abajo).
const PERFILES = {
  ancho: { W: 800, H: 560, margen: { izq: 150, der: 150, sup: 66, inf: 66 }, r: 19, rDep: 15, fNodo: 14, fPildora: 12, altoPildora: 20, camion: 1, tarjetas: true },
  estrecho: { W: 600, H: 500, margen: { izq: 50, der: 50, sup: 50, inf: 50 }, r: 24, rDep: 19, fNodo: 18, fPildora: 16, altoPildora: 26, camion: 1.3, tarjetas: false },
};

let contador = 0;

const r2 = (v) => Math.round(v * 100) / 100;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const polDe = (p) => (p.politica === 1 ? 1 : 2);

/** Más decimales para valores pequeños (h = 0,1 da tasas de 0,05). */
function fmtValor(v) {
  const a = Math.abs(v);
  if (a < 1e-9) return '0';
  if (a < 0.1) return fmt(v, 3);
  if (a >= 1000) return fmt(v, 0);
  if (a >= 100) return fmt(v, 1);
  return fmt(v, 2);
}

// --- Geometría ---------------------------------------------------------------

/** Curva cuadrática con tabla de largo de arco para ubicar puntos por fracción del largo. */
function curva(P0, C, P1) {
  const punto = (t) => {
    const m = 1 - t;
    return [m * m * P0[0] + 2 * m * t * C[0] + t * t * P1[0], m * m * P0[1] + 2 * m * t * C[1] + t * t * P1[1]];
  };
  const M = 48;
  const acum = [0];
  let previo = P0;
  for (let i = 1; i <= M; i++) {
    const q = punto(i / M);
    acum.push(acum[i - 1] + Math.hypot(q[0] - previo[0], q[1] - previo[1]));
    previo = q;
  }
  const largo = acum[M] || 1;
  const tDe = (f) => {
    const meta = limitar(f, 0, 1) * largo;
    let i = 0;
    while (i < M - 1 && acum[i + 1] < meta) i++;
    const tramo = acum[i + 1] - acum[i] || 1;
    return (i + limitar((meta - acum[i]) / tramo, 0, 1)) / M;
  };
  const angulo = (t) => {
    const dx = 2 * (1 - t) * (C[0] - P0[0]) + 2 * t * (P1[0] - C[0]);
    const dy = 2 * (1 - t) * (C[1] - P0[1]) + 2 * t * (P1[1] - C[1]);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  return {
    largo,
    d: `M${r2(P0[0])} ${r2(P0[1])} Q${r2(C[0])} ${r2(C[1])} ${r2(P1[0])} ${r2(P1[1])}`,
    puntoEn: (f) => punto(tDe(f)),
    anguloEn: (f) => angulo(tDe(f)),
    muestras(paso) {
      const k = Math.max(2, Math.ceil(largo / paso));
      return Array.from({ length: k + 1 }, (_, i) => punto(i / k));
    },
  };
}

const caja = (x, y, mw, mh) => ({ x0: x - mw, y0: y - mh, x1: x + mw, y1: y + mh });

function interseccion(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function calcularGeometria(sim, salida, perfil) {
  const I = salida.instancia;
  const { W, H, margen } = perfil;
  const xs = I.coords.map((c) => c[0]);
  const ys = I.coords.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const ai = W - margen.izq - margen.der;
  const hi = H - margen.sup - margen.inf;
  let s = Math.min(maxX - minX > 1e-9 ? ai / (maxX - minX) : Infinity, maxY - minY > 1e-9 ? hi / (maxY - minY) : Infinity);
  if (!Number.isFinite(s) || s <= 0) s = 1;
  const cx = margen.izq + ai / 2;
  const cy = margen.sup + hi / 2;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const pos = I.coords.map(([x, y]) => [cx + (x - mx) * s, cy - (y - my) * s]);
  const radio = (i) => (i === 0 ? perfil.rDep * 1.25 : perfil.r);

  // Curva leve hacia la izquierda del sentido de viaje: i → j y j → i no se pisan.
  const curvaEntre = (i, j, comba = 0.1) => {
    const P0 = pos[i];
    const P1 = pos[j];
    const dx = P1[0] - P0[0];
    const dy = P1[1] - P0[1];
    const L = Math.hypot(dx, dy) || 1;
    const C = [(P0[0] + P1[0]) / 2 - (dy / L) * comba * L, (P0[1] + P1[1]) / 2 + (dx / L) * comba * L];
    const recortar = (P, R) => {
      const vx = C[0] - P[0];
      const vy = C[1] - P[1];
      const d = Math.hypot(vx, vy) || 1;
      const rr = Math.min(R, d * 0.4);
      return [P[0] + (vx / d) * rr, P[1] + (vy / d) * rr];
    };
    return curva(recortar(P0, radio(i) + 3), C, recortar(P1, radio(j) + 3));
  };

  const cajasNodo = pos.map(([x, y], i) => caja(x, y, radio(i) + 8, radio(i) + 8));
  const puestas = [];
  const arcos = sim.arcos.map((arco) => {
    const geo = curvaEntre(arco.desde, arco.hasta);
    // El camión se detiene con su centro a medio largo del borde del nodo.
    const a = limitar((MEDIO_CAMION * perfil.camion + 3) / geo.largo, 0, 0.3);
    const texto = fmt(arco.c);
    const h = perfil.altoPildora;
    const w = Math.max(h * 1.6, texto.length * perfil.fPildora * 0.62 + perfil.fPildora * 1.2);
    // Píldora en el punto medio salvo que tape un nodo u otra píldora: entonces se desliza por la curva.
    let mejor = null;
    for (const f of FRACCIONES_PILDORA) {
      const [px, py] = geo.puntoEn(f);
      const c = caja(px, py, w / 2 + 3, h / 2 + 3);
      let costo = Math.abs(f - 0.5) * 600;
      for (const cn of cajasNodo) costo += interseccion(c, cn) * 4;
      for (const otra of puestas) costo += interseccion(c, otra) * 2;
      if (!mejor || costo < mejor.costo) mejor = { f, px, py, c, costo };
      if (costo === 0) break;
    }
    puestas.push(mejor.c);
    return { arco, geo, a, texto, fPildora: mejor.f, pildora: { x: mejor.px, y: mejor.py, w, h } };
  });

  const G = { W, H, pos, radio, arcos };
  G.tarjetas = perfil.tarjetas ? colocarTarjetas(sim, G) : new Map();
  return G;
}

/**
 * Coloca la tarjeta de cada cliente hacia afuera del centroide: prueba 8
 * posiciones alrededor del nodo (y anillos más lejanos si hace falta) y elige,
 * en orden voraz, la de menor solapamiento con tarjetas, nodos, píldoras y arcos.
 */
function colocarTarjetas(sim, G) {
  const { pos, radio, arcos, W, H } = G;
  const n = sim.paradas.length;
  const e = n <= 8 ? 1 : n <= 14 ? 0.86 : n <= 20 ? 0.76 : 0.7;
  const anillos = n > 8 ? 5 : 3;
  const candidatos = (it, anillo) => DIRECCIONES.map(([dx, dy]) => {
    const sep = (it.r + 12 + anillo * 44) * (dx !== 0 && dy !== 0 ? 0.72 : 1);
    return [dx * (sep + it.w / 2), dy * (sep + it.h / 2)];
  });
  const items = sim.paradas.map((p) => ({
    id: p.cliente, x: pos[p.cliente][0], y: pos[p.cliente][1], w: TARJETA.w * e, h: TARJETA.h * e, r: radio(p.cliente) + 6,
  }));
  const obstaculos = [
    ...pos.map(([x, y], i) => ({ caja: caja(x, y, radio(i) + 12, radio(i) + 12), id: i })),
    ...arcos.map((A) => ({ caja: caja(A.pildora.x, A.pildora.y, A.pildora.w / 2 + 5, A.pildora.h / 2 + 5), id: null })),
  ];
  const puntos = arcos.flatMap((A) => A.geo.muestras(12));
  const centro = [pos.reduce((a, p) => a + p[0], 0) / pos.length, pos.reduce((a, p) => a + p[1], 0) / pos.length];
  const marco = { x0: 4, y0: 4, x1: W - 4, y1: H - 4 };

  const colocadas = new Map();
  const ubicar = (it) => {
    const fx = it.x - centro[0];
    const fy = it.y - centro[1];
    const nf = Math.hypot(fx, fy);
    let mejor = null;
    for (let anillo = 0; anillo < anillos; anillo++) {
      for (const [ox, oy] of candidatos(it, anillo)) {
        const c = caja(it.x + ox, it.y + oy, it.w / 2, it.h / 2);
        let costo = anillo * 900;
        for (const o of obstaculos) if (o.id !== it.id) costo += interseccion(c, o.caja) * 4;
        for (const [id, otra] of colocadas) if (id !== it.id) costo += interseccion(c, otra) * 4;
        for (const [px, py] of puntos) if (px > c.x0 - 3 && px < c.x1 + 3 && py > c.y0 - 3 && py < c.y1 + 3) costo += 70;
        costo += ((c.x1 - c.x0) * (c.y1 - c.y0) - interseccion(c, marco)) * 8;
        if (nf > 1) costo += (1 - (ox * fx + oy * fy) / (Math.hypot(ox, oy) * nf)) * 260;
        if (!mejor || costo < mejor.costo) mejor = { c, costo };
      }
      if (mejor.costo < 500) break;
    }
    colocadas.set(it.id, mejor.c);
  };
  for (let pasada = 0; pasada < 3; pasada++) for (const it of items) ubicar(it);
  return new Map([...colocadas].map(([id, c]) => [id, { ...c, e }]));
}

// --- Tooltips ----------------------------------------------------------------

function htmlCliente(p, n) {
  return `<div class="tt-titulo">Cliente ${p.cliente} · parada ${p.k} de ${n}</div>`
    + `<div class="tt-nota">${POLITICA_TEXTO[p.politica]}</div>`
    + filaTooltip('Entrega α · recogida β', `${fmt(p.alpha)} · ${fmt(p.beta)}`)
    + '<div class="tt-sep"></div>'
    + filaTooltip(`Llega ${sub('T', p.cliente)}`, fmt(p.T))
    + filaTooltip(`Atendido ${sub('D', p.cliente)}`, `<strong>${fmt(p.D)}</strong>`)
    + filaTooltip(`Sale ${sub('F', p.cliente)}`, fmt(p.F))
    + '<div class="tt-sep"></div>'
    + PARAMETROS.map((q) => filaTooltip(`${PARAM_HTML[q]} · ${PARAMETRO_INFO[q].nombre.toLowerCase()}`,
      `${fmt(p.unidadesParam[q])} × ${fmtValor(p.tasa[q])} = ${fmtValor(p.tiempoParam[q])}`)).join('');
}

function htmlArco(arco, Q) {
  const { w, y, z, total } = arco.carga;
  return `<div class="tt-titulo">${arco.regreso ? 'Regreso' : 'Tramo'} ${arco.desde} → ${arco.hasta}</div>`
    + filaTooltip(`Viaje c<sub>${subIndice(arco.desde, arco.hasta)}</sub>`, fmt(arco.c))
    + filaTooltip('Sale · llega', `${fmt(arco.inicio)} → ${fmt(arco.fin)}`)
    + filaTooltip('A bordo w · y · z', `${fmt(w)} · ${fmt(y)} · ${fmt(z)}`)
    + filaTooltip('Total / Q', `${fmt(total)} / ${fmt(Q)}`);
}

function htmlDeposito(sim) {
  return '<div class="tt-titulo">Depósito</div>'
    + filaTooltip('Sale con Σα entregas', fmt(sim.sumaAlpha))
    + filaTooltip('Vuelve con Σβ recogidas', fmt(sim.sumaBeta))
    + filaTooltip('Regreso en', `t = ${fmt(sim.regreso)}`);
}

// --- Vista -------------------------------------------------------------------

function construirVista({ sim, salida, nombre, alto, estado }) {
  const perfil = { ...PERFILES[nombre], H: alto ?? PERFILES[nombre].H };
  const N = sim.paradas.length;
  const G = calcularGeometria(sim, salida, perfil);
  const uid = ++contador;

  const nodos = new Map();      // id (0 = depósito) → <g> del nodo
  const ondas = new Map();
  const discos = new Map();
  const tarjetas = new Map();
  const celdas = [];            // { p, q, texto, grupo }
  const arcosRef = [];          // { trazo, flecha, pildora, mascara }
  let pasoActual = -1;

  const irA = (s) => estado.set({ pedirParada: { indice: limitar(s, 0, N + 1) - 1 } });
  const puntoDe = (nodo) => {
    const r = nodo.getBoundingClientRect();
    return { clientX: r.right - 4, clientY: r.top + r.height / 2 };
  };

  /** Tooltip, resaltado compartido y navegación a la parada desde cualquier vista del cliente. */
  function conCliente(nodo, p) {
    const html = () => htmlCliente(p, N);
    conTooltip(nodo, html);
    nodo.addEventListener('pointerenter', () => estado.set({ hover: p.cliente }));
    nodo.addEventListener('pointerleave', () => estado.set({ hover: null }));
    nodo.addEventListener('focus', () => {
      estado.set({ hover: p.cliente });
      mostrarTooltip(html(), puntoDe(nodo));
    });
    nodo.addEventListener('blur', () => {
      estado.set({ hover: null });
      ocultarTooltip();
    });
    nodo.addEventListener('click', () => irA(p.k));
    nodo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        irA(p.k);
      }
    });
  }

  const raizSVG = svg('svg', {
    class: 'mapa-svg', viewBox: `0 0 ${G.W} ${G.H}`, preserveAspectRatio: 'xMidYMid meet', role: 'group',
    'aria-label': `Mapa de la ruta ${sim.ruta.join(' → ')}`,
  });

  // El regreso se dibuja con una máscara para que el trazo punteado avance con el camión.
  const idMascara = `mapa-mascara-${uid}`;
  const mascaraTrazo = svg('path', { class: 'mapa-mascara' });
  const defs = svg('defs', {}, svg('mask', {
    id: idMascara, maskUnits: 'userSpaceOnUse', x: -G.W, y: -G.H, width: 3 * G.W, height: 3 * G.H,
  }, mascaraTrazo));

  // Ruta: trazo base tenue, trazo recorrido encima, flecha y píldora con c_ij.
  const capaBase = svg('g', { class: 'mapa-base', 'aria-hidden': 'true' });
  const capaArcos = svg('g', { class: 'mapa-arcos' });
  const capaPildoras = svg('g', { class: 'mapa-pildoras' });
  G.arcos.forEach((A) => {
    const { arco, geo } = A;
    capaBase.append(svg('path', { class: `mapa-base__trazo${arco.regreso ? ' mapa-base__trazo--regreso' : ''}`, d: geo.d }));
    const trazo = svg('path', { class: `mapa-arco${arco.regreso ? ' mapa-arco--regreso' : ''}`, d: geo.d, mask: arco.regreso ? `url(#${idMascara})` : null });
    if (arco.regreso) mascaraTrazo.setAttribute('d', geo.d);
    const fFlecha = A.fPildora <= 0.5 ? Math.min(0.88, A.fPildora + (A.pildora.w / 2 + 12) / geo.largo) : Math.max(0.12, A.fPildora - (A.pildora.w / 2 + 12) / geo.largo);
    const [fx, fy] = geo.puntoEn(fFlecha);
    const flecha = svg('path', {
      class: 'mapa-flecha', d: 'M6 0L-4.5 -4.5L-2 0L-4.5 4.5Z',
      transform: `translate(${r2(fx)} ${r2(fy)}) rotate(${r2(geo.anguloEn(fFlecha))}) scale(${perfil.camion})`,
    });
    const zona = svg('path', { class: 'mapa-zona', d: geo.d });
    const P = A.pildora;
    const pildora = svg('g', { class: 'mapa-pildora', transform: `translate(${r2(P.x)} ${r2(P.y)})` },
      svg('rect', { x: r2(-P.w / 2), y: r2(-P.h / 2), width: r2(P.w), height: P.h, rx: P.h / 2 }),
      svg('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fPildora }, A.texto));
    const html = () => htmlArco(arco, sim.Q);
    conTooltip(zona, html);
    conTooltip(pildora, html);
    capaArcos.append(svg('g', {}, trazo, flecha, zona));
    capaPildoras.append(pildora);
    arcosRef.push({ trazo, flecha, pildora, mascara: arco.regreso ? mascaraTrazo : null, fFlecha });
  });

  // Tarjetas (pantalla ancha): título y los cuatro tiempos en una rejilla 2 × 2.
  const capaTarjetas = svg('g', { class: 'mapa-tarjetas' });
  for (const [id, c] of G.tarjetas) {
    const p = sim.porCliente.get(id);
    const { w, h } = TARJETA;
    const g = svg('g', {
      class: `mapa-tarjeta mapa-tarjeta--p${polDe(p)}`,
      transform: `translate(${r2(c.x0)} ${r2(c.y0)}) scale(${c.e})`,
      dataset: { cliente: id },
    },
      svg('rect', { class: 'mapa-tarjeta__fondo', width: w, height: h, rx: 10 }),
      svg('text', { class: 'mapa-tarjeta__titulo', x: 12, y: 20 }, `Cliente ${p.cliente}`),
      svg('text', { class: 'mapa-tarjeta__pol', x: w - 12, y: 20, 'text-anchor': 'end' }, politicaCorta(p.politica)));
    PARAMETROS.forEach((q, i) => {
      const x = 8 + (i % 2) * 68;
      const y = 30 + Math.floor(i / 2) * 25;
      const texto = svg('text', { class: 'mapa-celda__valor', x: x + 60, y: y + 15.5, 'text-anchor': 'end' });
      const celda = svg('g', { class: 'mapa-celda' },
        svg('rect', { class: 'mapa-celda__fondo', x, y, width: 64, height: 22, rx: 6 }),
        svg('circle', { cx: x + 9, cy: y + 11, r: 3.2, style: { fill: `var(--op-${q})` } }),
        svg('text', { class: 'mapa-celda__etq', x: x + 16, y: y + 15.5 }, ...paramSVG(q)),
        texto);
      g.append(celda);
      celdas.push({ p, q, texto, grupo: celda });
    });
    conCliente(g, p);
    capaTarjetas.append(g);
    tarjetas.set(id, g);
  }

  // Nodos: depósito (cuadrado) y clientes (círculo con el color de su política).
  const capaNodos = svg('g', { class: 'mapa-nodos' });
  {
    const rd = perfil.rDep;
    const onda = svg('rect', { class: 'mapa-onda', x: -rd, y: -rd, width: 2 * rd, height: 2 * rd, rx: 6 });
    const disco = svg('g', { class: 'mapa-disco' },
      svg('rect', { class: 'mapa-deposito__cuadro', x: -rd, y: -rd, width: 2 * rd, height: 2 * rd, rx: 6 }),
      svg('text', { class: 'mapa-deposito__num', 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fNodo }, '0'));
    const deposito = svg('g', {
      class: 'mapa-nodo mapa-deposito', transform: `translate(${r2(G.pos[0][0])} ${r2(G.pos[0][1])})`,
      tabindex: 0, role: 'button', 'aria-label': 'Depósito: ir al inicio',
    }, onda, disco);
    conTooltip(deposito, () => htmlDeposito(sim));
    deposito.addEventListener('click', () => irA(0));
    deposito.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        irA(0);
      }
    });
    nodos.set(0, deposito);
    ondas.set(0, onda);
    discos.set(0, disco);
    capaNodos.append(deposito);
  }
  for (const p of sim.paradas) {
    const r = perfil.r;
    const [x, y] = G.pos[p.cliente];
    const onda = svg('circle', { class: 'mapa-onda', r });
    const disco = svg('g', { class: 'mapa-disco' },
      svg('circle', { class: 'mapa-nodo__circulo', r }),
      svg('text', { class: 'mapa-nodo__num', 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fNodo }, String(p.cliente)));
    const nodo = svg('g', {
      class: `mapa-nodo mapa-nodo--p${polDe(p)}`, transform: `translate(${r2(x)} ${r2(y)})`,
      tabindex: 0, role: 'button', 'aria-label': `Cliente ${p.cliente}, parada ${p.k} de ${N}: ir a esta parada`,
    }, onda, disco);
    conCliente(nodo, p);
    nodos.set(p.cliente, nodo);
    ondas.set(p.cliente, onda);
    discos.set(p.cliente, disco);
    capaNodos.append(nodo);
  }

  // Camión visto desde arriba, mirando hacia +x.
  const camion = svg('g', { class: 'mapa-camion', 'aria-hidden': 'true' },
    svg('g', { transform: `scale(${perfil.camion})` },
      svg('rect', { class: 'mapa-camion__caja', x: -14, y: -7, width: 19, height: 14, rx: 3 }),
      svg('rect', { class: 'mapa-camion__cabina', x: 6.5, y: -6, width: 8, height: 12, rx: 3 }),
      svg('line', { class: 'mapa-camion__puerta', x1: -12.5, y1: -4, x2: -12.5, y2: 4 })));

  raizSVG.append(defs, capaBase, capaArcos, capaTarjetas, capaPildoras, capaNodos, camion);

  // Cabecera y leyenda
  const botonesModo = [['tiempo', 'Tiempo'], ['unitario', 'Por unidad']].map(([valor, texto]) =>
    el('button', { type: 'button', 'aria-pressed': 'false', dataset: { valor }, onclick: () => estado.set({ modoNodo: valor }) }, texto));
  const muestra = (clase) => el('span', { class: `muestra ${clase}`, 'aria-hidden': 'true' });
  const leyenda = el('div', { class: 'mapa-leyenda' },
    el('span', {}, muestra('muestra--p1'), 'Política 1'),
    el('span', {}, muestra('muestra--p2'), 'Política 2'),
    el('span', {}, muestra('muestra--pildora'), 'c', el('sub', {}, 'ij'), ' viaje'));
  const cabecera = el('header', { class: 'bloque-cabecera' },
    el('h2', { class: 'bloque-titulo' }, 'Mapa'),
    leyenda,
    perfil.tarjetas
      ? el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Valores de las tarjetas' }, botonesModo)
      : null);

  const raiz = el('div', { class: `mapa mapa--${nombre}` }, cabecera, el('div', { class: 'mapa-lamina' }, raizSVG));

  function pintarModo(modo) {
    const unitario = modo === 'unitario';
    for (const c of celdas) {
      const v = unitario ? c.p.tasa[c.q] : c.p.tiempoParam[c.q];
      c.texto.textContent = fmtValor(v);
      c.grupo.classList.toggle('mapa-celda--cero', Math.abs(v) < 1e-12);
    }
    for (const b of botonesModo) b.setAttribute('aria-pressed', String(b.dataset.valor === (unitario ? 'unitario' : 'tiempo')));
  }

  function resaltar(cliente) {
    for (const coleccion of [nodos, tarjetas]) {
      for (const [id, nodo] of coleccion) nodo.classList.toggle('es-resaltado', cliente != null && id === cliente);
    }
    const t = tarjetas.get(cliente);
    if (t) capaTarjetas.append(t);
  }

  // Paso: 0 = salida del depósito, k = parada k (1..n), n + 1 = regreso.
  function pintarPaso(s) {
    pasoActual = s;
    const activo = s >= 1 && s <= N ? sim.paradas[s - 1].cliente : 0;
    for (const [id, nodo] of nodos) {
      nodo.classList.toggle('es-activo', id === activo);
      if (id !== 0) nodo.classList.toggle('es-visitado', sim.porCliente.get(id).k < s);
    }
    for (const [id, nodo] of tarjetas) nodo.classList.toggle('es-activa', id === activo);
    const t = tarjetas.get(activo);
    if (t) capaTarjetas.append(t);
  }

  /** Latido del nodo: onda que se expande y disco que crece y vuelve. */
  function latido(linea, id, t0) {
    const onda = ondas.get(id);
    const disco = discos.get(id);
    linea.fromTo(onda, { opacity: 0.7, scale: 1 }, { opacity: 0, scale: 2, duration: 0.26, ease: 'power1.out' }, t0);
    linea.to(disco, { keyframes: [{ scale: 1.18, duration: 0.08 }, { scale: 1, duration: 0.18 }], ease: 'none' }, t0);
  }

  /** Camión a lo largo del tramo A. Si los nodos coinciden el trazo mide 0: se usa un tween simple. */
  function recorrer(linea, A, trazo, vars, en) {
    if (A.geo.largo < 2) {
      const [x, y] = A.geo.puntoEn(1);
      return linea.to(camion, { x, y, ...vars }, en);
    }
    return linea.to(camion, {
      motionPath: { path: trazo, align: trazo, alignOrigin: [0.5, 0.5], autoRotate: true, start: A.a, end: 1 - A.a },
      ...vars,
    }, en);
  }

  // Línea del recorrido, en pausa: la mueve estado.avance.
  function lineaRecorrido() {
    const A0 = G.arcos[0];
    const [x0, y0] = A0.geo.puntoEn(A0.a);
    gsap.set(camion, { x: x0, y: y0, rotation: A0.geo.anguloEn(A0.a), transformOrigin: '50% 50%' });
    gsap.set([...discos.values(), ...ondas.values()], { transformOrigin: '50% 50%' });
    gsap.set([...ondas.values()], { opacity: 0 });
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    const facil = gsap.parseEase(SUAVE);
    const inversa = (y) => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (facil(m) < y) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };

    G.arcos.forEach((A, k) => {
      const R = arcosRef[k];
      // El trazo sigue al camión y se completa al llegar.
      if (R.mascara) {
        const L = r2(A.geo.largo + 4);
        gsap.set(R.mascara, { strokeDasharray: `${L} ${L}` });
        tl.fromTo(R.mascara, { strokeDashoffset: L }, { strokeDashoffset: r2(L * A.a), duration: VIAJE, ease: SUAVE }, k)
          .to(R.mascara, { strokeDashoffset: 0, duration: 0.05 }, k + VIAJE);
      } else {
        tl.fromTo(R.trazo, { drawSVG: '0%' }, { drawSVG: `${r2((1 - A.a) * 100)}%`, duration: VIAJE, ease: SUAVE }, k)
          .to(R.trazo, { drawSVG: '100%', duration: 0.05 }, k + VIAJE);
      }
      recorrer(tl, A, R.trazo, { duration: VIAJE, ease: SUAVE }, k);
      const llegaA = (f) => k + VIAJE * inversa(limitar(f / (1 - A.a), 0, 1));
      tl.fromTo(R.flecha, { opacity: 0 }, { opacity: 1, duration: 0.04 }, llegaA(R.fFlecha));
      tl.fromTo(R.pildora, { opacity: 0.45, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.08, transformOrigin: '50% 50%' }, Math.max(k, llegaA(A.fPildora) - 0.04));

      if (k < N) {
        latido(tl, sim.paradas[k].cliente, k + VIAJE);
        // Antes de salir, el camión cruza el nodo hasta el inicio del próximo tramo y gira por el lado corto.
        const sig = G.arcos[k + 1];
        const [xa, ya] = A.geo.puntoEn(1 - A.a);
        const [xb, yb] = sig.geo.puntoEn(sig.a);
        const desde = A.geo.anguloEn(1 - A.a);
        const delta = ((((sig.geo.anguloEn(sig.a) - desde) % 360) + 540) % 360) - 180;
        tl.fromTo(camion, { x: xa, y: ya, rotation: desde }, {
          x: xb, y: yb, rotation: desde + delta, duration: 0.12, ease: 'power1.inOut', immediateRender: false,
        }, k + 0.86);
      } else {
        latido(tl, 0, k + VIAJE);
      }
    });
    tl.set({}, {}, N + 1);
    return tl;
  }

  let tl = null;
  return {
    raiz,
    pintarModo,
    resaltar,
    iniciar() {
      pintarModo(estado.get('modoNodo'));
      resaltar(estado.get('hover'));
      tl = lineaRecorrido();
    },
    /** avance = { tramo, viaje, servicio } (fracciones de 0 a 1 en el tramo). */
    seguir(avance) {
      if (!tl) return;
      const t = avance ? limitar(avance.tramo + VIAJE * avance.viaje + (1 - VIAJE) * avance.servicio, 0, N + 1) : 0;
      tl.time(t);
      const paso = t >= N + VIAJE ? N + 1 : (t - Math.floor(t) >= VIAJE ? Math.floor(t) + 1 : Math.floor(t));
      if (paso !== pasoActual) pintarPaso(limitar(paso, 0, N + 1));
    },
  };
}

// --- Módulo ------------------------------------------------------------------

export function crear(raiz, estado) {
  let ctx = null;
  let mm = null;
  let vista = null;
  let bajas = [];
  let actual = null;      // { sim, salida, alto } de la vista montada
  let espera = null;

  /**
   * En escritorio la tarjeta del mapa tiene alto fijo: el viewBox toma su
   * proporción para que el mapa la llene. En pantallas chicas, alto por defecto.
   */
  function medirAlto(nombre) {
    const { W, H } = PERFILES[nombre];
    if (nombre !== 'ancho' || !window.matchMedia('(min-width: 1080px)').matches) return H;
    const ancho = raiz.clientWidth - 36;
    const alto = raiz.clientHeight - 36 - 44;
    if (ancho < 200 || alto < 150) return H;
    return Math.round(Math.min(800, Math.max(340, (W * alto) / ancho)));
  }

  // Si la tarjeta cambia de proporción (ventana redimensionada), se rehace el mapa.
  const ro = new ResizeObserver(() => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      if (!actual || !vista) return;
      const alto = medirAlto(vista.nombre);
      if (Math.abs(alto - actual.alto) / actual.alto > 0.06) render(actual.sim, actual.salida);
    }, 150);
  });
  ro.observe(raiz);

  function render(sim, salida) {
    destruir();
    ctx = gsap.context(() => {
      mm = gsap.matchMedia();
      mm.add({ ancho: '(min-width: 720px)', estrecho: '(max-width: 719.98px)' }, (contexto) => {
        const nombre = contexto.conditions.ancho ? 'ancho' : 'estrecho';
        const alto = medirAlto(nombre);
        actual = { sim, salida, alto };
        const v = construirVista({ sim, salida, nombre, alto, estado });
        v.nombre = nombre;
        raiz.append(v.raiz);
        vista = v;
        v.iniciar();
        v.seguir(estado.get('avance'));
        return () => {
          v.raiz.remove();
          if (vista === v) vista = null;
        };
      });
    });
    bajas = [
      estado.on('avance', (avance) => vista?.seguir(avance)),
      estado.on('hover', (c) => vista?.resaltar(c)),
      estado.on('modoNodo', (m) => vista?.pintarModo(m)),
    ];
  }

  function destruir() {
    for (const baja of bajas) baja();
    bajas = [];
    mm?.revert();
    ctx?.revert();
    mm = null;
    ctx = null;
    vista = null;
    ocultarTooltip();
    raiz.replaceChildren();
  }

  return { render, destruir };
}
