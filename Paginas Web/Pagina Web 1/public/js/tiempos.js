// Sección 04 · El reloj.
//
// A. Línea de tiempo de la ruta: viajes y servicios sobre un eje de tiempo,
//    alfileres en cada D_i, un cabezal ligado al scroll y una lupa con los pasos
//    de la Tabla 3 en la parada elegida.
// B. Espera de cada cliente: D_i descompuesto en viaje y manipulación acumulados.
//
// Los servicios (0,05–5) son diminutos frente a los viajes (30–100). En la pista
// se dibujan con un ancho mínimo (modo "Ampliado", que corre lo demás lo justo),
// la lupa los muestra a su propia escala y en B el modo "Solo manipulación"
// cambia la escala de las barras.
import { OPERACIONES, PARAMETROS, PARAMETRO_INFO } from './modelo.js';
import {
  PARAM_HTML, POLITICA_TEXTO, el, fmt, mostrarTooltip, moverTooltip, movimientoReducido,
  ocultarTooltip, politicaCorta, svg,
} from './util.js';

const Q_SCRUB = '(min-width: 960px) and (prefers-reduced-motion: no-preference)';
const Q_ANIMAR = '(prefers-reduced-motion: no-preference)';
const EPS = 1e-9;
const COMPONENTES = ['viaje', ...PARAMETROS];
const OSCUROS = new Set(['la', 'lb']); // fondos oscuros: texto claro encima
const PASOS = Object.entries(OPERACIONES)
  .map(([clave, op]) => ({ clave, ...op }))
  .sort((a, b) => a.paso - b.paso);
const ETIQUETA_COMP = { viaje: 'Viaje c<sub>ij</sub>' };
for (const p of PARAMETROS) ETIQUETA_COMP[p] = `${PARAM_HTML[p]} ${PARAMETRO_INFO[p].nombre.toLowerCase()}`;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, m) => a + (b - a) * m;
// IBM Plex Mono avanza 0,6 em por carácter; para Inter se usa un promedio.
const anchoMono = (texto, tam) => String(texto).length * 0.6 * tam;
const anchoTexto = (texto, tam) => String(texto).length * 0.56 * tam;
const pol = (p) => (p.politica === 1 ? 1 : 2);
const manipDe = (p) => PARAMETROS.reduce((s, q) => s + p.espera[q], 0);
const chip = (p) => el('span', { class: `cliente-chip${p.politica === 1 ? '' : ' cliente-chip--p2'}` }, String(p.cliente));

function atributos(nodo, props) {
  for (const [k, v] of Object.entries(props)) nodo.setAttribute(k, v);
}

/** Texto SVG con subíndice numérico (D₅ = 122) que no depende de baseline-shift. */
function textoSub(base, indice, resto, tam) {
  const d = (0.28 * tam).toFixed(2);
  return [base, svg('tspan', { dy: d, 'font-size': (tam * 0.72).toFixed(2) }, String(indice)), svg('tspan', { dy: -d }, resto)];
}

// --- Geometría de la pista ---------------------------------------------------

/** Tramos consecutivos de la ruta: viaje, servicio, viaje, …, regreso. */
function crearTramos(sim) {
  const tramos = [];
  sim.arcos.forEach((arco, k) => {
    tramos.push({ tipo: 'viaje', t0: arco.inicio, t1: arco.fin, arco, k });
    const parada = sim.paradas[k];
    if (parada) tramos.push({ tipo: 'servicio', t0: parada.T, t1: parada.F, parada, k });
  });
  return tramos;
}

/**
 * Posiciones x acumuladas con cada tramo ampliable de al menos wMin px: los que
 * quedarían más angostos se fijan en wMin y el resto se escala para llenar el
 * ancho (iterando, porque al fijar unos se angostan los demás).
 */
function rangoAmpliado(duraciones, esAmpliable, ancho, wMin) {
  const dur = duraciones.map((d) => Math.max(0, d));
  const ampliable = dur.map((d, i) => esAmpliable[i] && d > EPS);
  const fijo = dur.map(() => false);
  let f = 0;
  for (let vuelta = 0; vuelta <= dur.length; vuelta++) {
    let libre = 0;
    let fijos = 0;
    dur.forEach((d, i) => {
      if (fijo[i]) fijos++;
      else libre += d;
    });
    f = libre > EPS ? Math.max(0, ancho - fijos * wMin) / libre : 0;
    let cambio = false;
    dur.forEach((d, i) => {
      if (ampliable[i] && !fijo[i] && d * f < wMin) {
        fijo[i] = true;
        cambio = true;
      }
    });
    if (!cambio) break;
  }
  const xs = [0];
  dur.forEach((d, i) => xs.push(xs[i] + (fijo[i] ? wMin : d * f)));
  return xs;
}

/**
 * Alturas de los alfileres: cada uno va al nivel más bajo donde no choca con el
 * anterior. Si no caben en maxNiveles se ocultan los valores y se reintenta.
 */
function asignarNiveles(xs, r, anchos, limite, maxNiveles = 3) {
  const orden = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  let resultado = null;
  for (const conValor of [true, false]) {
    const fines = [];
    const niveles = [];
    const lados = [];
    let choca = false;
    for (const i of orden) {
      const x = xs[i];
      const w = conValor ? anchos[i] + 5 : 0;
      const derecha = x + r + w <= limite;
      const ini = derecha ? x - r : x - r - w;
      const fin = derecha ? x + r + w : x + r;
      let nivel = fines.findIndex((f) => f + 3 <= ini);
      if (nivel < 0) {
        if (fines.length < maxNiveles) nivel = fines.length;
        else {
          choca = true;
          nivel = fines.indexOf(Math.min(...fines));
        }
      }
      fines[nivel] = Math.max(fines[nivel] ?? -Infinity, fin);
      niveles[i] = nivel;
      lados[i] = derecha ? 1 : -1;
    }
    resultado = { niveles, lados, conValor, total: Math.max(1, fines.length) };
    if (!choca) break;
  }
  return resultado;
}

// --- Tooltips ----------------------------------------------------------------

function filaTT(etiqueta, valor, clave = null, fuerte = false) {
  const marca = clave ? `<i class="tiempos-tt-clave tiempos-color--${clave}"></i>` : '';
  return `<div class="tt-fila${fuerte ? ' tiempos-tt-fuerte' : ''}"><span>${marca}${etiqueta}</span><span>${valor}</span></div>`;
}

function htmlParada(p, n, destacado = null) {
  const c = p.cliente;
  const manip = manipDe(p);
  const pc = politicaCorta(p.politica);
  return `<div class="tt-titulo"><span class="cliente-chip${p.politica === 1 ? '' : ' cliente-chip--p2'} tiempos-tt-chip">${c}</span>`
    + `Cliente ${c} · parada ${p.k} de ${n}<span class="politica-chip politica-chip--p${pol(p)}">${pc}</span></div>`
    + filaTT(`Llegada T<sub>${c}</sub>`, fmt(p.T))
    + filaTT(`Entrega D<sub>${c}</sub>`, `<strong>${fmt(p.D)}</strong>`)
    + filaTT(`Salida F<sub>${c}</sub>`, fmt(p.F))
    + '<div class="tt-sep"></div>'
    + COMPONENTES.map((q) => filaTT(q === 'viaje' ? 'Viaje acumulado' : `${PARAM_HTML[q]} acumulado`, fmt(p.espera[q], 3), q, q === destacado)).join('')
    + '<div class="tt-sep"></div>'
    + filaTT(`Manipulación en D<sub>${c}</sub>`, `${fmt(manip, 3)} · ${fmt(p.D > 0 ? (manip / p.D) * 100 : 0, 1)} %`)
    + filaTT('Servicio F − T', fmt(p.servicio, 3));
}

function htmlArco(a, n) {
  const esperan = a.regreso ? 0 : n - a.k;
  return `<div class="tt-titulo">${a.regreso ? 'Regreso al depósito' : 'Viaje'} · ${a.desde} → ${a.hasta}</div>`
    + filaTT('Tiempo de viaje c<sub>ij</sub>', `<strong>${fmt(a.c)}</strong>`, 'viaje')
    + filaTT('Sale → llega', `${fmt(a.inicio)} → ${fmt(a.fin)}`)
    + '<div class="tt-sep"></div>'
    + filaTT('Clientes que aún esperan', String(esperan))
    + filaTT('Aporte a Σ D<sub>i</sub>', a.regreso ? '0 · no cuenta' : `${fmt(a.c)} × ${esperan} = ${fmt(a.c * esperan)}`);
}

function htmlOp(op, p) {
  return `<div class="tt-titulo">Paso ${op.paso} · ${op.etiqueta}</div>`
    + filaTT(`${PARAM_HTML[op.param]} por unidad (cliente ${p.cliente})`, fmt(op.tasa, 3), op.param)
    + filaTT('Unidades', fmt(op.unidades))
    + filaTT('Duración', `<strong>${fmt(op.duracion, 3)}</strong>`)
    + filaTT('Desde → hasta', `${fmt(op.inicio)} → ${fmt(op.fin)}`);
}

// --- Piezas de interfaz ------------------------------------------------------

function segmentado(etiqueta, opciones, actual, alCambiar) {
  const grupo = el('div', { class: 'segmentado', role: 'group', 'aria-label': etiqueta });
  for (const [valor, texto] of opciones) {
    const boton = el('button', { type: 'button', 'aria-pressed': String(valor === actual) }, texto);
    boton.addEventListener('click', () => {
      if (boton.getAttribute('aria-pressed') === 'true') return;
      for (const b of grupo.children) b.setAttribute('aria-pressed', String(b === boton));
      alCambiar(valor);
    });
    grupo.append(boton);
  }
  return el('div', { class: 'tiempos-control' },
    el('span', { class: 'tiempos-control__etiqueta', 'aria-hidden': 'true' }, etiqueta),
    grupo);
}

function leyenda(componentes, { alfiler = false, politicas = false } = {}) {
  const items = componentes.map((c) => el('li', {},
    el('span', { class: `muestra tiempos-color--${c}`, 'aria-hidden': 'true' }),
    el('span', { html: ETIQUETA_COMP[c] })));
  if (alfiler) {
    items.push(el('li', {},
      el('span', { class: 'tiempos-leyenda__alfiler', 'aria-hidden': 'true' }),
      el('span', { html: 'D<sub>i</sub> entrega' })));
  }
  if (politicas) {
    items.push(
      el('li', { class: 'tiempos-leyenda__sep', 'aria-hidden': 'true' }),
      el('li', {}, el('span', { class: 'muestra muestra--anillo tiempos-color--p1', 'aria-hidden': 'true' }), el('span', {}, 'Política 1')),
      el('li', {}, el('span', { class: 'muestra muestra--anillo tiempos-color--p2', 'aria-hidden': 'true' }), el('span', {}, 'Política 2')));
  }
  return el('ul', { class: 'tiempos-leyenda', 'aria-label': 'Leyenda de colores' }, items);
}

// --- Módulo ------------------------------------------------------------------

export function crear(raiz, estado) {
  let vista = null;
  return {
    render(sim) {
      vista?.destruir();
      vista = montar(raiz, estado, sim);
    },
    destruir() {
      vista?.destruir();
      vista = null;
      raiz.replaceChildren();
    },
  };
}

function montar(raiz, estado, sim) {
  const d3 = window.d3;
  const paradas = sim.paradas;
  const n = paradas.length;
  const st = {
    modoA: 'ampliado',
    modoB: 'total',
    scroll: false,        // cabezal ligado al scroll (escritorio sin movimiento reducido)
    progreso: 0,
    kCabezal: 0,          // parada bajo el cabezal (la que atiende o la próxima)
    fuente: 'elegida',    // la lupa sigue al cabezal o a la parada elegida
    elegida: 0,
    hover: estado.get('hover') ?? null,
    lupaK: -1,
    pasoActual: undefined,
    clavePildoras: null,
    destruyendo: false,
    raf: 0,
    temporizador: 0,
    dueno: null,          // nodo de la pista o la lupa cuyo tooltip está abierto
    ancho: 0,
    alto: 0,
  };
  const mz = { m: 1 };              // 0 = escala real, 1 = servicios ampliados
  const cab = { t: paradas[0].D };  // instante bajo el cabezal
  const ctx = gsap.context(() => {}, raiz);
  const anim = (fn) => ctx.add(fn);
  const duracion = (d) => (movimientoReducido() ? 0 : d);

  // --- Tarjeta A: línea de tiempo -------------------------------------------
  const instruccionA = el('span', {});
  const pistaA = el('div', { class: 'tiempos-pista' });
  const notaA = el('p', { class: 'tiempos-nota' });
  const lupa = crearLupa();
  const tarjetaA = el('article', { class: 'tarjeta tiempos-tarjeta tiempos-tarjeta--linea', 'aria-labelledby': 'tiempos-a-titulo' },
    el('header', { class: 'tiempos-cabecera' },
      el('div', { class: 'tiempos-cabecera__texto' },
        el('h3', { class: 'tarjeta__titulo', id: 'tiempos-a-titulo' }, 'Línea de tiempo de la ruta'),
        el('p', { class: 'tiempos-bajada' },
          el('span', { html: `Del depósito (t = 0) al regreso (t = ${fmt(sim.regreso)}). Las barras grises son los viajes c<sub>ij</sub>; los bloques de color, el servicio en cada cliente entre T<sub>i</sub> y F<sub>i</sub>; cada alfiler marca D<sub>i</sub>. ` }),
          instruccionA)),
      segmentado('Servicio', [['ampliado', 'Ampliado'], ['real', 'Escala real']], 'ampliado', cambiarModoA)),
    pistaA,
    el('div', { class: 'tiempos-pie-pista' }, leyenda(COMPONENTES, { alfiler: true }), notaA),
    lupa.nodo);

  // --- Tarjeta B: espera de cada cliente ------------------------------------
  const B = crearB();

  const contenedor = el('div', { class: 'contenedor tiempos' }, tarjetaA, B.tarjeta);
  raiz.replaceChildren(contenedor);

  let A = null;
  maquetarA();
  maquetarB(0);
  actualizarNotaA();
  actualizarModoUI();
  fijarAltoLupa();
  refrescarLupa(true);
  marcarHover();

  // --- Animaciones según el medio -------------------------------------------
  const mm = gsap.matchMedia();
  mm.add(Q_SCRUB, () => {
    gsap.killTweensOf(cab);
    st.scroll = true;
    st.fuente = 'cabezal';
    st.kCabezal = -1;
    actualizarModoUI();
    const proxy = { p: 0 };
    gsap.to(proxy, {
      p: 1,
      ease: 'none',
      onUpdate: () => moverCabezal(proxy.p),
      scrollTrigger: { trigger: tarjetaA, start: 'top 75%', end: 'bottom 35%', scrub: 0.5 },
    });
    moverCabezal(0);
    return () => {
      const base = indiceBase();
      st.scroll = false;
      if (st.destruyendo) return;
      st.elegida = clamp(base, 0, n - 1);
      st.fuente = 'elegida';
      st.kCabezal = st.elegida;
      cab.t = paradas[st.elegida].D;
      st.clavePildoras = null;
      actualizarModoUI();
      colocarCabezal();
      refrescarLupa();
    };
  });
  mm.add(Q_ANIMAR, () => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: B.marco, start: 'top 85%', once: true } });
    tl.fromTo(B.filas.map((f) => f.barra), { clipPath: 'inset(0% 100% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.out', stagger: 0.07, clearProps: 'clipPath' }, 0)
      .fromTo(B.filas.map((f) => f.valor), { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.45, ease: 'power1.out', stagger: 0.07, clearProps: 'opacity,visibility' }, 0.4)
      .fromTo(B.proporcion, { clipPath: 'inset(0% 100% 0% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'power3.out', clearProps: 'clipPath' }, 0.3);
  });

  // --- Resaltado compartido y tamaño ----------------------------------------
  const desuscribir = estado.on('hover', (cliente) => {
    st.hover = cliente ?? null;
    marcarHover();
    cancelAnimationFrame(st.raf);
    // Al pasar de un elemento a otro del mismo cliente llega null y luego el cliente: se espera un cuadro.
    if (st.hover == null) st.raf = requestAnimationFrame(() => refrescarLupa());
    else refrescarLupa();
  });

  st.ancho = contenedor.clientWidth;
  st.alto = contenedor.offsetHeight;
  const ro = new ResizeObserver(() => {
    clearTimeout(st.temporizador);
    st.temporizador = setTimeout(() => {
      if (st.destruyendo) return;
      const ancho = contenedor.clientWidth;
      if (Math.abs(ancho - st.ancho) > 1) {
        st.ancho = ancho;
        maquetarA();
        maquetarB(0);
        fijarAltoLupa();
        refrescarLupa(true);
        marcarHover();
      }
      const alto = contenedor.offsetHeight;
      if (Math.abs(alto - st.alto) > 2) {
        st.alto = alto;
        window.ScrollTrigger?.refresh();
      }
    }, 160);
  });
  ro.observe(contenedor);
  // Con las fuentes definitivas cambian los cortes de línea: se vuelve a medir la lupa.
  document.fonts?.ready.then(() => {
    if (st.destruyendo) return;
    fijarAltoLupa();
    refrescarLupa(true);
  });

  return {
    destruir() {
      st.destruyendo = true;
      desuscribir();
      ro.disconnect();
      clearTimeout(st.temporizador);
      cancelAnimationFrame(st.raf);
      mm.revert();
      ctx.revert();
      gsap.killTweensOf([cab, mz]);
      ocultarTooltip();
      raiz.replaceChildren();
    },
  };

  // ==========================================================================
  // Pista (tarjeta A)
  // ==========================================================================

  function maquetarA() {
    const W = Math.max(260, Math.round(pistaA.clientWidth) || 900);
    const movil = W < 640;
    const m = { izq: movil ? 12 : 16, der: movil ? 12 : 16 };
    const ancho = W - m.izq - m.der;
    const fNum = movil ? 10 : 11;
    // Alfileres más chicos cuando hay muchos clientes en poco ancho.
    const r = clamp(ancho / (n * 2.6), 7, movil ? 8.5 : 11);
    const fAlf = r < 8 ? 9 : fNum;
    const medio = movil ? 9 : 11; // media altura del bloque de servicio

    const tramos = crearTramos(sim);
    const ts = [tramos[0].t0, ...tramos.map((s) => s.t1)];
    const total = ts[ts.length - 1] - ts[0] || 1;
    const xsReal = ts.map((t) => ((t - ts[0]) / total) * ancho);
    const xsAmpl = rangoAmpliado(
      tramos.map((s) => s.t1 - s.t0),
      tramos.map((s) => s.tipo === 'servicio'),
      ancho,
      Math.min(movil ? 8 : 10, (0.3 * ancho) / n));
    // d3 necesita un dominio estrictamente creciente: se omiten los tramos de duración nula.
    const vale = ts.map((t, i) => i === 0 || t - ts[i - 1] > EPS);
    const dominio = ts.filter((_, i) => vale[i]);
    const escalaCon = (m01) => {
      if (dominio.length < 2) return d3.scaleLinear().domain([ts[0], ts[0] + 1]).range([0, ancho]);
      const rango = xsReal.map((x, i) => lerp(x, xsAmpl[i], m01)).filter((_, i) => vale[i]);
      return d3.scaleLinear().domain(dominio).range(rango);
    };

    // Alfileres: niveles para cada modo; la altura total cubre el peor caso.
    const anchosValor = paradas.map((p) => anchoMono(fmt(p.D), fNum));
    const limite = ancho + m.der - 2;
    const nivelesCon = (m01) => {
      const e = escalaCon(m01);
      return asignarNiveles(paradas.map((p) => e(p.D)), r, anchosValor, limite, n > 10 ? 4 : 3);
    };
    const niv = [nivelesCon(0), nivelesCon(1)];
    const nNiv = Math.max(niv[0].total, niv[1].total);
    const altoNivel = 2 * r + 6;
    const yTope = 5;
    const yNivel = (j) => yTope + r + (nNiv - 1 - j) * altoNivel;
    const yPista = yNivel(0) + r + 12 + medio;
    const yEje = yPista + medio + 10;
    const H = yEje + 28;
    const ticks = d3.ticks(ts[0], ts[ts.length - 1], Math.max(3, Math.floor(ancho / (movil ? 85 : 105))));

    const raizSvg = svg('svg', {
      class: `tiempos-svg${movil ? ' tiempos-svg--movil' : ''}`,
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: 'img',
      'aria-label': `Línea de tiempo de la ruta ${sim.ruta.join(' → ')}: ${n} paradas y regreso al depósito en t = ${fmt(sim.regreso)}.`,
    });
    const g = svg('g', { transform: `translate(${m.izq},0)` });
    const guias = ticks.map(() => svg('line', { class: 'tiempos-guia', y1: yTope, y2: yEje }));
    const gEje = svg('g', { class: 'tiempos-eje', transform: `translate(0,${yEje})`, 'aria-hidden': 'true' });
    const base = svg('line', { class: 'tiempos-base', x1: 0, x2: ancho, y1: yPista, y2: yPista });
    const lado = movil ? 8 : 10;
    const depositos = [0, ancho].map((x) => svg('rect', { class: 'tiempos-deposito', x: x - lado / 2, y: yPista - lado / 2, width: lado, height: lado, rx: 2 }));

    const gArcos = svg('g', { class: 'tiempos-arcos' });
    const gHits = svg('g', { class: 'tiempos-hits' });
    const arcos = sim.arcos.map((arco) => {
      const barra = svg('rect', { class: `tiempos-viaje${arco.regreso ? ' tiempos-viaje--regreso' : ''}`, y: yPista - 3, height: 6, rx: 3 });
      const texto = svg('text', { class: 'tiempos-c', y: yPista - 7, 'font-size': fNum }, fmt(arco.c));
      const hit = svg('rect', { class: 'tiempos-hit tiempos-hit--arco', y: yPista - medio - 3, height: 2 * medio + 6 });
      enlazar(hit, () => htmlArco(arco, n));
      gArcos.append(barra, texto);
      gHits.append(hit);
      return { arco, barra, texto, hit, anchoTexto: anchoMono(fmt(arco.c), fNum) };
    });

    const gParadas = svg('g', { class: 'tiempos-paradas' });
    // Los tallos van en su propio grupo, debajo de todos los chips y valores: así un
    // tallo de un nivel alto nunca tacha el valor de un alfiler de un nivel más bajo.
    const gTallos = svg('g', { class: 'tiempos-tallos' });
    const gAlfileres = svg('g', { class: 'tiempos-alfileres' });
    const bloques = paradas.map((p, k) => {
      const grupo = svg('g', { class: `tiempos-parada tiempos-parada--p${pol(p)}` });
      const halo = svg('rect', { class: 'tiempos-halo', y: yPista - medio - 3, height: 2 * medio + 6, rx: 4 });
      const fondo = svg('rect', { class: 'tiempos-servicio', y: yPista - medio, height: 2 * medio, rx: 2 });
      const visibles = p.ops.filter((o) => o.duracion > EPS);
      const ops = visibles.map((op, j) => ({
        op,
        ultimo: j === visibles.length - 1,
        rect: svg('rect', { class: `tiempos-op tiempos-color--${op.param}`, y: yPista - medio, height: 2 * medio }),
      }));
      const marcaD = svg('line', { class: 'tiempos-marca-d', y1: yPista - medio - 2, y2: yPista + medio + 2 });
      grupo.append(halo, fondo, ...ops.map((o) => o.rect), marcaD);
      gParadas.append(grupo);

      const hit = svg('rect', { class: 'tiempos-hit', y: yPista - medio - 4, height: 2 * medio + 8 });
      enlazarParada(hit, p, k);
      gHits.append(hit);

      const alfiler = svg('g', { class: `tiempos-alfiler tiempos-alfiler--p${pol(p)}` });
      const tallo = svg('line', { class: 'tiempos-alfiler__tallo', y2: yPista - medio - 2 });
      gTallos.append(tallo);
      const circulo = svg('circle', { class: 'tiempos-alfiler__chip', cx: 0, r });
      const numero = svg('text', { class: 'tiempos-alfiler__num', x: 0, dy: '0.35em', 'font-size': fAlf }, String(p.cliente));
      const valor = svg('text', { class: 'tiempos-alfiler__valor', dy: '0.35em', 'font-size': fNum }, fmt(p.D));
      const zona = svg('circle', { class: 'tiempos-hit', cx: 0, r: r + 4 });
      alfiler.append(circulo, numero, valor, zona);
      enlazarParada(alfiler, p, k);
      gAlfileres.append(alfiler);
      return { parada: p, k, grupo, halo, fondo, ops, marcaD, hit, alfiler, tallo, circulo, numero, valor, zona };
    });

    const velo = svg('rect', { class: 'tiempos-velo', y: 0, height: yPista + medio + 3, visibility: 'hidden' });
    const altoCaja = movil ? 16 : 18;
    const cabezalCaja = svg('rect', { y: yEje + 3, height: altoCaja, rx: altoCaja / 2 });
    const cabezalTexto = svg('text', { y: yEje + 3 + altoCaja / 2, dy: '0.35em', 'font-size': fNum });
    const cabezal = svg('g', { class: 'tiempos-cabezal', 'aria-hidden': 'true' },
      svg('line', { x1: 0, x2: 0, y1: yTope - 2, y2: yEje }), cabezalCaja, cabezalTexto);

    g.append(svg('g', { class: 'tiempos-guias' }, guias), gEje, base, gArcos, gParadas, ...depositos, gTallos, gAlfileres, velo, cabezal, gHits);
    raizSvg.append(g);
    pistaA.replaceChildren(raizSvg);

    A = {
      W, H, m, ancho, r, fNum, movil, tramos, ticks, escalaCon, escala: escalaCon(mz.m),
      niv, yNivel, guias, gEje, arcos, bloques, velo, cabezal, cabezalCaja, cabezalTexto,
      pausa: ancho * Math.min(0.06, 0.35 / n), // avance de scroll mínimo para cada servicio
      acum: [0],
    };
    colocarA();
    soltarHuerfano(true);
  }

  /** Ubica todo según la mezcla actual entre escala real y ampliada. */
  function colocarA() {
    if (!A) return;
    const e = A.escalaCon(mz.m);
    A.escala = e;
    d3.select(A.gEje).call(d3.axisBottom(e).tickValues(A.ticks).tickFormat((d) => fmt(d, 2)).tickSize(4).tickSizeOuter(0).tickPadding(5));
    A.guias.forEach((linea, i) => {
      const x = e(A.ticks[i]);
      atributos(linea, { x1: x, x2: x });
    });

    for (const a of A.arcos) {
      const x0 = e(a.arco.inicio);
      const x1 = e(a.arco.fin);
      const w = Math.max(0, x1 - x0 - 2);
      atributos(a.barra, { x: x0 + 1, width: w });
      atributos(a.texto, { x: (x0 + x1) / 2, visibility: w >= a.anchoTexto + 10 ? 'visible' : 'hidden' });
      atributos(a.hit, { x: x0, width: Math.max(0, x1 - x0) });
    }

    const objetivo = mz.m >= 0.5 ? A.niv[1] : A.niv[0];
    for (const b of A.bloques) {
      const p = b.parada;
      const x0 = e(p.T);
      const x1 = e(p.F);
      const w = x1 - x0;
      const wv = Math.max(w, 2); // en escala real el servicio puede medir menos de un píxel
      const xv = x0 - (wv - w) / 2;
      atributos(b.fondo, { x: xv, width: wv });
      atributos(b.halo, { x: xv - 3, width: wv + 6 });
      for (const o of b.ops) {
        const a0 = e(o.op.inicio);
        const a1 = e(o.op.fin);
        const hueco = !o.ultimo && a1 - a0 > 5 ? 1 : 0;
        atributos(o.rect, { x: a0, width: Math.max(0, a1 - a0 - hueco) });
      }
      const xd = e(p.D);
      atributos(b.marcaD, { x1: xd, x2: xd });
      const wh = Math.max(w, 16);
      atributos(b.hit, { x: (x0 + x1) / 2 - wh / 2, width: wh });

      const yC = lerp(A.yNivel(A.niv[0].niveles[b.k]), A.yNivel(A.niv[1].niveles[b.k]), mz.m);
      b.alfiler.setAttribute('transform', `translate(${xd},0)`);
      atributos(b.tallo, { x1: xd, x2: xd, y1: yC + A.r });
      b.circulo.setAttribute('cy', yC);
      b.zona.setAttribute('cy', yC);
      b.numero.setAttribute('y', yC);
      const ladoV = objetivo.lados[b.k];
      atributos(b.valor, {
        x: ladoV * (A.r + 4),
        y: yC,
        'text-anchor': ladoV > 0 ? 'start' : 'end',
        visibility: objetivo.conValor ? 'visible' : 'hidden',
      });
    }

    // Recorrido con scroll: cada servicio recibe un avance mínimo para que la lupa alcance a mostrarlo.
    A.acum = [0];
    A.tramos.forEach((s, i) => {
      const w = Math.max(0, e(s.t1) - e(s.t0));
      const peso = s.tipo === 'servicio' && s.t1 - s.t0 > EPS ? Math.max(w, A.pausa) : w;
      A.acum.push(A.acum[i] + peso);
    });

    if (st.scroll) cab.t = tDesdeProgreso(st.progreso);
    colocarCabezal();
    if (st.scroll) seguirCabezal();
  }

  function tDesdeProgreso(p) {
    const { tramos, acum } = A;
    const total = acum[acum.length - 1];
    if (!(total > 0)) return tramos[0].t0;
    const objetivo = clamp(p, 0, 1) * total;
    for (let i = 0; i < tramos.length; i++) {
      if (objetivo <= acum[i + 1] || i === tramos.length - 1) {
        const w = acum[i + 1] - acum[i];
        const u = w > 0 ? clamp((objetivo - acum[i]) / w, 0, 1) : 1;
        return tramos[i].t0 + u * (tramos[i].t1 - tramos[i].t0);
      }
    }
    return tramos[tramos.length - 1].t1;
  }

  function colocarCabezal() {
    if (!A) return;
    const x = A.escala(cab.t);
    A.cabezal.setAttribute('transform', `translate(${x},0)`);
    const texto = `t = ${fmt(cab.t, st.scroll ? 1 : 2)}`;
    if (A.cabezalTexto.textContent !== texto) A.cabezalTexto.textContent = texto;
    const wp = anchoMono(texto, A.fNum) + 14;
    const izq = clamp(x - wp / 2, -A.m.izq + 1, A.ancho + A.m.der - 1 - wp) - x;
    atributos(A.cabezalCaja, { x: izq, width: wp });
    A.cabezalTexto.setAttribute('x', izq + wp / 2);
    if (st.scroll) atributos(A.velo, { x, width: Math.max(0, A.ancho + A.m.der - x), visibility: 'visible' });
    else A.velo.setAttribute('visibility', 'hidden');
  }

  function moverCabezal(p) {
    if (!A) return;
    st.progreso = p;
    cab.t = tDesdeProgreso(p);
    colocarCabezal();
    seguirCabezal();
  }

  /** Cabezal sin scroll: se desliza hasta D_i de la parada elegida. */
  function moverCabezalA(t) {
    const d = duracion(0.55);
    if (!d) {
      gsap.killTweensOf(cab);
      cab.t = t;
      colocarCabezal();
      return;
    }
    anim(() => gsap.to(cab, { t, duration: d, ease: 'power2.inOut', overwrite: true, onUpdate: colocarCabezal }));
  }

  function seguirCabezal() {
    let k = paradas.findIndex((p) => p.F > cab.t + EPS);
    if (k < 0) k = n - 1;
    if (k !== st.kCabezal) {
      st.kCabezal = k;
      st.fuente = 'cabezal';
    }
    refrescarLupa();
  }

  function cambiarModoA(modo) {
    st.modoA = modo;
    actualizarNotaA();
    const destino = modo === 'ampliado' ? 1 : 0;
    const d = duracion(0.7);
    if (!d) {
      gsap.killTweensOf(mz);
      mz.m = destino;
      colocarA();
      return;
    }
    anim(() => gsap.to(mz, { m: destino, duration: d, ease: 'power2.inOut', overwrite: true, onUpdate: colocarA }));
  }

  function actualizarNotaA() {
    const servicio = paradas.reduce((s, p) => s + p.servicio, 0);
    const parte = `${fmt(servicio, 3)} de ${fmt(sim.regreso)} (${fmt(sim.regreso > 0 ? (servicio / sim.regreso) * 100 : 0, 1)} % del recorrido)`;
    notaA.textContent = st.modoA === 'ampliado'
      ? `Servicios ampliados a un ancho mínimo para que se vean; en escala real suman ${parte}.`
      : `Escala real: los servicios suman ${parte}. La lupa los muestra en detalle.`;
  }

  function actualizarModoUI() {
    contenedor.classList.toggle('tiempos--scroll', st.scroll);
    instruccionA.textContent = st.scroll
      ? 'Al bajar, el cabezal recorre la ruta y la lupa muestra la parada bajo él.'
      : 'Elige una parada en la pista, en las píldoras o con las flechas para verla en la lupa.';
  }

  function enlazar(nodo, html, cliente = null) {
    nodo.addEventListener('pointerenter', (e) => {
      st.dueno = { nodo, cliente };
      if (cliente != null) estado.set({ hover: cliente });
      mostrarTooltip(html(), e);
    });
    nodo.addEventListener('pointermove', moverTooltip);
    nodo.addEventListener('pointerleave', () => {
      if (st.dueno?.nodo === nodo) st.dueno = null;
      if (cliente != null) estado.set({ hover: null });
      ocultarTooltip();
    });
  }

  /**
   * Si se redibuja la pista o la lupa con el puntero encima, el nodo sale del DOM sin
   * pointerleave: se cierra su tooltip y, si se pide, se suelta el cliente resaltado.
   */
  function soltarHuerfano(conHover = false) {
    const d = st.dueno;
    if (!d || d.nodo.isConnected) return;
    st.dueno = null;
    ocultarTooltip();
    if (conHover && d.cliente != null && estado.get('hover') === d.cliente) estado.set({ hover: null });
  }

  function enlazarParada(nodo, p, k) {
    enlazar(nodo, () => htmlParada(p, n), p.cliente);
    nodo.addEventListener('click', () => elegir(k));
  }

  // ==========================================================================
  // Lupa
  // ==========================================================================

  function crearLupa() {
    const anterior = el('button', { type: 'button', class: 'boton boton--icono', 'aria-label': 'Parada anterior', onclick: () => elegir(indiceBase() - 1) }, '‹');
    const siguiente = el('button', { type: 'button', class: 'boton boton--icono', 'aria-label': 'Parada siguiente', onclick: () => elegir(indiceBase() + 1) }, '›');
    const conFlechas = n <= 12;
    const flecha = () => (conFlechas ? el('span', { class: 'pasos__flecha', 'aria-hidden': 'true' }, '→') : null);
    const pildoras = paradas.map((p, k) => {
      const b = el('button', {
        type: 'button',
        class: `paso paso--p${pol(p)}`,
        'aria-label': `Parada ${p.k}: cliente ${p.cliente}, ${POLITICA_TEXTO[p.politica]}`,
        onclick: () => elegir(k),
      }, String(p.cliente));
      b.addEventListener('pointerenter', () => estado.set({ hover: p.cliente }));
      b.addEventListener('pointerleave', () => estado.set({ hover: null }));
      return b;
    });
    const pasos = el('div', { class: 'pasos tiempos-ruta', role: 'group', 'aria-label': 'Parada que muestra la lupa' },
      el('span', { class: 'paso paso--deposito', 'aria-hidden': 'true' }, '0'),
      pildoras.flatMap((b) => [flecha(), b]),
      flecha(),
      el('span', { class: 'paso paso--deposito', 'aria-hidden': 'true' }, '0'));

    // El estado cambia con el scroll: va en una fila de alto fijo para no mover la página.
    const estadoTxt = el('span', { class: 'tiempos-ficha__estado num' });
    const ficha = el('div', { class: 'tiempos-ficha' });
    const grafico = el('div', { class: 'tiempos-lupa__grafico' });
    const grupos = el('div', { class: 'tiempos-grupos' });
    const cuerpo = el('div', { class: 'tiempos-lupa__cuerpo' },
      el('div', { class: 'tiempos-lupa__izq' }, ficha, el('div', { class: 'tiempos-lupa__estado' }, estadoTxt), grafico),
      grupos);
    const nodo = el('section', { class: 'tiempos-lupa', 'aria-labelledby': 'tiempos-lupa-titulo' },
      el('div', { class: 'tiempos-lupa__cabeza' },
        el('h4', { class: 'tiempos-lupa__titulo', id: 'tiempos-lupa-titulo' }, 'Lupa · servicio en una parada'),
        el('div', { class: 'tiempos-lupa__nav' }, anterior, pasos, siguiente)),
      cuerpo);
    return { nodo, anterior, siguiente, pildoras, estado: estadoTxt, ficha, grafico, grupos, cuerpo, filas: new Map(), svg: null };
  }

  /** Alto mínimo de la lupa = el de la parada más alta, para que el scroll no cambie de largo. */
  function fijarAltoLupa() {
    const cuerpo = lupa.cuerpo;
    cuerpo.style.minHeight = '';
    let alto = 0;
    for (const p of paradas.slice(0, 60)) {
      dibujarLupa(p);
      alto = Math.max(alto, cuerpo.offsetHeight);
    }
    if (alto > 0) cuerpo.style.minHeight = `${Math.ceil(alto)}px`;
    st.lupaK = -1;
  }

  /** Parada de la lupa sin contar el hover: la del cabezal (con scroll) o la elegida. */
  function indiceBase() {
    return st.scroll && st.fuente === 'cabezal' ? Math.max(0, st.kCabezal) : st.elegida;
  }

  function indiceLupa() {
    const kh = st.hover == null ? -1 : paradas.findIndex((p) => p.cliente === st.hover);
    return kh >= 0 ? kh : indiceBase();
  }

  function elegir(k) {
    if (k < 0 || k >= n) return;
    st.elegida = k;
    st.fuente = 'elegida';
    if (!st.scroll) {
      st.kCabezal = k;
      moverCabezalA(paradas[k].D);
    }
    refrescarLupa();
  }

  function refrescarLupa(forzar = false) {
    if (st.destruyendo) return;
    const k = indiceLupa();
    if (forzar || k !== st.lupaK) {
      st.lupaK = k;
      dibujarLupa(paradas[k]);
      for (const b of A?.bloques ?? []) b.grupo.classList.toggle('es-lupa', b.k === k);
    }
    actualizarCursorLupa();
    actualizarPildoras();
  }

  function dibujarLupa(p) {
    const c = p.cliente;
    const quedan = n - (p.k - 1); // clientes que esperan antes de D (incluido este)
    const dato = (dt, dd, fuerte = false) => el('div', { class: fuerte ? 'es-fuerte' : null },
      el('dt', { html: dt }), el('dd', { class: 'num' }, dd));
    lupa.ficha.replaceChildren(
      el('div', { class: 'tiempos-ficha__fila' },
        el('span', { class: 'tiempos-ficha__k num' }, `#${p.k}`),
        chip(p),
        el('span', { class: 'tiempos-ficha__nombre' }, `Cliente ${c}`),
        el('span', { class: `politica-chip politica-chip--p${pol(p)}` }, POLITICA_TEXTO[p.politica])),
      el('dl', { class: 'tiempos-ficha__tiempos' },
        dato(`T<sub>${c}</sub> llegada`, fmt(p.T)),
        dato(`D<sub>${c}</sub> entrega`, fmt(p.D), true),
        dato(`F<sub>${c}</sub> salida`, fmt(p.F)),
        dato('Servicio F − T', fmt(p.servicio, 3))));
    dibujarGraficoLupa(p);
    lupa.filas = new Map();
    lupa.grupos.replaceChildren(grupoPasos(p, true, quedan), grupoPasos(p, false, quedan - 1));
    st.pasoActual = undefined;
  }

  function dibujarGraficoLupa(p) {
    const c = p.cliente;
    const W = Math.max(240, Math.round(lupa.grafico.clientWidth) || 560);
    const H = 108;
    const mx = 1;
    const ancho = W - 2 * mx;
    const f = W < 420 ? 10.5 : 11.5;
    const dur = p.F - p.T;
    const visibles = p.ops.filter((o) => o.duracion > EPS);
    // Escala propia del servicio; cada paso mide al menos 4 px aunque dure muy poco.
    let x = () => mx + ancho / 2;
    if (dur > EPS && visibles.length) {
      const xs = rangoAmpliado(visibles.map((o) => o.duracion), visibles.map(() => true), ancho,
        Math.min(4, ancho / (4 * visibles.length)));
      const escala = d3.scaleLinear()
        .domain([p.T, ...visibles.map((o) => o.fin)])
        .range(xs.map((v) => mx + v))
        .clamp(true);
      x = (t) => escala(t);
    }
    const yB = 30;
    const hB = 28;
    const banda = [22, 82];
    const xT = x(p.T);
    const xD = x(p.D);
    const xF = x(p.F);

    const nodo = svg('svg', {
      class: 'tiempos-lupa-svg',
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: 'img',
      'aria-label': `Servicio del cliente ${c}: llega en T = ${fmt(p.T)}, termina la entrega en D = ${fmt(p.D)} y sale en F = ${fmt(p.F)}.`,
    });
    nodo.append(svg('defs', {},
      svg('pattern', { id: 'tiempos-rayado', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svg('line', { class: 'tiempos-rayado', x1: 0, y1: 0, x2: 0, y2: 6 })),
      svg('clipPath', { id: 'tiempos-recorte' }, svg('rect', { x: mx, y: yB, width: ancho, height: hB, rx: 4 }))));

    // Franjas: antes de D (retrasa a este cliente y a los siguientes) y después (solo a los siguientes).
    nodo.append(
      svg('rect', { class: 'tiempos-lupa-antes', x: xT, y: banda[0], width: Math.max(0, xD - xT), height: banda[1] - banda[0] }),
      svg('rect', { class: 'tiempos-lupa-despues', fill: 'url(#tiempos-rayado)', x: xD, y: banda[0], width: Math.max(0, xF - xD), height: banda[1] - banda[0] }));

    const barra = svg('g', { 'clip-path': 'url(#tiempos-recorte)' });
    visibles.forEach((op, j) => {
      const a0 = x(op.inicio);
      const a1 = x(op.fin);
      const w = a1 - a0;
      const hueco = j < visibles.length - 1 && w > 6 ? 2 : 0;
      const wl = Math.max(0, w - hueco);
      const rect = svg('rect', { class: `tiempos-op tiempos-color--${op.param}`, x: a0, y: yB, width: wl, height: hB });
      enlazar(rect, () => htmlOp(op, p));
      barra.append(rect);
      if (wl >= 20) {
        // Subíndice con dy (baseline-shift no funciona en todos los navegadores).
        const letra = op.param[0] === 'u' ? 'u' : 'ℓ';
        const contenido = wl >= 64 ? textoSub(`${op.paso} · ${letra}`, op.param[1], '', f) : [String(op.paso)];
        barra.append(svg('text', {
          class: `tiempos-lupa-op${OSCUROS.has(op.param) ? ' tiempos-lupa-op--claro' : ''}`,
          x: a0 + wl / 2,
          y: yB + hB / 2,
          dy: '0.35em',
          'font-size': f,
        }, ...contenido));
      }
    });
    const cursorVelo = svg('rect', { class: 'tiempos-lupa-velo', y: yB, height: hB, x: xF, width: 0, visibility: 'hidden' });
    barra.append(cursorVelo);
    nodo.append(barra);
    if (dur <= EPS) {
      nodo.append(svg('text', { class: 'tiempos-lupa-vacio', x: W / 2, y: yB + hB / 2, dy: '0.35em' }, 'Sin manipulación en esta parada'));
    }

    // D_i: línea y rótulo arriba
    // Sin servicio, la línea se detiene sobre la barra para no tachar el aviso centrado.
    nodo.append(svg('line', { class: 'tiempos-lupa-d', x1: xD, x2: xD, y1: 17, y2: dur <= EPS ? yB - 3 : yB + hB + 6 }));
    const wD = anchoMono(`D${c} = ${fmt(p.D)}`, f);
    nodo.append(svg('text', {
      class: 'tiempos-lupa-etq tiempos-lupa-etq--d',
      x: clamp(xD, wD / 2 + 1, W - wD / 2 - 1),
      y: 12,
      'font-size': f,
      'text-anchor': 'middle',
    }, ...textoSub('D', c, ` = ${fmt(p.D)}`, f)));

    // Rótulos de las franjas, solo si caben
    const rotulo = (texto, a, b) => {
      if (b - a < anchoTexto(`${texto}${c}`, f) + 12) return;
      nodo.append(svg('text', { class: 'tiempos-lupa-region', x: (a + b) / 2, y: 74, 'font-size': f, 'text-anchor': 'middle' },
        ...textoSub(texto, c, '', f)));
    };
    rotulo('antes de D', xT, xD);
    rotulo('después de D', xD, xF);

    // T_i y F_i (si el servicio no dura nada coinciden: un solo rótulo centrado)
    if (dur <= EPS) {
      nodo.append(
        svg('line', { class: 'tiempos-lupa-tick', x1: xT, x2: xT, y1: yB + hB, y2: 90 }),
        svg('text', { class: 'tiempos-lupa-etq', x: xT, y: 102, 'font-size': f, 'text-anchor': 'middle' },
          ...textoSub('T', c, ' = ', f), ...textoSub('F', c, ` = ${fmt(p.F)}`, f)));
    } else {
      nodo.append(
        svg('line', { class: 'tiempos-lupa-tick', x1: xT, x2: xT, y1: yB + hB, y2: 90 }),
        svg('line', { class: 'tiempos-lupa-tick', x1: xF, x2: xF, y1: yB + hB, y2: 90 }),
        svg('text', { class: 'tiempos-lupa-etq', x: xT, y: 102, 'font-size': f, 'text-anchor': 'start' }, ...textoSub('T', c, ` = ${fmt(p.T)}`, f)),
        svg('text', { class: 'tiempos-lupa-etq', x: xF, y: 102, 'font-size': f, 'text-anchor': 'end' }, ...textoSub('F', c, ` = ${fmt(p.F)}`, f)));
    }

    const cursorLinea = svg('line', { class: 'tiempos-lupa-cursor', x1: xT, x2: xT, y1: yB - 6, y2: yB + hB + 6, visibility: 'hidden' });
    nodo.append(cursorLinea);
    lupa.svg = { x, xF, cursorVelo, cursorLinea };
    lupa.grafico.replaceChildren(nodo);
    soltarHuerfano();
  }

  function grupoPasos(p, antes, m) {
    const c = p.cliente;
    const lista = PASOS.filter((s) => (antes ? s.paso <= 2 : s.paso >= 3));
    const suma = antes ? p.D - p.T : p.F - p.D;
    let quien;
    if (antes) {
      if (m <= 1) quien = `retrasan solo al cliente ${c}, el último de la ruta`;
      else if (m === 2) quien = `retrasan al cliente ${c} y al siguiente`;
      else quien = `retrasan al cliente ${c} y a los ${m - 1} siguientes`;
    } else if (m <= 0) quien = 'no retrasan a nadie: ya no quedan clientes por atender';
    else if (m === 1) quien = 'solo retrasan al cliente siguiente';
    else quien = `solo retrasan a los ${m} clientes siguientes`;

    const filas = lista.map((s) => {
      const op = p.ops.find((o) => o.paso === s.paso);
      const clases = ['tiempos-paso'];
      if (!op) clases.push('tiempos-paso--na');
      else if (OSCUROS.has(op.param)) clases.push('tiempos-paso--oscuro');
      let meta;
      let calculo;
      if (!op) {
        meta = 'No aplica con la Política 1: las entregas no se mueven';
        calculo = '—';
      } else {
        calculo = `${PARAM_HTML[op.param]} <span class="tiempos-paso__por">${fmt(op.unidades)} × ${fmt(op.tasa, 3)}</span> = <strong>${fmt(op.duracion, 3)}</strong>`;
        if (op.duracion <= EPS) meta = 'Sin unidades que mover: no toma tiempo';
        else if (m > 0) meta = `Aporta ${fmt(op.duracion * m, 3)} a Σ D<sub>i</sub> (× ${m} ${m === 1 ? 'cliente' : 'clientes'})`;
        else meta = 'No suma a Σ D<sub>i</sub>: ya nadie espera';
      }
      const fila = el('li', { class: clases.join(' ') },
        el('span', { class: `tiempos-paso__num${op ? ` tiempos-color--${op.param}` : ''}`, 'aria-hidden': 'true' }, String(s.paso)),
        el('span', { class: 'tiempos-paso__etiqueta' }, el('span', { class: 'visualmente-oculto' }, `Paso ${s.paso}: `), op?.etiqueta ?? s.etiqueta),
        el('span', { class: 'tiempos-paso__meta', html: meta }),
        el('span', { class: 'tiempos-paso__calculo num', html: calculo }));
      lupa.filas.set(s.paso, fila);
      return fila;
    });

    return el('section', { class: `tiempos-grupo tiempos-grupo--${antes ? 'antes' : 'despues'}` },
      el('p', { class: 'tiempos-grupo__titulo' },
        el('span', { class: 'tiempos-grupo__muestra', 'aria-hidden': 'true' }),
        el('span', { class: 'tiempos-grupo__texto', html: `<strong>${antes ? 'Antes' : 'Después'} de D<sub>${c}</sub></strong> · pasos ${antes ? '1–2' : '3–5'} · ${quien}` }),
        el('span', { class: 'tiempos-grupo__suma num' }, fmt(suma, 3))),
      el('ol', { class: 'tiempos-pasos', start: lista[0].paso }, filas));
  }

  function actualizarCursorLupa() {
    const p = paradas[st.lupaK];
    if (!p) return;
    const siguiendo = st.scroll && st.hover == null && st.fuente === 'cabezal' && st.lupaK === st.kCabezal;
    const t = cab.t;
    let texto;
    let paso = null;
    if (!siguiendo) texto = `Parada ${p.k} de ${n}`;
    else if (t < p.T - EPS) texto = `En camino · llega en t = ${fmt(p.T)}`;
    else if (t < p.F - EPS) {
      const op = p.ops.find((o) => o.duracion > EPS && t >= o.inicio - EPS && t < o.fin - EPS);
      paso = op?.paso ?? null;
      texto = `${t < p.D - EPS ? 'Atendiendo' : 'Entregado'}${paso ? ` · paso ${paso}` : ''}`;
    } else if (p.k === n) texto = `Atendido · regresa al depósito en t = ${fmt(sim.regreso)}`;
    else texto = `Atendido · salió en t = ${fmt(p.F)}`;
    if (lupa.estado.textContent !== texto) lupa.estado.textContent = texto;
    lupa.estado.classList.toggle('tiempos-ficha__estado--vivo', paso != null);

    const S = lupa.svg;
    const dentro = siguiendo && p.F - p.T > EPS && t >= p.T - EPS && t <= p.F + EPS;
    if (S) {
      if (dentro) {
        const xc = S.x(clamp(t, p.T, p.F));
        atributos(S.cursorLinea, { x1: xc, x2: xc });
        atributos(S.cursorVelo, { x: xc, width: Math.max(0, S.xF - xc) });
      }
      const vis = dentro ? 'visible' : 'hidden';
      S.cursorLinea.setAttribute('visibility', vis);
      S.cursorVelo.setAttribute('visibility', vis);
    }
    if (paso !== st.pasoActual) {
      st.pasoActual = paso;
      lupa.filas.forEach((fila, s) => {
        if (s === paso) fila.setAttribute('aria-current', 'step');
        else fila.removeAttribute('aria-current');
      });
    }
  }

  function actualizarPildoras() {
    const base = indiceBase();
    const atendidos = st.scroll ? paradas.filter((p) => p.D <= cab.t + EPS).length : -1;
    const clave = `${st.lupaK}|${atendidos}|${base}|${st.scroll}`;
    if (clave === st.clavePildoras) return;
    st.clavePildoras = clave;
    lupa.pildoras.forEach((b, k) => {
      if (k === st.lupaK) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      const hecho = st.scroll ? k < atendidos : k < st.lupaK;
      b.classList.toggle('paso--hecho', hecho && k !== st.lupaK);
    });
    lupa.anterior.disabled = base <= 0;
    lupa.siguiente.disabled = base >= n - 1;
  }

  // ==========================================================================
  // Tarjeta B
  // ==========================================================================

  function crearB() {
    const lista = el('ol', { class: 'tiempos-filas', 'aria-label': 'Espera de cada cliente en el orden de visita' });
    const filas = paradas.map((p, k) => {
      const segs = Object.fromEntries(COMPONENTES.map((c) => [c, el('span', { class: `tiempos-seg tiempos-color--${c}`, dataset: { comp: c } })]));
      const barra = el('div', { class: 'tiempos-fila__barra' }, Object.values(segs));
      const valor = el('span', { class: 'tiempos-fila__valor num' });
      const pista = el('div', { class: 'tiempos-fila__pista' }, barra, valor);
      const manip = manipDe(p);
      const nodo = el('li', {
        class: 'tiempos-fila',
        tabindex: '0',
        'aria-label': `Parada ${p.k}, cliente ${p.cliente}, ${POLITICA_TEXTO[p.politica]}: D = ${fmt(p.D)}, de los cuales ${fmt(p.espera.viaje)} son viaje y ${fmt(manip, 3)} manipulación.`,
      },
        el('div', { class: 'tiempos-fila__rotulo', 'aria-hidden': 'true' },
          el('span', { class: 'tiempos-fila__k num' }, `#${p.k}`),
          chip(p)),
        pista);
      const f = { parada: p, k, nodo, segs, barra, valor, pista, manip, comp: null };
      const compDe = (e) => e.target?.closest?.('[data-comp]')?.dataset.comp ?? null;
      nodo.addEventListener('pointerenter', (e) => {
        f.comp = compDe(e);
        estado.set({ hover: p.cliente });
        mostrarTooltip(htmlParada(p, n, f.comp), e);
      });
      nodo.addEventListener('pointermove', (e) => {
        const comp = compDe(e);
        if (comp !== f.comp) {
          f.comp = comp;
          mostrarTooltip(htmlParada(p, n, comp), e);
        } else moverTooltip(e);
      });
      nodo.addEventListener('pointerleave', () => {
        estado.set({ hover: null });
        ocultarTooltip();
      });
      nodo.addEventListener('focus', () => {
        estado.set({ hover: p.cliente });
        const caja = nodo.getBoundingClientRect();
        mostrarTooltip(htmlParada(p, n), { clientX: caja.left + 24, clientY: caja.bottom });
      });
      nodo.addEventListener('blur', () => {
        estado.set({ hover: null });
        ocultarTooltip();
      });
      return f;
    });
    lista.append(...filas.map((f) => f.nodo));

    const guias = el('div', { class: 'tiempos-guias-b', 'aria-hidden': 'true' });
    const eje = el('div', { class: 'tiempos-eje-b', 'aria-hidden': 'true' });
    const marco = el('div', { class: 'tiempos-marco' }, guias, lista, eje);
    const nota = el('p', { class: 'tiempos-nota tiempos-nota--b' });

    // Pie: Σ D_i y su descomposición
    const sumas = Object.fromEntries(COMPONENTES.map((c) => [c, paradas.reduce((s, p) => s + p.espera[c], 0)]));
    const totManip = manipDe({ espera: sumas });
    const pct = (v) => fmt(sim.objetivo > 0 ? (v / sim.objetivo) * 100 : 0, 1);
    const proporcion = el('div', { class: 'tiempos-proporcion', 'aria-hidden': 'true' },
      COMPONENTES.filter((c) => sumas[c] > EPS).map((c) => el('span', { class: `tiempos-color--${c}`, style: `flex-grow: ${sumas[c]}` })));
    const primero = sim.arcos[0];
    const ultimo = sim.arcos[n - 1];
    const notaTotal = n > 1
      ? `El objetivo pondera cada tramo por el número de clientes que aún esperan: el viaje ${primero.desde} → ${primero.hasta} cuenta ${n} veces, el tramo ${ultimo.desde} → ${ultimo.hasta} una sola vez y el regreso al depósito no cuenta. En cada parada, los pasos 1–2 pesan una vez más que los pasos 3–5. Por eso un tramo largo pesa menos cuanto más tarde ocurre.`
      : `El objetivo pondera cada tramo por el número de clientes que aún esperan: con un solo cliente, el viaje ${primero.desde} → ${primero.hasta} y los pasos 1–2 cuentan una vez; los pasos 3–5 y el regreso no cuentan.`;
    const pie = el('footer', { class: 'tiempos-total' },
      el('div', { class: 'tiempos-total__cifra' },
        el('span', { class: 'tiempos-total__etiqueta', html: 'Σ D<sub>i</sub> · función objetivo' }),
        el('span', { class: 'tiempos-total__valor' }, fmt(sim.objetivo))),
      el('div', { class: 'tiempos-total__desglose' },
        proporcion,
        el('dl', { class: 'tiempos-desglose' },
          el('div', {},
            el('dt', {}, el('span', { class: 'muestra tiempos-color--viaje', 'aria-hidden': 'true' }), 'Viaje'),
            el('dd', { class: 'num' }, `${fmt(sumas.viaje)} · ${pct(sumas.viaje)} %`)),
          el('div', {},
            el('dt', {}, el('span', { class: 'muestra tiempos-desglose__mezcla', 'aria-hidden': 'true' }), 'Manipulación'),
            el('dd', { class: 'num' }, `${fmt(totManip, 3)} · ${pct(totManip)} %`))),
        el('p', { class: 'tiempos-desglose__detalle num', html: PARAMETROS.map((q) => `${PARAM_HTML[q]} ${fmt(sumas[q], 3)}`).join(' · ') })),
      el('p', { class: 'tiempos-total__nota' }, notaTotal));

    const tarjeta = el('article', { class: 'tarjeta tiempos-tarjeta tiempos-tarjeta--espera', 'aria-labelledby': 'tiempos-b-titulo' },
      el('header', { class: 'tiempos-cabecera' },
        el('div', { class: 'tiempos-cabecera__texto' },
          el('h3', { class: 'tarjeta__titulo', id: 'tiempos-b-titulo' }, 'Espera de cada cliente'),
          el('p', { class: 'tiempos-bajada', html: 'Cada barra mide D<sub>i</sub>, el instante en que el cliente recibe su entrega, y muestra de qué está hecho: el viaje y la manipulación acumulados desde que el camión sale del depósito.' })),
        segmentado('Escala', [['total', 'Espera total'], ['manip', 'Solo manipulación']], 'total', cambiarModoB)),
      leyenda(COMPONENTES, { politicas: true }),
      marco,
      nota,
      pie);

    const maxD = Math.max(...paradas.map((p) => p.D));
    const maxManip = Math.max(...filas.map((fila) => fila.manip));
    const caracteres = Math.max(...filas.map((fila) => Math.max(
      `D${fila.parada.cliente} = ${fmt(fila.parada.D)}`.length,
      `${fmt(fila.manip, 3)} de ${fmt(fila.parada.D)}`.length)));
    return { tarjeta, lista, filas, marco, guias, eje, nota, proporcion, maxD, maxManip, caracteres };
  }

  function maquetarB(d = 0) {
    const anchoPista = B.filas[0].pista.clientWidth || 600;
    const tam = anchoPista < 420 ? 12 : 12.5;
    const minimo = 2; // ancho mínimo de cada componente de manipulación, para que no desaparezca
    const area = Math.max(60, anchoPista - (B.caracteres * 0.6 * tam + 16 + 4 * minimo));
    const total = st.modoB === 'total';
    const max = (total ? B.maxD : B.maxManip) || 1;
    const esc = (v) => (v / max) * area;
    const comps = total ? COMPONENTES : PARAMETROS;
    const aplicar = (nodo, props, i) => {
      if (d) gsap.to(nodo, { ...props, duration: d, ease: 'power3.inOut', delay: i * 0.03, overwrite: 'auto' });
      else gsap.set(nodo, { ...props, overwrite: 'auto' });
    };
    const ejecutar = () => {
      B.filas.forEach((f, i) => {
        const p = f.parada;
        const visibles = comps.filter((c) => p.espera[c] > EPS);
        const ultimo = visibles[visibles.length - 1];
        // Anchos: la manipulación nunca baja de `minimo`; en modo total lo cede el viaje,
        // así el largo de la barra sigue siendo D_i.
        const anchos = {};
        for (const c of visibles) anchos[c] = c === 'viaje' ? 0 : Math.max(minimo, esc(p.espera[c]));
        if (total && anchos.viaje != null) {
          const manip = PARAMETROS.reduce((s, c) => s + (anchos[c] ?? 0), 0);
          anchos.viaje = Math.max(0, esc(p.D) - manip);
        }
        let x = 0;
        for (const c of COMPONENTES) {
          const seg = f.segs[c];
          let props;
          if (anchos[c] == null) props = { left: x, width: 0, opacity: 0 };
          else {
            const w = anchos[c];
            const hueco = c !== ultimo && w > 4 ? 2 : 0;
            props = { left: x, width: Math.max(0, w - hueco), opacity: 1 };
            x += w;
          }
          seg.style.borderRadius = c === ultimo ? '0 4px 4px 0' : '0';
          aplicar(seg, props, i);
        }
        f.valor.innerHTML = total
          ? `D<sub>${p.cliente}</sub> = ${fmt(p.D)}`
          : `${fmt(f.manip, 3)} <span class="tiempos-fila__de">de ${fmt(p.D)}</span>`;
        aplicar(f.valor, { left: x + 8 }, i);
      });
      dibujarEjeB(max, area, d);
    };
    if (d) anim(ejecutar);
    else ejecutar();
    B.nota.innerHTML = total
      ? `Escala común: de 0 al mayor D<sub>i</sub> (${fmt(B.maxD)}). La manipulación es la franja de color al final de cada barra (con un mínimo de ${minimo} px por tiempo para que se vea); para leerla a su propia escala, elige «Solo manipulación».`
      : `Solo la manipulación acumulada hasta D<sub>i</sub>, a su propia escala (de 0 a ${fmt(B.maxManip, 3)}); el viaje queda fuera. A la derecha, la manipulación de cada cliente frente a su D<sub>i</sub>.`;
  }

  function dibujarEjeB(max, area, d) {
    const ticks = d3.ticks(0, max, area < 300 ? 3 : 5);
    const desplazamiento = B.filas[0].pista.getBoundingClientRect().left - B.marco.getBoundingClientRect().left;
    B.guias.style.left = `${desplazamiento}px`;
    B.guias.style.width = `${area}px`;
    B.guias.replaceChildren(...ticks.map((t) => el('span', { class: 'tiempos-guia-b', style: `left: ${(t / max) * area}px` })));
    B.eje.replaceChildren(...ticks.map((t) => el('span', { class: 'tiempos-eje-b__tick num', style: `left: ${desplazamiento + (t / max) * area}px` }, fmt(t, 3))));
    if (d) gsap.fromTo([B.guias, B.eje], { opacity: 0 }, { opacity: 1, duration: d, ease: 'power1.out' });
  }

  function cambiarModoB(modo) {
    st.modoB = modo;
    maquetarB(duracion(0.75));
  }

  // ==========================================================================
  // Resaltado compartido
  // ==========================================================================

  function marcarHover() {
    const c = st.hover;
    contenedor.classList.toggle('tiempos--hover', c != null);
    for (const b of A?.bloques ?? []) {
      const activo = b.parada.cliente === c;
      b.grupo.classList.toggle('es-activo', activo);
      b.alfiler.classList.toggle('es-activo', activo);
      b.tallo.classList.toggle('es-activo', activo);
    }
    for (const f of B.filas) f.nodo.classList.toggle('es-activo', f.parada.cliente === c);
    lupa.pildoras.forEach((b, k) => b.classList.toggle('tiempos-pildora--hover', paradas[k].cliente === c));
  }
}
