// Sección 01 · Mapa de la ruta (junto a la carga).
//
// Un nodo por cliente con su tarjeta uₐ ℓₐ u_b ℓ_b, arcos con el tiempo de viaje
// c_ij y un camión que recorre la ruta en una timeline de duración n + 1: el
// tramo k se recorre en [k, k + 0,7] y el camión atiende al cliente en
// [k + 0,7, k + 1].
//
// Vinculado (como se usa en la página): la timeline sigue a la carga del camión
// (estado.avance), que es la que tiene el pin y los botones de paso a paso.
// Solo: en escritorio la escena se fija y el scroll mueve la timeline; en móvil o
// con movimiento reducido no hay pin, la ruta se ve completa y se avanza con botones.
import { PARAMETROS, PARAMETRO_INFO } from './modelo.js';
import {
  PARAM_HTML, POLITICA_TEXTO, conTooltip, el, fmt, mostrarTooltip, movimientoReducido,
  ocultarTooltip, paramSVG, politicaCorta, svg,
} from './util.js';

const CONSULTA_FIJA = '(min-width: 960px) and (prefers-reduced-motion: no-preference)';
const CONSULTA_ANCHA_QUIETA = '(min-width: 960px) and (prefers-reduced-motion: reduce)';
const CONSULTA_ESTRECHA = 'not all and (min-width: 960px)';

const VIAJE = 0.7;               // fracción de cada tramo de la timeline dedicada al viaje
const SUAVE = 'power1.inOut';    // misma curva para el trazo, el camión y el reloj
const MEDIO_CAMION = 15;         // medio largo del camión en unidades del viewBox
const TARJETA = { w: 160, h: 96 };
const TARJETA_DEPOSITO = { w: 198, h: 50 };
const ANCHO_VALOR = 41;          // espacio para el valor de cada celda de la tarjeta (unidades de la tarjeta)
const DIRECCIONES = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];

// Escritorio: tarjetas dentro del SVG. Móvil: nodos y textos más grandes, tarjetas en HTML.
const PERFILES = {
  ancho: {
    W: 940, H: 700, margen: { izq: 190, der: 190, sup: 108, inf: 120 },
    r: 20, rDep: 16, fNodo: 15, fPildora: 12.5, altoPildora: 21, insignia: 1, camion: 1, flecha: 1,
    fEscala: 12, pasoMin: 34, tarjetas: true,
  },
  // A 360 px la lámina se ve a ~0,55×: insignias y márgenes más holgados para que
  // P1/P2 y #k sigan legibles y no choquen con la barra de escala.
  estrecho: {
    W: 600, H: 540, margen: { izq: 56, der: 56, sup: 60, inf: 112 },
    r: 24, rDep: 19, fNodo: 19, fPildora: 17, altoPildora: 27, insignia: 1.45, camion: 1.3, flecha: 1.35,
    fEscala: 16, pasoMin: 30, tarjetas: false,
  },
};

// Fracciones del largo donde se prueba la píldora c_ij (la primera libre gana).
const FRACCIONES_PILDORA = [0.5, 0.42, 0.58, 0.35, 0.65, 0.28, 0.72];

const NOTAS_MODO = {
  tiempo: 'Tiempo incurrido en el cliente: unidades movidas × valor unitario.',
  unitario: 'Valor unitario: tiempo por unidad movida en ese cliente.',
};

let contador = 0;

const r2 = (v) => Math.round(v * 100) / 100;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const subIndice = (i, j) => (i > 9 || j > 9 ? `${i},${j}` : `${i}${j}`);
const polDe = (p) => (p.politica === 1 ? 1 : 2);
const minuscula = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** Formato con más decimales para valores pequeños (h = 0,1 da tasas de 0,05). */
function fmtValor(v) {
  const a = Math.abs(v);
  if (a < 1e-9) return '0';
  if (a < 0.1) return fmt(v, 3);
  if (a < 1000) return fmt(v, 2);
  return fmt(v, 0);
}

/** Celdas de las tarjetas: con Q grande se acortan los valores para no pisar la etiqueta. */
function fmtCelda(v) {
  const a = Math.abs(v);
  if (a >= 1000) return fmt(v, 0);
  if (a >= 100) return fmt(v, 1);
  return fmtValor(v);
}

// Ancho aproximado de un texto en unidades del viewBox (sin medir: render puede correr antes que las fuentes).
const anchoMono = (texto, tam) => texto.length * tam * 0.6;
const anchoTexto = (texto, tam) => texto.length * tam * 0.58;

/** Menor paso de la serie 1, 2, 5 × 10^k que no baja de `minimo`. */
function pasoBonito(minimo) {
  const base = 10 ** Math.floor(Math.log10(minimo));
  for (const m of [1, 2, 5]) if (m * base >= minimo - 1e-12) return m * base;
  return 10 * base;
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

function areaFuera(c, W, H) {
  return (c.x1 - c.x0) * (c.y1 - c.y0) - interseccion(c, { x0: 4, y0: 4, x1: W - 4, y1: H - 4 });
}

function calcularGeometria(sim, salida, perfil) {
  const I = salida.instancia;
  const { W, H, margen } = perfil;
  const xs = I.coords.map((c) => c[0]);
  const ys = I.coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ai = W - margen.izq - margen.der;
  const hi = H - margen.sup - margen.inf;
  let s = Math.min(maxX - minX > 1e-9 ? ai / (maxX - minX) : Infinity, maxY - minY > 1e-9 ? hi / (maxY - minY) : Infinity);
  if (!Number.isFinite(s) || s <= 0) s = 1;
  const cx = margen.izq + ai / 2;
  const cy = margen.sup + hi / 2;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  // Eje y invertido: el norte queda arriba.
  const aVista = ([x, y]) => [cx + (x - mx) * s, cy - (y - my) * s];
  const aDatos = (X, Y) => [mx + (X - cx) / s, my - (Y - cy) / s];
  const pos = I.coords.map(aVista);
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

  const rectaEntre = (i, j) => {
    const [x0, y0] = pos[i];
    const [x1, y1] = pos[j];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const a = Math.min(radio(i) + 3, L * 0.4);
    const b = Math.min(radio(j) + 3, L * 0.4);
    return `M${r2(x0 + ux * a)} ${r2(y0 + uy * a)} L${r2(x1 - ux * b)} ${r2(y1 - uy * b)}`;
  };

  // Barra de escala abajo a la izquierda y flecha norte abajo a la derecha, por debajo del
  // margen inferior de los nodos (y de sus insignias #k).
  const valorEscala = 20 * s >= 70 && 20 * s <= 230 ? 20 : pasoBonito(90 / s);
  const fe = perfil.fEscala;
  const escala = { x: 24, y: H - fe * 2.9, largo: valorEscala * s, valor: valorEscala };
  const norte = { x: W - 30, y: H - fe * 2.7 };
  const decor = [
    { x0: escala.x - 8, y0: escala.y - fe * 2, x1: escala.x + Math.max(escala.largo, fe * 11) + 10, y1: escala.y + fe * 2.6 },
    { x0: norte.x - fe * 1.6, y0: norte.y - fe * 3, x1: norte.x + fe * 1.6, y1: norte.y + fe * 1.2 },
  ];

  // Nodos con sus insignias P1/P2 y #k (y el rótulo bajo el depósito): las píldoras no deben taparlos.
  const cajasNodo = pos.map(([x, y], i) => {
    const m = radio(i) + 9 * perfil.insignia;
    return { x0: x - m, y0: y - m, x1: x + m, y1: y + m + (i === 0 ? perfil.fNodo : 0) };
  });
  const pildorasPuestas = [];
  const arcos = sim.arcos.map((arco) => {
    const geo = curvaEntre(arco.desde, arco.hasta);
    // El camión se detiene con su centro a medio largo del borde del nodo.
    const a = limitar((MEDIO_CAMION * perfil.camion + 3) / geo.largo, 0, 0.3);
    const texto = fmt(arco.c);
    const h = perfil.altoPildora;
    const w = Math.max(h * 1.5, texto.length * perfil.fPildora * 0.62 + perfil.fPildora * 1.1);
    // Píldora en el punto medio salvo que tape un nodo, otra píldora o la escala: entonces se desliza por la curva.
    let mejor = null;
    for (const f of FRACCIONES_PILDORA) {
      const [px, py] = geo.puntoEn(f);
      const c = caja(px, py, w / 2 + 3, h / 2 + 3);
      let costo = Math.abs(f - 0.5) * 600;
      for (const cn of cajasNodo) costo += interseccion(c, cn) * 4;
      for (const otra of pildorasPuestas) costo += interseccion(c, otra) * 2;
      for (const d of decor) costo += interseccion(c, d) * 2;
      if (!mejor || costo < mejor.costo) mejor = { f, px, py, c, costo };
      if (costo === 0) break;
    }
    pildorasPuestas.push(mejor.c);
    // Flecha justo después de la píldora (≈ 60 %); si no cabe, justo antes; en arcos muy
    // cortos, en el centro del tramo libre más largo.
    const holgura = (w / 2 + 10 * perfil.flecha) / geo.largo;
    const medio = w / 2 / geo.largo;
    let fFlecha;
    if (mejor.f + holgura <= 0.88) fFlecha = Math.max(0.6, mejor.f + holgura);
    else if (mejor.f - holgura >= 0.12) fFlecha = mejor.f - holgura;
    else if (1 - mejor.f >= mejor.f) fFlecha = Math.min(0.92, (mejor.f + medio + 1) / 2);
    else fFlecha = Math.max(0.08, (mejor.f - medio) / 2);
    return { arco, geo, a, texto, fFlecha, fPildora: mejor.f, pildora: { x: mejor.px, y: mejor.py, w, h } };
  });

  // Cuadrícula cada `paso` unidades del sistema de coordenadas (10 y 50 en e_vigo).
  // Se extiende fuera del viewBox para cubrir el área sobrante de "meet".
  const paso = pasoBonito(perfil.pasoMin / s);
  const rejilla = { fina: '', gruesa: '' };
  const [dx0, dy1] = aDatos(-W, -H);
  const [dx1, dy0] = aDatos(2 * W, 2 * H);
  for (let i = Math.ceil(dx0 / paso); i <= Math.floor(dx1 / paso); i++) {
    const X = r2(aVista([i * paso, 0])[0]);
    rejilla[i % 5 === 0 ? 'gruesa' : 'fina'] += `M${X} ${-H}V${2 * H}`;
  }
  for (let i = Math.ceil(dy0 / paso); i <= Math.floor(dy1 / paso); i++) {
    const Y = r2(aVista([0, i * paso])[1]);
    rejilla[i % 5 === 0 ? 'gruesa' : 'fina'] += `M${-W} ${Y}H${2 * W}`;
  }

  const G = { W, H, s, pos, radio, curvaEntre, rectaEntre, arcos, rejilla, paso, escala, norte, decor };
  G.tarjetas = perfil.tarjetas ? colocarTarjetas(sim, G) : new Map();
  return G;
}

/**
 * Coloca la tarjeta de cada nodo hacia afuera del centroide: prueba 8 posiciones
 * alrededor del nodo (más 8 desplazadas a lo largo de cada lado y anillos más
 * lejanos cuando hay muchos clientes) y elige, en orden voraz, la de menor
 * solapamiento con tarjetas, nodos, etiquetas y arcos.
 */
function colocarTarjetas(sim, G) {
  const { pos, radio, arcos, decor, W, H } = G;
  const n = sim.paradas.length;
  const e = n <= 8 ? 1 : n <= 14 ? 0.86 : n <= 20 ? 0.76 : 0.7;
  const deslizar = n > 8;
  const anillos = n > 8 ? 5 : 3;
  const candidatos = (it, anillo) => {
    const lista = DIRECCIONES.map(([dx, dy]) => {
      const sep = (it.r + 12 + anillo * 46) * (dx !== 0 && dy !== 0 ? 0.72 : 1);
      return [dx * (sep + it.w / 2), dy * (sep + it.h / 2)];
    });
    if (deslizar) {
      const sep = it.r + 12 + anillo * 46;
      for (const f of [-0.5, 0.5]) {
        lista.push([(f * it.w) / 2, -(sep + it.h / 2)], [(f * it.w) / 2, sep + it.h / 2],
          [-(sep + it.w / 2), (f * it.h) / 2], [sep + it.w / 2, (f * it.h) / 2]);
      }
    }
    return lista;
  };
  const items = [
    { id: 0, x: pos[0][0], y: pos[0][1], w: TARJETA_DEPOSITO.w * e, h: TARJETA_DEPOSITO.h * e, r: radio(0) + 14 },
    ...sim.paradas.map((p) => ({
      id: p.cliente, x: pos[p.cliente][0], y: pos[p.cliente][1], w: TARJETA.w * e, h: TARJETA.h * e, r: radio(p.cliente) + 8,
    })),
  ];
  const obstaculos = [
    ...items.map((it) => ({ caja: caja(it.x, it.y, it.r + 12, it.r + 12), peso: 5, id: it.id })),
    ...arcos.map((A) => ({ caja: caja(A.pildora.x, A.pildora.y, A.pildora.w / 2 + 5, A.pildora.h / 2 + 5), peso: 3, id: null })),
    ...decor.map((d) => ({ caja: d, peso: 3, id: null })),
  ];
  const puntos = arcos.flatMap((A) => A.geo.muestras(12));
  const centro = [pos.reduce((a, p) => a + p[0], 0) / pos.length, pos.reduce((a, p) => a + p[1], 0) / pos.length];
  const vecinos = (it) => items.filter((o) => o !== it && Math.hypot(o.x - it.x, o.y - it.y) < 260).length;
  const orden = items.map((it) => ({ it, v: vecinos(it) })).sort((a, b) => b.v - a.v).map((o) => o.it);

  const colocadas = new Map();   // id → caja de su tarjeta
  const ubicar = (it) => {
    const fx = it.x - centro[0];
    const fy = it.y - centro[1];
    const nf = Math.hypot(fx, fy);
    let mejor = null;
    for (let anillo = 0; anillo < anillos; anillo++) {
      for (const [ox, oy] of candidatos(it, anillo)) {
        const c = caja(it.x + ox, it.y + oy, it.w / 2, it.h / 2);
        let costo = anillo * 900;
        for (const o of obstaculos) if (o.id !== it.id) costo += interseccion(c, o.caja) * o.peso;
        for (const [id, otra] of colocadas) if (id !== it.id) costo += interseccion(c, otra) * 4;
        for (const [px, py] of puntos) {
          if (px > c.x0 - 3 && px < c.x1 + 3 && py > c.y0 - 3 && py < c.y1 + 3) costo += 70;
        }
        costo += areaFuera(c, W, H) * 8;
        if (nf > 1) costo += (1 - (ox * fx + oy * fy) / (Math.hypot(ox, oy) * nf)) * 260;
        if (!mejor || costo < mejor.costo) mejor = { c, costo };
      }
      if (mejor.costo < 500) break;
    }
    colocadas.set(it.id, mejor.c);
  };
  for (const it of orden) ubicar(it);
  // Dos repasos: cada tarjeta se reubica con todas las demás ya puestas.
  for (let pasada = 0; pasada < 2; pasada++) for (const it of orden) ubicar(it);

  return new Map([...colocadas].map(([id, c]) => [id, { ...c, e }]));
}

// --- Tooltips ----------------------------------------------------------------

const fila = (etiqueta, valor) => `<div class="tt-fila"><span>${etiqueta}</span><span>${valor}</span></div>`;
const SEP = '<div class="tt-sep"></div>';

function htmlCliente(p, n) {
  const pol = polDe(p);
  const tiempos = PARAMETROS.map((q) => fila(
    `${PARAM_HTML[q]} · ${PARAMETRO_INFO[q].nombre.toLowerCase()}`,
    `${fmt(p.unidadesParam[q])} × ${fmtValor(p.tasa[q])} = ${fmtValor(p.tiempoParam[q])}`,
  )).join('');
  return `<div class="tt-titulo"><span class="cliente-chip mapa-tt-chip${pol === 2 ? ' cliente-chip--p2' : ''}">${p.cliente}</span>Cliente ${p.cliente} · parada ${p.k} de ${n}</div>`
    + `<div class="mapa-tt-nota">${POLITICA_TEXTO[p.politica]}</div>`
    + fila('Entrega α · recogida β', `${fmt(p.alpha)} ↓ · ${fmt(p.beta)} ↑`)
    + SEP
    + fila(`Llegada T<sub>${p.cliente}</sub>`, fmt(p.T))
    + fila(`Entrega D<sub>${p.cliente}</sub>`, `<strong>${fmt(p.D)}</strong>`)
    + fila(`Salida F<sub>${p.cliente}</sub>`, fmt(p.F))
    + SEP
    + fila('Tiempo en el cliente', 'unidades × tasa')
    + tiempos;
}

function htmlArco(arco, Q) {
  const { w, y, z, total } = arco.carga;
  return `<div class="tt-titulo">${arco.regreso ? 'Regreso' : 'Arco'} (${arco.desde}, ${arco.hasta})</div>`
    + fila(`c<sub>${subIndice(arco.desde, arco.hasta)}</sub> · tiempo de viaje`, fmt(arco.c))
    + fila('Sale en', `t = ${fmt(arco.inicio)}`)
    + fila('Llega en', `t = ${fmt(arco.fin)}`)
    + SEP
    + fila('Carga a bordo w · y · z', `${fmt(w)} · ${fmt(y)} · ${fmt(z)}`)
    + fila('Total / Q', `${fmt(total)} / ${fmt(Q)}`)
    + (arco.regreso ? `${SEP}<div class="mapa-tt-nota">El regreso no pesa en Σ D<sub>i</sub>.</div>` : '');
}

function htmlPar(i, j, cij, simetrico, enRuta) {
  const usado = [enRuta.has(`${i}-${j}`) ? `${i} → ${j}` : null, simetrico && enRuta.has(`${j}-${i}`) ? `${j} → ${i}` : null].filter(Boolean);
  const etiqueta = simetrico
    ? `c<sub>${subIndice(i, j)}</sub> = c<sub>${subIndice(j, i)}</sub>`
    : `c<sub>${subIndice(i, j)}</sub>`;
  return `<div class="tt-titulo">${simetrico ? `Par {${i}, ${j}}` : `Arco (${i}, ${j})`}</div>`
    + fila(etiqueta, fmt(cij))
    + fila('En la ruta', usado.length ? usado.join(', ') : 'no');
}

function htmlDeposito(sim) {
  return '<div class="tt-titulo"><span class="mapa-tt-deposito">0</span>Depósito</div>'
    + fila('Sale en', 't = 0')
    + fila('Entregas cargadas Σα', fmt(sim.sumaAlpha))
    + SEP
    + fila('Vuelve en', `t = ${fmt(sim.regreso)}`)
    + fila('Recogidas traídas Σβ', fmt(sim.sumaBeta));
}

// --- Vista -------------------------------------------------------------------

function construirVista({ sim, salida, nombre, fijo, vinculado, estado, modoArcos, alCambiarArcos }) {
  const perfil = PERFILES[nombre];
  const I = salida.instancia;
  const N = sim.paradas.length;
  const G = calcularGeometria(sim, salida, perfil);
  const uid = ++contador;
  const totalReloj = sim.regreso > 0 ? sim.regreso : 1;

  const nodos = new Map();      // id (0 = depósito) → <g> del nodo
  const ondas = new Map();
  const discos = new Map();
  const tarjetas = new Map();   // id → <g> de la tarjeta SVG
  const guias = new Map();
  const fichas = new Map();     // id → <article> (perfil estrecho)
  const celdas = [];            // { p, q, texto, grupo, claseCero }
  const arcosRef = [];          // { trazo, flecha, pildora, mascara, grupo }
  let irA = () => {};
  let seguir = () => {};        // modo vinculado: recibe estado.avance
  let pasoBase = () => pasoActual; // desde dónde cuentan Anterior / Siguiente
  let desplazamiento = null;    // tween scrollTo de la ventana lanzado desde las píldoras o los nodos
  let pasoActual = -1;
  let filasTiempo = [];
  const cache = { cifra: null, estado: null, marcas: sim.paradas.map(() => null) };

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

  // --- SVG ---------------------------------------------------------------------
  const raizSVG = svg('svg', {
    class: 'mapa-svg',
    viewBox: `0 0 ${G.W} ${G.H}`,
    preserveAspectRatio: 'xMidYMid meet',
    style: { aspectRatio: `${G.W} / ${G.H}` },
    role: 'group',
    'aria-label': `Mapa de la ruta ${sim.ruta.join(' → ')}. Cada cliente muestra sus tiempos de manipulación uₐ, ℓₐ, u_b y ℓ_b; cada arco, su tiempo de viaje c_ij.`,
  }, svg('title', {}, 'Mapa de la ruta'));

  const idMascara = `mapa-mascara-${uid}`;
  const mascaraTrazo = svg('path', { class: 'mapa-mascara__trazo' });
  const defs = svg('defs', {}, svg('mask', {
    id: idMascara, maskUnits: 'userSpaceOnUse', x: -G.W, y: -G.H, width: 3 * G.W, height: 3 * G.H,
  }, mascaraTrazo));

  const fondo = svg('g', { class: 'mapa-fondo', 'aria-hidden': 'true' },
    G.rejilla.fina ? svg('path', { class: 'mapa-rejilla mapa-rejilla--fina', d: G.rejilla.fina, 'vector-effect': 'non-scaling-stroke' }) : null,
    G.rejilla.gruesa ? svg('path', { class: 'mapa-rejilla mapa-rejilla--gruesa', d: G.rejilla.gruesa, 'vector-effect': 'non-scaling-stroke' }) : null);

  const E = G.escala;
  const fe = perfil.fEscala;
  const decoracion = svg('g', { class: 'mapa-decoracion', 'aria-hidden': 'true' },
    svg('text', { class: 'mapa-escala__titulo', x: E.x, y: r2(E.y - fe * 0.7), 'font-size': fe }, `${fmt(E.valor)} u. de tiempo`),
    svg('rect', { class: 'mapa-escala__llena', x: E.x, y: E.y, width: r2(E.largo / 2), height: r2(fe * 0.5) }),
    svg('rect', { class: 'mapa-escala__vacia', x: r2(E.x + E.largo / 2), y: E.y, width: r2(E.largo / 2), height: r2(fe * 0.5) }),
    svg('text', { class: 'mapa-escala__nota', x: E.x, y: r2(E.y + fe * 1.9), 'font-size': r2(fe * 0.9) },
      'distancia ≈ c', svg('tspan', { 'baseline-shift': 'sub', 'font-size': '72%' }, 'ij')),
    svg('g', { class: 'mapa-norte', transform: `translate(${r2(G.norte.x)} ${r2(G.norte.y)}) scale(${r2(fe / 12)})` },
      svg('path', { d: 'M0 -15L6.5 7L0 2.5L-6.5 7Z' }),
      svg('text', { y: -20, 'text-anchor': 'middle', 'font-size': 12 }, 'N')));

  // Grafo completo (control "Arcos: Todos"): una línea por par si c_ij = c_ji.
  const capaTodos = svg('g', { class: 'mapa-todos' });
  const ids = [0, ...[...sim.clientes].sort((a, b) => a - b)];
  const enRuta = new Set(sim.arcos.map((a) => `${a.desde}-${a.hasta}`));
  const par = (d, html) => {
    const g = svg('g', { class: 'mapa-todos__par' },
      svg('path', { class: 'mapa-todos__linea', d }),
      svg('path', { class: 'mapa-todos__zona', d }));
    conTooltip(g, html);
    capaTodos.append(g);
  };
  for (let x = 0; x < ids.length; x++) {
    for (let y = x + 1; y < ids.length; y++) {
      const i = ids[x];
      const j = ids[y];
      const cij = I.c[i][j];
      const cji = I.c[j][i];
      if (Math.abs(cij - cji) < 1e-9) par(G.rectaEntre(i, j), () => htmlPar(i, j, cij, true, enRuta));
      else {
        par(G.curvaEntre(i, j).d, () => htmlPar(i, j, cij, false, enRuta));
        par(G.curvaEntre(j, i).d, () => htmlPar(j, i, cji, false, enRuta));
      }
    }
  }

  // Ruta: trazo fantasma punteado, arco en tinta, flecha a ~60 % y píldora con c_ij.
  const capaFantasmas = svg('g', { class: 'mapa-fantasmas', 'aria-hidden': 'true' });
  const capaArcos = svg('g', { class: 'mapa-arcos' });
  const capaPildoras = svg('g', { class: 'mapa-pildoras' });
  G.arcos.forEach((A) => {
    const { arco, geo } = A;
    capaFantasmas.append(svg('path', { class: 'mapa-fantasma', d: geo.d }));
    const trazo = svg('path', { class: 'mapa-arco__trazo', d: geo.d, mask: arco.regreso ? `url(#${idMascara})` : null });
    if (arco.regreso) mascaraTrazo.setAttribute('d', geo.d);
    const [fx, fy] = geo.puntoEn(A.fFlecha);
    const flecha = svg('path', {
      class: 'mapa-arco__flecha',
      d: 'M6.5 0L-5 -4.6L-2.4 0L-5 4.6Z',
      transform: `translate(${r2(fx)} ${r2(fy)}) rotate(${r2(geo.anguloEn(A.fFlecha))}) scale(${perfil.flecha})`,
    });
    const zona = svg('path', { class: 'mapa-arco__zona', d: geo.d });
    const grupo = svg('g', { class: `mapa-arco${arco.regreso ? ' mapa-arco--regreso' : ''}` }, trazo, flecha, zona);
    const P = A.pildora;
    const pildora = svg('g', {
      class: `mapa-pildora${arco.regreso ? ' mapa-pildora--regreso' : ''}`,
      transform: `translate(${r2(P.x)} ${r2(P.y)})`,
    },
      svg('rect', { x: r2(-P.w / 2), y: r2(-P.h / 2), width: r2(P.w), height: P.h, rx: P.h / 2 }),
      svg('text', { class: 'mapa-pildora__texto', 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fPildora }, A.texto));
    const html = () => htmlArco(arco, sim.Q);
    conTooltip(zona, html);
    conTooltip(pildora, html);
    pildora.addEventListener('pointerenter', () => grupo.classList.add('mapa-arco--encima'));
    pildora.addEventListener('pointerleave', () => grupo.classList.remove('mapa-arco--encima'));
    capaArcos.append(grupo);
    capaPildoras.append(pildora);
    arcosRef.push({ trazo, flecha, pildora, grupo, mascara: arco.regreso ? mascaraTrazo : null });
  });

  // Tarjetas SVG (perfil ancho) con línea guía al nodo.
  const capaGuias = svg('g', { class: 'mapa-guias', 'aria-hidden': 'true' });
  const capaTarjetas = svg('g', { class: 'mapa-tarjetas' });

  function tarjetaCliente(p, c) {
    const { w, h } = TARJETA;
    // Con α, β grandes o decimales "α↓ · β↑" podría pisar "Cliente i": se comprime a lo que queda.
    const titulo = `Cliente ${p.cliente}`;
    const libreAB = w - 9 - 20 - 8 - anchoTexto(titulo, 12.5);
    const comprimirAB = anchoMono(`${fmt(p.alpha)}↓ · ${fmt(p.beta)}↑`, 11.5) > libreAB;
    const g = svg('g', {
      class: `mapa-tarjeta mapa-tarjeta--p${polDe(p)}`,
      transform: `translate(${r2(c.x0)} ${r2(c.y0)}) scale(${c.e})`,
    },
      svg('rect', { class: 'mapa-tarjeta__resalte', x: -4, y: -4, width: w + 8, height: h + 8, rx: 11 }),
      svg('rect', { class: 'mapa-tarjeta__sombra', x: 1.5, y: 2.5, width: w, height: h, rx: 8 }),
      svg('rect', { class: 'mapa-tarjeta__cuerpo', width: w, height: h, rx: 8 }),
      svg('circle', { class: 'mapa-tarjeta__punto', cx: 12, cy: 14.5, r: 3.5 }),
      svg('text', { class: 'mapa-tarjeta__titulo', x: 20, y: 18.5 }, titulo),
      svg('text', {
        class: 'mapa-tarjeta__ab', x: w - 9, y: 18.5, 'text-anchor': 'end',
        textLength: comprimirAB ? r2(libreAB) : null,
        lengthAdjust: comprimirAB ? 'spacingAndGlyphs' : null,
      },
        fmt(p.alpha), svg('tspan', { class: 'mapa-flecha-a' }, '↓'), ' · ',
        fmt(p.beta), svg('tspan', { class: 'mapa-flecha-b' }, '↑')),
      svg('line', { class: 'mapa-tarjeta__sep', x1: 8, x2: w - 8, y1: 27.5, y2: 27.5 }));
    PARAMETROS.forEach((q, i) => {
      const x = 8 + (i % 2) * 74;
      const y = 33 + Math.floor(i / 2) * 30;
      const valor = svg('text', { class: 'mapa-celda__valor', x: x + 65, y: y + 18.5, 'text-anchor': 'end' });
      const celda = svg('g', { class: 'mapa-celda' },
        svg('rect', { class: 'mapa-celda__fondo', x, y, width: 70, height: 27, rx: 4 }),
        svg('rect', { class: 'mapa-celda__barra', x, y, width: 3.5, height: 27, rx: 1.5, style: { fill: `var(--op-${q})` } }),
        svg('text', { class: 'mapa-celda__etq', x: x + 10, y: y + 18.5 }, ...paramSVG(q)),
        valor);
      g.append(celda);
      celdas.push({ p, q, texto: valor, grupo: celda, claseCero: 'mapa-celda--cero', svg: true });
    });
    conCliente(g, p);
    return g;
  }

  function tarjetaDeposito(c) {
    const { w, h } = TARJETA_DEPOSITO;
    const g = svg('g', {
      class: 'mapa-tarjeta mapa-tarjeta--deposito',
      transform: `translate(${r2(c.x0)} ${r2(c.y0)}) scale(${c.e})`,
    },
      svg('rect', { class: 'mapa-tarjeta__resalte', x: -4, y: -4, width: w + 8, height: h + 8, rx: 11 }),
      svg('rect', { class: 'mapa-tarjeta__sombra', x: 1.5, y: 2.5, width: w, height: h, rx: 8 }),
      svg('rect', { class: 'mapa-tarjeta__cuerpo', width: w, height: h, rx: 8 }),
      svg('text', { class: 'mapa-tarjeta__linea', x: 12, y: 20 },
        'Sale con ', svg('tspan', { class: 'mapa-tarjeta__dato' }, `Σα = ${fmt(sim.sumaAlpha)}`), ' entregas,'),
      svg('text', { class: 'mapa-tarjeta__linea', x: 12, y: 38 },
        'vuelve con ', svg('tspan', { class: 'mapa-tarjeta__dato' }, `Σβ = ${fmt(sim.sumaBeta)}`), ' recogidas'));
    conTooltip(g, () => htmlDeposito(sim));
    g.addEventListener('click', () => irA(0));
    return g;
  }

  if (perfil.tarjetas) {
    for (const [id, c] of G.tarjetas) {
      const [nx, ny] = G.pos[id];
      const qx = limitar(nx, c.x0, c.x1);
      const qy = limitar(ny, c.y0, c.y1);
      const dist = Math.hypot(qx - nx, qy - ny);
      const rr = G.radio(id) + 5;
      const p = id === 0 ? null : sim.porCliente.get(id);
      if (dist > rr + 4) {
        const guia = svg('line', {
          class: `mapa-guia ${p ? `mapa-guia--p${polDe(p)}` : 'mapa-guia--deposito'}`,
          x1: r2(nx + ((qx - nx) / dist) * rr), y1: r2(ny + ((qy - ny) / dist) * rr), x2: r2(qx), y2: r2(qy),
        });
        capaGuias.append(guia);
        guias.set(id, guia);
      }
      const tarjeta = p ? tarjetaCliente(p, c) : tarjetaDeposito(c);
      capaTarjetas.append(tarjeta);
      tarjetas.set(id, tarjeta);
    }
  }

  // Nodos: depósito (cuadrado) y clientes (anillo con el color de la política).
  const capaNodos = svg('g', { class: 'mapa-nodos' });
  {
    const rd = perfil.rDep;
    const onda = svg('circle', { class: 'mapa-nodo__onda', r: r2(rd * 1.3) });
    const disco = svg('g', { class: 'mapa-nodo__disco' },
      svg('rect', { class: 'mapa-deposito__cuadro', x: -rd, y: -rd, width: 2 * rd, height: 2 * rd, rx: 4 }),
      svg('text', { class: 'mapa-deposito__num', 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fNodo }, '0'));
    const deposito = svg('g', {
      class: 'mapa-nodo mapa-deposito',
      transform: `translate(${r2(G.pos[0][0])} ${r2(G.pos[0][1])})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Depósito 0: sale en t = 0 con ${fmt(sim.sumaAlpha)} entregas y vuelve en t = ${fmt(sim.regreso)}.`,
    },
      svg('rect', { class: 'mapa-nodo__halo', x: -rd - 9, y: -rd - 9, width: 2 * rd + 18, height: 2 * rd + 18, rx: 10 }),
      onda,
      svg('rect', { class: 'mapa-nodo__foco', x: -rd - 5, y: -rd - 5, width: 2 * rd + 10, height: 2 * rd + 10, rx: 7 }),
      disco,
      svg('text', { class: 'mapa-deposito__rotulo', y: r2(rd + perfil.fNodo * 1.05), 'text-anchor': 'middle', 'font-size': r2(perfil.fNodo * 0.66) }, 'DEPÓSITO'));
    const html = () => htmlDeposito(sim);
    conTooltip(deposito, html);
    deposito.addEventListener('focus', () => mostrarTooltip(html(), puntoDe(deposito)));
    deposito.addEventListener('blur', ocultarTooltip);
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
    const b = perfil.insignia;
    const [x, y] = G.pos[p.cliente];
    const onda = svg('circle', { class: 'mapa-nodo__onda', r });
    const disco = svg('g', { class: 'mapa-nodo__disco' },
      svg('circle', { class: 'mapa-nodo__anillo', r }),
      svg('text', { class: 'mapa-nodo__num', 'text-anchor': 'middle', dy: '0.35em', 'font-size': perfil.fNodo }, String(p.cliente)));
    const insignia = (clase, dx, dy, texto, rx) => svg('g', { class: clase, transform: `translate(${r2(dx)} ${r2(dy)})` },
      svg('rect', { x: -11.5 * b, y: -7.5 * b, width: 23 * b, height: 15 * b, rx: rx * b }),
      svg('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': r2(9.5 * b) }, texto));
    const nodo = svg('g', {
      class: `mapa-nodo mapa-nodo--p${polDe(p)}`,
      transform: `translate(${r2(x)} ${r2(y)})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Cliente ${p.cliente}, parada ${p.k} de ${N}, ${POLITICA_TEXTO[p.politica]}. Entrega en D = ${fmt(p.D)}.`,
      dataset: { cliente: p.cliente },
    },
      svg('circle', { class: 'mapa-nodo__halo', r: r + 11 }),
      onda,
      svg('circle', { class: 'mapa-nodo__foco', r: r + 6 }),
      disco,
      insignia('mapa-nodo__pol', r * 0.8, -r * 0.98, politicaCorta(p.politica), 7.5),
      insignia('mapa-nodo__orden', -r * 0.8, r * 0.98, `#${p.k}`, 4));
    conCliente(nodo, p);
    nodos.set(p.cliente, nodo);
    ondas.set(p.cliente, onda);
    discos.set(p.cliente, disco);
    capaNodos.append(nodo);
  }

  // Camión visto desde arriba, mirando hacia +x; la línea ámbar es la puerta trasera.
  const camion = svg('g', { class: 'mapa-camion', 'aria-hidden': 'true' },
    svg('g', { transform: `scale(${perfil.camion})` },
      ...[-12.5, -4, 8.5].flatMap((rx) => [
        svg('rect', { class: 'mapa-camion__rueda', x: rx, y: -9.5, width: 5, height: 3, rx: 1 }),
        svg('rect', { class: 'mapa-camion__rueda', x: rx, y: 6.5, width: 5, height: 3, rx: 1 }),
      ]),
      svg('rect', { class: 'mapa-camion__caja', x: -15, y: -7.5, width: 20.5, height: 15, rx: 2 }),
      svg('line', { class: 'mapa-camion__puerta', x1: -13.4, y1: -4.8, x2: -13.4, y2: 4.8 }),
      svg('rect', { class: 'mapa-camion__cabina', x: 7, y: -6.5, width: 8, height: 13, rx: 2.5 }),
      svg('rect', { class: 'mapa-camion__vidrio', x: 11.6, y: -5, width: 2, height: 10, rx: 1 })));

  raizSVG.append(defs, fondo, decoracion, capaTodos, capaFantasmas, capaArcos, capaGuias, capaTarjetas,
    capaPildoras, capaNodos, svg('g', { class: 'mapa-capa-camion' }, camion));

  // --- Barra de herramientas y pie del mapa -------------------------------------
  const idTarjetas = `mapa-ctl-tarjetas-${uid}`;
  const idArcos = `mapa-ctl-arcos-${uid}`;
  const botonesModo = [['tiempo', 'Tiempo en el cliente'], ['unitario', 'Valor unitario']].map(([valor, texto]) =>
    el('button', { type: 'button', 'aria-pressed': 'false', dataset: { valor }, onclick: () => estado.set({ modoNodo: valor }) }, texto));
  const botonesArcos = [['ruta', 'Ruta'], ['todos', 'Todos']].map(([valor, texto]) =>
    el('button', { type: 'button', 'aria-pressed': 'false', dataset: { valor }, onclick: () => pintarArcos(valor) }, texto));
  const nota = el('p', { class: 'mapa-herramientas__nota' });
  // En pantallas estrechas las tarjetas son fichas HTML bajo el panel: el control "Tarjetas"
  // va con ellas, para que el cambio se vea donde se pulsa.
  const controlTarjetas = el('div', { class: 'mapa-control' },
    el('span', { class: 'mapa-control__etiqueta', id: idTarjetas }, 'Tarjetas'),
    el('div', { class: 'segmentado', role: 'group', 'aria-labelledby': idTarjetas }, botonesModo));
  const herramientas = el('div', { class: 'mapa-herramientas' },
    perfil.tarjetas ? controlTarjetas : null,
    el('div', { class: 'mapa-control' },
      el('span', { class: 'mapa-control__etiqueta', id: idArcos }, 'Arcos'),
      el('div', { class: 'segmentado', role: 'group', 'aria-labelledby': idArcos }, botonesArcos)),
    perfil.tarjetas ? nota : null);

  const muestra = (clase, colorCss) => el('span', { class: `muestra ${clase}`, style: colorCss ? `--color: ${colorCss}` : null, 'aria-hidden': 'true' });
  const idFichas = `mapa-fichas-${uid}`;
  const pie = el('div', { class: 'mapa-pie' },
    perfil.tarjetas ? null : el('a', {
      class: 'mapa-pie__enlace',
      href: `#${idFichas}`,
      html: `Tiempos u<sub>a</sub> ℓ<sub>a</sub> u<sub>b</sub> ℓ<sub>b</sub> de cada nodo <span aria-hidden="true">↓</span>`,
    }),
    el('span', { class: 'mapa-pie__item' }, muestra('muestra--anillo', 'var(--p1)'), 'Política 1'),
    el('span', { class: 'mapa-pie__item' }, muestra('muestra--anillo', 'var(--p2)'), 'Política 2'),
    el('span', { class: 'mapa-pie__item' }, muestra('muestra--cuadro'), 'Depósito'),
    el('span', { class: 'mapa-pie__item' }, el('span', { class: 'mapa-pie__linea', 'aria-hidden': 'true' }), 'Ruta'),
    el('span', { class: 'mapa-pie__item' }, el('span', { class: 'mapa-pie__linea mapa-pie__linea--regreso', 'aria-hidden': 'true' }), 'Regreso'),
    el('span', {
      class: 'mapa-pie__fuente',
      html: I.coordsCalculadas ? 'Posiciones por escalamiento multidimensional de c<sub>ij</sub>' : 'Coordenadas de la instancia',
    }));

  const lamina = el('figure', { class: 'mapa-lamina' }, raizSVG);

  // --- Panel lateral -------------------------------------------------------------
  const botonesPaso = [];
  const listaPasos = el('ol', { class: 'pasos mapa-pasos', 'aria-label': 'Paradas de la ruta' });
  ['0', ...sim.paradas.map((p) => String(p.cliente)), '0'].forEach((texto, s) => {
    if (s > 0 && N <= 12) listaPasos.append(el('li', { class: 'pasos__flecha', 'aria-hidden': 'true' }, '→'));
    const p = s >= 1 && s <= N ? sim.paradas[s - 1] : null;
    const descripcion = s === 0 ? 'Salida del depósito' : p ? `Parada ${s}: cliente ${p.cliente}` : 'Regreso al depósito';
    const boton = el('button', {
      type: 'button',
      class: `paso ${p ? `paso--p${polDe(p)}` : 'paso--deposito'}`,
      'aria-label': descripcion,
      title: descripcion,
      onclick: () => irA(s),
    }, texto);
    if (p) {
      boton.addEventListener('pointerenter', () => estado.set({ hover: p.cliente }));
      boton.addEventListener('pointerleave', () => estado.set({ hover: null }));
    }
    botonesPaso.push(boton);
    listaPasos.append(el('li', {}, boton));
  });

  const relojCifra = el('span', { class: 'mapa-reloj__cifra' }, '0');
  const relojEstado = el('p', { class: 'mapa-reloj__estado' });
  const avance = el('span', { class: 'mapa-reloj__avance' });
  const marcas = sim.paradas.map((p) => el('span', {
    class: 'mapa-reloj__marca',
    style: { left: `${r2(limitar(p.D / totalReloj, 0, 1) * 100)}%` },
  }));
  const reloj = el('div', { class: 'mapa-reloj' },
    el('div', { class: 'mapa-reloj__cabecera' },
      el('span', {}, 'Reloj de la ruta'),
      el('span', { class: 'num' }, `regreso en ${fmt(sim.regreso)}`)),
    el('p', { class: 'mapa-reloj__valor num' }, el('span', { class: 'mapa-reloj__t' }, 't ='), ' ', relojCifra),
    relojEstado,
    el('div', { class: 'mapa-reloj__pista', 'aria-hidden': 'true' }, avance, marcas),
    el('p', { class: 'mapa-reloj__leyenda', html: '<span class="mapa-reloj__clave" aria-hidden="true"></span>instantes de entrega D<sub>i</sub>' }));

  const anterior = el('button', { type: 'button', class: 'boton', onclick: () => irA(pasoBase() - 1) },
    el('span', { 'aria-hidden': 'true' }, '←'), 'Anterior');
  const siguiente = el('button', { type: 'button', class: 'boton', onclick: () => irA(pasoBase() + 1) },
    'Siguiente', el('span', { 'aria-hidden': 'true' }, '→'));
  const navTexto = el('span', { class: 'mapa-navegacion__texto num', 'aria-hidden': 'true' });
  const navegacion = fijo ? null : el('div', { class: 'mapa-navegacion' }, anterior, navTexto, siguiente);

  const tarjetaPanel = el('article', { class: 'mapa-parada', 'aria-live': fijo ? 'off' : 'polite', 'aria-atomic': 'true' });
  const panel = el('aside', { class: 'mapa-panel', 'aria-label': 'Recorrido de la ruta' },
    el('div', { class: 'mapa-panel__bloque' },
      el('p', { class: 'mapa-panel__rotulo' }, fijo ? 'Ruta · baja para avanzar' : 'Ruta · elige una parada'),
      listaPasos),
    reloj,
    navegacion,
    tarjetaPanel);

  // --- Fichas HTML (perfil estrecho: las tarjetas no caben legibles en el SVG) ---
  let notaFichas = null;
  let seccionFichas = null;
  if (!perfil.tarjetas) {
    notaFichas = el('p', { class: 'mapa-fichas__nota' });
    seccionFichas = el('section', { class: 'mapa-fichas', id: idFichas, 'aria-label': 'Tarjetas de los clientes' },
      el('div', { class: 'mapa-fichas__cabecera' },
        el('h3', { class: 'mapa-fichas__titulo' }, 'Tarjetas de los clientes'),
        controlTarjetas,
        notaFichas),
      el('div', { class: 'mapa-fichas__rejilla' }, sim.paradas.map((p) => {
        const pol = polDe(p);
        const celdasFicha = PARAMETROS.map((q) => {
          const valor = el('span', { class: 'mapa-ficha__valor num' });
          const nodo = el('div', { class: 'mapa-ficha__celda', style: `--color: var(--op-${q})` },
            el('span', { class: 'mapa-ficha__etq', html: PARAM_HTML[q] }), valor);
          celdas.push({ p, q, texto: valor, grupo: nodo, claseCero: 'mapa-ficha__celda--cero' });
          return nodo;
        });
        const ficha = el('article', {
          class: `mapa-ficha mapa-ficha--p${pol}`,
          tabindex: 0,
          'aria-label': `Cliente ${p.cliente}, parada ${p.k} de ${N}`,
        },
          el('header', { class: 'mapa-ficha__cabecera' },
            el('span', { class: `cliente-chip${pol === 2 ? ' cliente-chip--p2' : ''}` }, String(p.cliente)),
            el('span', { class: 'mapa-ficha__orden num' }, `#${p.k} · ${politicaCorta(p.politica)}`),
            el('span', {
              class: 'mapa-ficha__ab num',
              html: `${fmt(p.alpha)}<span class="mapa-flecha-a">↓</span> · ${fmt(p.beta)}<span class="mapa-flecha-b">↑</span>`,
            })),
          el('div', { class: 'mapa-ficha__celdas' }, celdasFicha));
        conCliente(ficha, p);
        fichas.set(p.cliente, ficha);
        return ficha;
      })));
  }

  const raizVista = el('div', { class: `mapa mapa--${nombre} ${fijo ? 'mapa--fijo' : 'mapa--pasos'}` },
    el('div', { class: 'mapa__interior' },
      el('div', { class: 'mapa__principal' }, herramientas, lamina, pie),
      panel,
      seccionFichas));

  // --- Estado de la vista ----------------------------------------------------------

  function pintarModo(modo) {
    const m = modo === 'unitario' ? 'unitario' : 'tiempo';
    for (const c of celdas) {
      const v = m === 'unitario' ? c.p.tasa[c.q] : c.p.tiempoParam[c.q];
      const texto = fmtCelda(v);
      c.texto.textContent = texto;
      c.grupo.classList.toggle(c.claseCero, Math.abs(v) < 1e-12);
      if (c.svg) {
        // La celda deja ~41 u. entre la etiqueta y el borde: si el valor no cabe, se comprime.
        if (anchoMono(texto, 12) * 0.98 > ANCHO_VALOR) {
          c.texto.setAttribute('textLength', ANCHO_VALOR);
          c.texto.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        } else {
          c.texto.removeAttribute('textLength');
          c.texto.removeAttribute('lengthAdjust');
        }
      }
    }
    for (const b of botonesModo) b.setAttribute('aria-pressed', String(b.dataset.valor === m));
    nota.textContent = NOTAS_MODO[m];
    if (notaFichas) notaFichas.textContent = NOTAS_MODO[m];
  }

  function pintarArcos(valor) {
    alCambiarArcos(valor);
    raizSVG.classList.toggle('mapa-svg--todos', valor === 'todos');
    for (const b of botonesArcos) b.setAttribute('aria-pressed', String(b.dataset.valor === valor));
  }

  /** Lleva la tarjeta al frente (con muchos clientes pueden tocarse). */
  function alFrente(id) {
    const t = tarjetas.get(id);
    if (t && capaTarjetas.lastChild !== t) capaTarjetas.append(t);
  }

  function resaltar(cliente) {
    for (const coleccion of [nodos, tarjetas, fichas]) {
      for (const [id, nodo] of coleccion) nodo.classList.toggle('mapa-resaltado', cliente != null && id === cliente);
    }
    if (cliente != null) alFrente(cliente);
  }

  // Paso del relato: 0 = salida del depósito, k = parada k (1..n), n + 1 = regreso.
  function filaPanel(etiqueta, valor, { destacada = false, tiempo = null } = {}) {
    const nodo = el('div', { class: `mapa-fila${destacada ? ' mapa-fila--destacada' : ''}` },
      el('dt', { html: etiqueta }), el('dd', { class: 'num', html: valor }));
    if (tiempo != null) filasTiempo.push({ nodo, valor: tiempo, pendiente: null });
    return nodo;
  }

  const chipDeposito = () => el('span', { class: 'mapa-chip-deposito', 'aria-hidden': 'true' }, '0');

  function contenidoInicio() {
    const primero = sim.arcos[0];
    const pila = primero?.pila ?? [];
    const cargado = sim.cargaInicial.total;
    const libre = Math.max(0, sim.Q - cargado);
    return [
      el('div', { class: 'mapa-parada__cabecera' },
        el('p', { class: 'mapa-parada__ante' }, 'Salida · t = 0'),
        el('h3', { class: 'mapa-parada__titulo' }, chipDeposito(), 'Depósito')),
      el('p', {
        class: 'mapa-parada__texto',
        html: `Sale con Σα = <strong class="num">${fmt(sim.sumaAlpha)}</strong> entregas cargadas en orden inverso a la ruta: la del primer cliente queda junto a la puerta.`,
      }),
      el('div', { class: 'mapa-carga' },
        el('span', { class: 'mapa-carga__extremo' }, 'Frente'),
        el('div', {
          class: 'mapa-carga__barra',
          role: 'img',
          'aria-label': `Entregas desde el frente hasta la puerta: clientes ${pila.map((b) => b.cliente).join(', ')}`,
        },
          pila.map((b) => el('span', {
            class: 'mapa-carga__bloque',
            style: { flexGrow: String(b.unidades) },
            title: `Entrega del cliente ${b.cliente}: ${fmt(b.unidades)} u.`,
          }, String(b.cliente))),
          libre > 1e-9 ? el('span', { class: 'mapa-carga__bloque mapa-carga__bloque--libre', style: { flexGrow: String(libre) }, title: `Espacio libre: ${fmt(libre)} u.` }) : null),
        el('span', { class: 'mapa-carga__extremo' }, 'Puerta')),
      el('dl', { class: 'mapa-filas' },
        filaPanel('Entregas a bordo / Q', `${fmt(cargado)} / ${fmt(sim.Q)}`),
        filaPanel('Recogidas por hacer Σβ', fmt(sim.sumaBeta)),
        primero ? filaPanel(`Primer tramo c<sub>${subIndice(primero.desde, primero.hasta)}</sub>`, fmt(primero.c)) : null),
    ];
  }

  function contenidoFinal() {
    const ultimo = sim.arcos[sim.arcos.length - 1];
    return [
      el('div', { class: 'mapa-parada__cabecera' },
        el('p', { class: 'mapa-parada__ante' }, 'Fin de la ruta'),
        el('h3', { class: 'mapa-parada__titulo' }, chipDeposito(), 'Regreso al depósito')),
      el('dl', { class: 'mapa-filas' },
        filaPanel(`Viaje desde ${ultimo.desde}`, `c<sub>${subIndice(ultimo.desde, 0)}</sub> = ${fmt(ultimo.c)}`),
        filaPanel('Llegada al depósito', `t = ${fmt(sim.regreso)}`, { tiempo: sim.regreso }),
        filaPanel('Recogidas a bordo / Q', `${fmt(ultimo.carga.total)} / ${fmt(sim.Q)}`),
        filaPanel('Σ D<sub>i</sub> · espera total', fmt(sim.objetivo), { destacada: true })),
      el('p', { class: 'mapa-parada__texto', html: 'El regreso no pesa en Σ D<sub>i</sub>: el objetivo solo suma el instante en que cada cliente recibe su entrega.' }),
    ];
  }

  function servicio(p) {
    const total = PARAMETROS.reduce((a, q) => a + p.tiempoParam[q], 0);
    return el('div', { class: 'mapa-servicio' },
      el('p', { class: 'mapa-servicio__titulo' },
        el('span', { html: `Servicio F<sub>${p.cliente}</sub> − T<sub>${p.cliente}</sub>` }),
        el('strong', { class: 'num' }, fmtValor(p.servicio)),
        el('span', {
          class: 'mapa-servicio__ab num',
          html: `${fmt(p.alpha)}<span class="mapa-flecha-a">↓</span> · ${fmt(p.beta)}<span class="mapa-flecha-b">↑</span>`,
        })),
      total > 1e-12
        ? el('div', {
          class: 'mapa-servicio__barra',
          role: 'img',
          'aria-label': `Tiempos en el cliente: ${PARAMETROS.map((q) => `${q} ${fmtValor(p.tiempoParam[q])}`).join(', ')}`,
        }, PARAMETROS.filter((q) => p.tiempoParam[q] > 1e-12).map((q) => el('span', {
          class: 'mapa-servicio__seg',
          style: { flexGrow: String(p.tiempoParam[q]), background: `var(--op-${q})` },
          title: `${PARAMETRO_INFO[q].nombre}: ${fmtValor(p.tiempoParam[q])}`,
        })))
        : el('p', { class: 'mapa-servicio__vacio' }, 'Sin manipulación en este cliente.'),
      el('ul', { class: 'mapa-servicio__leyenda' }, PARAMETROS.map((q) => el('li', {
        class: p.tiempoParam[q] > 1e-12 ? null : 'mapa-servicio__item--cero',
      },
        el('span', { class: 'mapa-servicio__muestra', style: { background: `var(--op-${q})` }, 'aria-hidden': 'true' }),
        el('span', { class: 'mapa-servicio__param', html: PARAM_HTML[q] }),
        el('span', { class: 'mapa-servicio__detalle num' }, `${fmt(p.unidadesParam[q])} × ${fmtValor(p.tasa[q])}`),
        el('span', { class: 'mapa-servicio__valor num' }, fmtValor(p.tiempoParam[q]))))));
  }

  function contenidoParada(s) {
    const p = sim.paradas[s - 1];
    const pol = polDe(p);
    const acumulada = sim.paradas.slice(0, s).reduce((a, q) => a + q.D, 0);
    return [
      el('div', { class: 'mapa-parada__cabecera' },
        el('p', { class: 'mapa-parada__ante' }, `Parada ${p.k} de ${N}`),
        el('h3', { class: 'mapa-parada__titulo' }, 'Cliente',
          el('span', { class: `cliente-chip${pol === 2 ? ' cliente-chip--p2' : ''}` }, String(p.cliente))),
        el('span', { class: `politica-chip politica-chip--p${pol}` }, POLITICA_TEXTO[p.politica])),
      el('dl', { class: 'mapa-filas' },
        filaPanel(p.desde === 0 ? 'Viaje desde el depósito' : `Viaje desde ${p.desde}`, `c<sub>${subIndice(p.desde, p.cliente)}</sub> = ${fmt(p.c)}`),
        filaPanel(`Llegada T<sub>${p.cliente}</sub>`, fmt(p.T), { tiempo: p.T }),
        filaPanel(`Entrega D<sub>${p.cliente}</sub>`, fmt(p.D), { tiempo: p.D, destacada: true }),
        filaPanel(`Salida F<sub>${p.cliente}</sub>`, fmt(p.F), { tiempo: p.F })),
      servicio(p),
      el('p', { class: 'mapa-parada__suma' },
        el('span', {}, 'Σ D acumulada hasta aquí'),
        el('strong', { class: 'num' }, fmt(acumulada))),
    ];
  }

  function pintarPaso(s) {
    pasoActual = s;
    botonesPaso.forEach((b, i) => {
      if (i === s) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('paso--hecho', i < s);
    });
    const activo = s >= 1 && s <= N ? sim.paradas[s - 1].cliente : 0;
    for (const [id, nodo] of nodos) {
      nodo.classList.toggle('mapa-nodo--activo', id === activo);
      if (id !== 0) nodo.classList.toggle('mapa-nodo--visitado', sim.porCliente.get(id).k < s);
    }
    for (const [id, nodo] of tarjetas) nodo.classList.toggle('mapa-tarjeta--activa', id === activo);
    alFrente(activo);
    for (const [id, nodo] of guias) nodo.classList.toggle('mapa-guia--activa', id === activo);
    for (const [id, nodo] of fichas) nodo.classList.toggle('mapa-ficha--activa', id === activo);

    filasTiempo = [];
    tarjetaPanel.replaceChildren(...(s === 0 ? contenidoInicio() : s > N ? contenidoFinal() : contenidoParada(s)).filter(Boolean));
    tarjetaPanel.dataset.paso = String(s);
    if (navegacion) {
      anterior.disabled = s <= 0;
      siguiente.disabled = s >= N + 1;
      navTexto.textContent = s === 0 ? 'Salida' : s > N ? 'Regreso' : `${s} / ${N}`;
    }
  }

  function pintarReloj(t, texto) {
    const cifra = fmt(t, 2);
    if (cifra !== cache.cifra) {
      relojCifra.textContent = cifra;
      cache.cifra = cifra;
    }
    if (texto !== cache.estado) {
      relojEstado.textContent = texto;
      cache.estado = texto;
    }
    avance.style.transform = `scaleX(${limitar(t / totalReloj, 0, 1)})`;
    sim.paradas.forEach((p, i) => {
      const ok = t >= p.D - 1e-9;
      if (ok !== cache.marcas[i]) {
        cache.marcas[i] = ok;
        marcas[i].classList.toggle('mapa-reloj__marca--alcanzada', ok);
      }
    });
    for (const f of filasTiempo) {
      const pendiente = t < f.valor - 1e-9;
      if (pendiente !== f.pendiente) {
        f.pendiente = pendiente;
        f.nodo.classList.toggle('mapa-fila--pendiente', pendiente);
      }
    }
  }

  const textoViaje = (arco) => (arco.regreso ? `Regresando ${arco.desde} → 0` : `Viajando ${arco.desde} → ${arco.hasta}`);

  function textoServicio(p, t) {
    const op = p.ops.find((o) => o.duracion > 1e-12 && t >= o.inicio - 1e-9 && t < o.fin - 1e-9);
    if (op) return `Cliente ${p.cliente}: ${minuscula(op.etiqueta)}`;
    return t < p.T + 1e-9 && p.F > p.T + 1e-9 ? `Llegada al cliente ${p.cliente}` : `Cliente ${p.cliente}: listo para salir`;
  }

  const textoPaso = (s) => (s === 0
    ? 'En el depósito, listo para salir'
    : s > N ? 'De vuelta en el depósito' : `Cliente ${sim.paradas[s - 1].cliente} atendido; sale en t = ${fmt(sim.paradas[s - 1].F)}`);
  const relojPaso = (s) => (s === 0 ? 0 : s > N ? sim.regreso : sim.paradas[s - 1].F);

  /** Camión detenido al inicio (paso 0) o al final del tramo que llega a la parada s. */
  function ponerCamion(s) {
    const A = G.arcos[s === 0 ? 0 : Math.min(s - 1, G.arcos.length - 1)];
    if (!A) return;
    const f = s === 0 ? A.a : 1 - A.a;
    const [x, y] = A.geo.puntoEn(f);
    gsap.set(camion, { x, y, rotation: A.geo.anguloEn(f) });
  }

  /** Latido del nodo: onda que se expande y disco que crece y vuelve. */
  function latido(linea, id, t0, escalaTiempo = 1) {
    const onda = ondas.get(id);
    const disco = discos.get(id);
    if (!onda || !disco) return;
    const r0 = Number(onda.getAttribute('r'));
    const crece = (id === 0 ? perfil.rDep : perfil.r) * 1.1;
    linea.to(onda, {
      keyframes: [
        { opacity: 0.85, attr: { r: r0 + 2 }, duration: 0.04 * escalaTiempo },
        { opacity: 0, attr: { r: r0 + crece }, duration: 0.22 * escalaTiempo },
      ],
      ease: 'none',
    }, t0);
    linea.to(disco, {
      keyframes: [
        { scale: 1.16, duration: 0.08 * escalaTiempo },
        { scale: 1, duration: 0.18 * escalaTiempo },
      ],
      ease: 'none',
    }, t0);
  }

  /**
   * Camión a lo largo del tramo A con MotionPath. Si los dos nodos coinciden (c_ij = 0 o
   * coordenadas repetidas por MDS) el trazo mide 0 y MotionPath daría NaN: se usa un tween simple.
   */
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

  // --- Línea del recorrido (escritorio con scroll o vinculada a la carga) ----------
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

  /** Paso, reloj y texto en el instante t de la línea; `reloj` impone el instante del modelo. */
  const estadoEn = (t, reloj = null) => {
    if (t >= N + VIAJE) return { paso: N + 1, reloj: reloj ?? sim.regreso, texto: textoPaso(N + 1) };
    const k = limitar(Math.floor(t), 0, N);
    const f = t - k;
    if (f < VIAJE) {
      const arco = sim.arcos[k];
      const u = facil(limitar(f / VIAJE, 0, 1));
      return {
        paso: k,
        reloj: reloj ?? arco.inicio + u * arco.c,
        texto: k === 0 && f < 0.002 ? textoPaso(0) : textoViaje(arco),
      };
    }
    const p = sim.paradas[k];
    const instante = reloj ?? p.T + ((f - VIAJE) / (1 - VIAJE)) * (p.F - p.T);
    return { paso: k + 1, reloj: instante, texto: textoServicio(p, instante) };
  };

  const sincronizar = (t, reloj = null) => {
    const e = estadoEn(t, reloj);
    if (e.paso !== pasoActual) pintarPaso(e.paso);
    pintarReloj(e.reloj, e.texto);
  };

  /** Línea de duración n + 1. Con scrollTrigger la mueve el scroll; sin él queda en pausa. */
  function lineaRecorrido(scrollTrigger = null) {
    ponerCamion(0);
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      paused: !scrollTrigger,
      scrollTrigger: scrollTrigger ?? undefined,
      onUpdate: scrollTrigger ? () => sincronizar(tl.time()) : undefined,
    });

    G.arcos.forEach((A, k) => {
      const R = arcosRef[k];
      tl.addLabel(`arco${k}`, k);
      // El trazo sigue al camión (queda bajo él) y se completa al llegar.
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
      // Flecha y píldora se encienden cuando el trazo llega a ellas.
      const llegaA = (f) => k + VIAJE * inversa(limitar(f / (1 - A.a), 0, 1));
      tl.fromTo(R.flecha, { opacity: 0 }, { opacity: 1, duration: 0.04 }, llegaA(A.fFlecha));
      tl.fromTo(R.pildora, { opacity: 0.35 }, { opacity: 1, duration: 0.06 }, Math.max(k, llegaA(A.fPildora) - 0.03));

      if (k < N) {
        const p = sim.paradas[k];
        tl.addLabel(`parada${k + 1}`, k + VIAJE);
        latido(tl, p.cliente, k + VIAJE);
        // Antes de salir, el camión cruza el nodo hasta el inicio del próximo tramo y gira por el lado corto.
        const sig = G.arcos[k + 1];
        const [x0, y0] = A.geo.puntoEn(1 - A.a);
        const [x1, y1] = sig.geo.puntoEn(sig.a);
        const desde = A.geo.anguloEn(1 - A.a);
        const hacia = sig.geo.anguloEn(sig.a);
        const delta = ((((hacia - desde) % 360) + 540) % 360) - 180;
        tl.fromTo(camion, { x: x0, y: y0, rotation: desde }, {
          x: x1, y: y1, rotation: desde + delta, duration: 0.12, ease: 'power1.inOut', immediateRender: false,
        }, k + 0.86);
      } else {
        tl.addLabel('regreso', k + VIAJE);
        latido(tl, 0, k + VIAJE);
      }
    });
    tl.set({}, {}, N + 1);
    return tl;
  }

  // --- Relato con scroll (escritorio, mapa solo) ----------------------------------
  function iniciarScroll() {
    const tl = lineaRecorrido({
      trigger: raizVista,
      pin: true,
      start: 'top top+=64',
      end: `+=${(N + 1) * 70}%`,
      scrub: 0.6,
      anticipatePin: 1,
    });

    irA = (s) => {
      const st = tl.scrollTrigger;
      if (!st) return;
      const destino = limitar(s, 0, N + 1);
      const tiempo = destino === 0 ? 0 : destino <= N ? tl.labels[`parada${destino}`] + 0.16 : N + 1;
      const y = st.start + (st.end - st.start) * (tiempo / tl.duration());
      // Se crea al hacer clic (fuera del contexto de gsap): se guarda para cortarlo en limpiar().
      desplazamiento?.kill();
      desplazamiento = gsap.to(window, {
        scrollTo: { y, autoKill: true },
        duration: limitar(Math.abs(y - window.scrollY) / 1800, 0.45, 1.3),
        ease: 'power2.inOut',
        overwrite: 'auto',
        onComplete: () => { desplazamiento = null; },
      });
    };

    sincronizar(tl.time());
  }

  // --- Vinculado a la carga del camión ----------------------------------------------
  // La carga publica estado.avance = { tramo, viaje, servicio, reloj } (fracciones de 0 a 1)
  // y el mapa se coloca en el mismo punto de su línea. Una parada elegida aquí se le pide
  // a la carga, que mueve las dos vistas (con scroll, animación o salto, según el modo).
  function iniciarVinculado() {
    const tl = lineaRecorrido();
    // Mientras el camión viaja, Anterior / Siguiente cuentan desde la parada a la que va.
    let destino = 0;
    seguir = (avance) => {
      if (!avance) {
        destino = 0;
        tl.time(0);
        sincronizar(0);
        return;
      }
      destino = limitar(avance.tramo + (avance.viaje > 0 ? 1 : 0), 0, N + 1);
      const t = limitar(avance.tramo + VIAJE * avance.viaje + (1 - VIAJE) * avance.servicio, 0, N + 1);
      tl.time(t);
      sincronizar(t, avance.reloj);
    };
    pasoBase = () => destino;
    irA = (s) => estado.set({ pedirParada: { indice: limitar(s, 0, N + 1) - 1 } });
    seguir(estado.get('avance'));
  }

  // --- Paso a paso (móvil o movimiento reducido) --------------------------------
  function iniciarPasos(contexto) {
    const animar = !movimientoReducido();
    let animacion = null;

    const calmar = () => {
      animacion?.kill();
      animacion = null;
      gsap.set([...ondas.values()], { opacity: 0 });
      gsap.set([...discos.values()], { scale: 1 });
    };

    ponerCamion(0);
    pintarPaso(0);
    pintarReloj(0, textoPaso(0));

    irA = (s) => contexto.add(() => {
      const destino = limitar(s, 0, N + 1);
      if (destino === pasoActual) return;
      const adelante = destino === pasoActual + 1;
      calmar();
      pintarPaso(destino);
      if (!animar || !adelante) {
        ponerCamion(destino);
        pintarReloj(relojPaso(destino), textoPaso(destino));
        return;
      }
      // Un paso hacia adelante: el camión cruza el nodo y gira, recorre el tramo y el nodo de destino late.
      const k = destino - 1;
      const A = G.arcos[k];
      const R = arcosRef[k];
      const arco = sim.arcos[k];
      const reloj = { t: arco.inicio };
      animacion = gsap.timeline({ onComplete: () => pintarReloj(relojPaso(destino), textoPaso(destino)) });
      const [x1, y1] = A.geo.puntoEn(A.a);
      animacion.to(camion, { x: x1, y: y1, rotation: `${r2(A.geo.anguloEn(A.a))}_short`, duration: 0.25, ease: 'power1.inOut' }, 0);
      recorrer(animacion, A, R.trazo, { duration: 1, ease: SUAVE }, 0.25)
        .to(reloj, { t: arco.fin, duration: 1, ease: SUAVE, onUpdate: () => pintarReloj(reloj.t, textoViaje(arco)) }, 0.25);
      if (destino <= N) {
        const p = sim.paradas[k];
        latido(animacion, p.cliente, 1.25, 2.6);
        animacion.to(reloj, { t: p.F, duration: 0.6, ease: 'none', onUpdate: () => pintarReloj(reloj.t, textoServicio(p, reloj.t)) }, 1.25);
      } else {
        latido(animacion, 0, 1.25, 2.6);
      }
    });

    // Animación única al entrar en pantalla: la ruta se dibuja tramo a tramo.
    if (animar) {
      ScrollTrigger.create({
        trigger: lamina,
        start: 'top 92%',
        once: true,
        onEnter: () => contexto.add(() => {
          const t = gsap.timeline({ defaults: { ease: SUAVE } });
          G.arcos.forEach((A, k) => {
            const R = arcosRef[k];
            const en = k * 0.28;
            if (R.mascara) {
              const L = r2(A.geo.largo + 4);
              t.fromTo(R.mascara, { strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.5 }, en);
            } else {
              t.fromTo(R.trazo, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5 }, en);
            }
            t.fromTo(R.flecha, { opacity: 0 }, { opacity: 1, duration: 0.15 }, en + 0.35);
            t.fromTo(R.pildora, { opacity: 0 }, { opacity: 1, duration: 0.2 }, en + 0.25);
          });
        }),
      });
    }
  }

  return {
    raiz: raizVista,
    pintarModo,
    resaltar,
    seguir: (avance) => seguir(avance),
    iniciar(contexto) {
      pintarArcos(modoArcos);
      pintarModo(estado.get('modoNodo'));
      resaltar(estado.get('hover'));
      gsap.set(camion, { transformOrigin: '50% 50%' });
      gsap.set([...discos.values()], { transformOrigin: '50% 50%' });
      if (vinculado) iniciarVinculado();
      else if (fijo) iniciarScroll();
      else iniciarPasos(contexto);
    },
    limpiar() {
      irA = () => {};
      seguir = () => {};
      desplazamiento?.kill();
      desplazamiento = null;
      ocultarTooltip();
    },
  };
}

// --- Módulo ------------------------------------------------------------------

/** vinculado: el recorrido lo marca la carga del camión (estado.avance) y no hay pin propio. */
export function crear(raiz, estado, { vinculado = false } = {}) {
  let ctx = null;
  let mm = null;
  let vista = null;
  let bajas = [];
  let modoArcos = 'ruta';

  function montar(sim, salida, nombre, fijo, contexto) {
    const v = construirVista({
      sim, salida, nombre, fijo, vinculado, estado, modoArcos, alCambiarArcos: (m) => { modoArcos = m; },
    });
    raiz.append(v.raiz);
    vista = v;
    v.iniciar(contexto);
    // Al cambiar de consulta (o en destruir) gsap revierte las animaciones y luego llama esto.
    return () => {
      v.limpiar();
      v.raiz.remove();
      if (vista === v) vista = null;
    };
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

  return {
    render(sim, salida) {
      // main.js llama destruir() antes, pero un render repetido no debe duplicar pines ni DOM.
      if (ctx || bajas.length || raiz.childElementCount) destruir();
      ctx = gsap.context(() => {
        mm = gsap.matchMedia();
        mm.add(CONSULTA_FIJA, (contexto) => montar(sim, salida, 'ancho', true, contexto));
        mm.add(CONSULTA_ANCHA_QUIETA, (contexto) => montar(sim, salida, 'ancho', false, contexto));
        mm.add(CONSULTA_ESTRECHA, (contexto) => montar(sim, salida, 'estrecho', false, contexto));
      }, raiz);
      bajas = [
        estado.on('hover', (cliente) => vista?.resaltar(cliente)),
        estado.on('modoNodo', (modo) => vista?.pintarModo(modo)),
      ];
      if (vinculado) bajas.push(estado.on('avance', (avance) => vista?.seguir(avance)));
    },
    destruir,
  };
}
