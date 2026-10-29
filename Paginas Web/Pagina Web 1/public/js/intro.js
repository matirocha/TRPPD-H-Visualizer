// Portada (#inicio) y "El problema" (#problema).
//
// Portada: de fondo se dibuja la ruta de la solución actual (DrawSVG) y un
// marcador la recorre (MotionPath). Luego, en bucle, los nodos se mueven a
// posiciones al azar y se traza y recorre un circuito tipo vendedor viajero
// (vecino más cercano + 2-opt). Al bajar hay paralaje (solo escritorio). La
// entrada del título (SplitText) ocurre una sola vez, fuera del contexto de render.
//
// El problema: tres ideas con una visual que se construye al entrar en pantalla.
//   1. La espera (Σ D_i): un retraso temprano empuja a todos los clientes siguientes.
//   2. Una sola puerta (Figura 1): para sacar una entrega hay que retirar las recogidas z.
//   3. Política 3 (Tabla 3): la secuencia de pasos bajo P1 y P2.
import { PARAM_HTML, conTooltip, el, fmt, movimientoReducido, ocultarTooltip, paramSVG, politicaCorta, svg } from './util.js';

const ESCRITORIO = '(min-width: 960px) and (prefers-reduced-motion: no-preference)';

let secuencia = 0;
const nuevoId = (base) => `intro-${base}-${++secuencia}`;
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));
const sumar = (lista) => lista.reduce((s, v) => s + v, 0);
// Valores muy pequeños (h = 0,1 da tasas de 0,05) conservan una cifra más.
const num = (v) => fmt(v, Math.abs(v) > 0 && Math.abs(v) < 0.1 ? 3 : 2);
const indiceArco = (a, b) => (a >= 10 || b >= 10 ? `${a},${b}` : `${a}${b}`);

/** KaTeX en línea; sin KaTeX, el texto plano. */
function tex(nodo, codigo, plano = codigo) {
  if (window.katex) {
    try {
      window.katex.render(codigo, nodo, { throwOnError: false });
      return nodo;
    } catch {
      /* se usa el texto plano */
    }
  }
  nodo.textContent = plano;
  return nodo;
}
const formula = (codigo, plano, clase = 'intro-tex') => tex(el('span', { class: clase }), codigo, plano);

/** Texto SVG con subíndice: D + ₁ */
const subSVG = (base, indice) => [base, svg('tspan', { class: 'sub', 'baseline-shift': 'sub', 'font-size': '70%' }, String(indice))];

/** Une nodos o textos en español: a, b y c */
function unir(partes) {
  const salida = [];
  partes.forEach((p, i) => {
    if (i > 0) salida.push(i === partes.length - 1 ? ' y ' : ', ');
    salida.push(p);
  });
  return salida;
}

function htmlCliente(p, n) {
  return `<div class="tt-titulo"><span class="cliente-chip intro-tt-chip${p.politica === 1 ? '' : ' cliente-chip--p2'}">${p.cliente}</span>Cliente ${p.cliente} · ${politicaCorta(p.politica)}</div>
    <div class="tt-fila"><span>Orden de visita</span><span>${p.k} de ${n}</span></div>
    <div class="tt-fila"><span>Entrega α<sub>i</sub> · recogida β<sub>i</sub></span><span>${fmt(p.alpha)} · ${fmt(p.beta)}</span></div>
    <div class="tt-sep"></div>
    <div class="tt-fila"><span>Llegada T<sub>i</sub></span><span>${num(p.T)}</span></div>
    <div class="tt-fila"><span>Entrega D<sub>i</sub></span><span>${num(p.D)}</span></div>
    <div class="tt-fila"><span>Salida F<sub>i</sub></span><span>${num(p.F)}</span></div>`;
}

function chipCliente(p, n, estado) {
  const chip = el('span', {
    class: `cliente-chip intro-chip${p.politica === 1 ? '' : ' cliente-chip--p2'}`,
    dataset: { cliente: p.cliente },
    onpointerenter: () => estado.set({ hover: p.cliente }),
    onpointerleave: () => estado.set({ hover: null }),
  }, String(p.cliente));
  conTooltip(chip, () => htmlCliente(p, n));
  return chip;
}

function nota(...contenido) {
  return el('p', { class: 'intro-nota' },
    el('span', { class: 'intro-nota__etiqueta' }, 'En esta solución'),
    el('span', { class: 'intro-nota__texto' }, ...contenido));
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

/** Curva cuadrática de a a b con una leve comba hacia la izquierda del avance. */
function curva(a, b, comba = 0.13) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const largoRecto = Math.hypot(dx, dy) || 1;
  const c = [(a[0] + b[0]) / 2 - (dy / largoRecto) * largoRecto * comba, (a[1] + b[1]) / 2 + (dx / largoRecto) * largoRecto * comba];
  const punto = (t) => {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  };
  const muestras = [a];
  let largo = 0;
  for (let i = 1; i <= 48; i++) {
    const p = punto(i / 48);
    largo += Math.hypot(p[0] - muestras[i - 1][0], p[1] - muestras[i - 1][1]);
    muestras.push(p);
  }
  const r = (v) => Math.round(v * 10) / 10;
  return { d: `M${r(a[0])},${r(a[1])} Q${r(c[0])},${r(c[1])} ${r(b[0])},${r(b[1])}`, largo, muestras };
}

/** Puntos equiespaciados a lo largo de las muestras de una curva. */
function puntosA(muestras, espaciado) {
  const puntos = [];
  let acumulado = 0;
  let siguiente = espaciado / 2;
  for (let i = 1; i < muestras.length; i++) {
    const [x0, y0] = muestras[i - 1];
    const [x1, y1] = muestras[i];
    const tramo = Math.hypot(x1 - x0, y1 - y0);
    while (siguiente <= acumulado + tramo) {
      const t = (siguiente - acumulado) / (tramo || 1);
      puntos.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      siguiente += espaciado;
    }
    acumulado += tramo;
  }
  return puntos;
}

/** Longitud "redonda" para la barra de escala. */
function escalaRedonda(objetivo) {
  const potencia = 10 ** Math.floor(Math.log10(objetivo || 1));
  const opciones = [1, 2, 2.5, 5, 10].map((f) => f * potencia);
  return opciones.filter((v) => v <= objetivo).pop() ?? potencia;
}

const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Posiciones al azar para los nodos `ids` dentro de [M + izq, W − M] × [M, H − M], con
 * una separación mínima que se relaja si no caben. `izq` aleja los nodos del título,
 * que en escritorio llega hasta el borde izquierdo del dibujo.
 */
function posicionesAlAzar(ids, W, H, M, r) {
  const izq = 0.14 * W;
  const ancho = W - 2 * M - izq;
  const area = ancho * (H - 2 * M);
  let minimo = Math.max(3.4 * r, 0.62 * Math.sqrt(area / ids.length));
  const puntos = [];
  for (let i = 0; i < ids.length; i++) {
    let punto = null;
    for (let intento = 0; !punto; intento++) {
      const p = [M + izq + Math.random() * ancho, M + Math.random() * (H - 2 * M)];
      if (puntos.every((q) => distancia(p, q) >= minimo)) punto = p;
      else if (intento % 120 === 119) minimo *= 0.9;
    }
    puntos.push(punto);
  }
  const pos = [];
  ids.forEach((id, i) => { pos[id] = puntos[i]; });
  return pos;
}

/**
 * Circuito tipo vendedor viajero que sale del depósito y vuelve a él: vecino más
 * cercano y luego 2-opt hasta que ningún cruce mejore. Devuelve [0, …, 0].
 */
function circuitoVendedor(ids, pos) {
  const d = (a, b) => distancia(pos[a], pos[b]);
  const pendientes = new Set(ids.filter((id) => id !== 0));
  const t = [0];
  while (pendientes.size) {
    const ultimo = t[t.length - 1];
    let mejor = null;
    for (const id of pendientes) if (mejor == null || d(ultimo, id) < d(ultimo, mejor)) mejor = id;
    t.push(mejor);
    pendientes.delete(mejor);
  }
  const m = t.length;
  for (let mejora = true; mejora;) {
    mejora = false;
    for (let i = 1; i < m - 1; i++) {
      for (let k = i + 1; k < m; k++) {
        const a = t[i - 1];
        const b = t[i];
        const c = t[k];
        const e = t[(k + 1) % m];
        if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 1e-6) {
          t.splice(i, k - i + 1, ...t.slice(i, k + 1).reverse());
          mejora = true;
        }
      }
    }
  }
  return [...t, 0];
}

function construirHero(sim, salida, estado) {
  const I = salida.instancia;
  const n = sim.n;
  const W = 1000;
  const H = 760;
  const M = 88;
  const crudos = I.coords.map(([x, y]) => [x, -y]); // norte arriba
  const xs = crudos.map((p) => p[0]);
  const ys = crudos.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const ancho = Math.max(...xs) - minX || 1;
  const alto = Math.max(...ys) - minY || 1;
  const k = Math.min((W - 2 * M) / ancho, (H - 2 * M) / alto);
  const ox = (W - ancho * k) / 2;
  const oy = (H - alto * k) / 2;
  const P = crudos.map(([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k]);
  const r = limitar(58 / Math.sqrt(n), 12, 24);
  const conEtiquetas = n <= 12;

  // Marco cartográfico: norte y barra de escala (unidades de la matriz c). Solo vale
  // para el primer circuito, el de la instancia.
  const largoEscala = escalaRedonda(Math.max(ancho, alto) * 0.2);
  const xe1 = W - 40;
  const xe0 = xe1 - largoEscala * k;
  const ye = H - 30;
  const marco = svg('g', { class: 'intro-hero__marco' },
    svg('g', { class: 'intro-hero__norte', transform: `translate(${W - 44}, 58)` },
      svg('path', { d: 'M0,-22 L7,6 L0,1 L-7,6 Z' }),
      svg('text', { x: 0, y: -30, 'text-anchor': 'middle' }, 'N')),
    svg('g', { class: 'intro-hero__escala' },
      svg('path', { d: `M${xe0},${ye - 6} V${ye} H${xe1} V${ye - 6}` }),
      svg('text', { x: (xe0 + xe1) / 2, y: ye - 12, 'text-anchor': 'middle' }, `${fmt(largoEscala)} u de viaje`)));

  const capaArcos = svg('g', { class: 'intro-hero__arcos' });
  const marcador = svg('g', { class: 'intro-hero__marcador' },
    svg('circle', { r: 15, class: 'intro-hero__halo' }),
    svg('circle', { r: 6.5, class: 'intro-hero__carro' }));

  // Cada nodo se dibuja centrado en (0, 0) y se mueve con su atributo transform
  // (translate + scale), que pinta() escribe desde el estado { x, y, s }.
  const nodos = new Map();
  const agregar = (id, grupo, rotulo, pulso) => {
    const [x, y] = P[id];
    const nodo = { id, grupo, rotulo, pulso, x, y, s: 1 };
    nodo.pintar = () => grupo.setAttribute('transform', `translate(${nodo.x.toFixed(1)} ${nodo.y.toFixed(1)}) scale(${nodo.s.toFixed(3)})`);
    nodo.pintar();
    nodos.set(id, nodo);
  };

  // Depósito
  const lado = r * 1.7;
  const deposito = svg('g', { class: 'intro-hero__deposito' },
    svg('rect', { x: -lado / 2, y: -lado / 2, width: lado, height: lado, rx: 3 }),
    svg('text', { x: 0, y: 0, dy: '0.36em', 'text-anchor': 'middle', 'font-size': r * 0.85 }, '0'),
    svg('text', { x: 0, y: lado / 2 + 22, 'text-anchor': 'middle', class: 'intro-hero__rotulo' }, 'depósito'));
  conTooltip(deposito, () => `<div class="tt-titulo">Depósito 0</div>
    <div class="tt-fila"><span>Sale con</span><span>${fmt(sim.cargaInicial.total)} de Q = ${fmt(sim.Q)}</span></div>
    <div class="tt-fila"><span>Regreso</span><span>${num(sim.regreso)}</span></div>`);
  agregar(0, deposito, null, null);

  // Clientes en orden de visita
  const grupos = sim.paradas.map((p) => {
    const politica = p.politica === 1 ? 'p1' : 'p2';
    const pulso = svg('circle', { cx: 0, cy: 0, r, class: `intro-hero__pulso intro-hero__pulso--${politica}` });
    const rotulo = conEtiquetas
      ? svg('text', { x: r + 9, y: -r * 0.35, class: 'intro-hero__rotulo' }, ...subSVG('D', p.cliente), ` ${num(p.D)}`)
      : null;
    const grupo = svg('g', {
      class: `intro-hero__nodo intro-hero__nodo--${politica}`,
      dataset: { cliente: p.cliente },
      onpointerenter: () => estado.set({ hover: p.cliente }),
      onpointerleave: () => estado.set({ hover: null }),
    },
      pulso,
      svg('circle', { cx: 0, cy: 0, r, class: 'intro-hero__anillo' }),
      svg('text', { x: 0, y: 0, dy: '0.36em', 'text-anchor': 'middle', 'font-size': r * 0.82, class: 'intro-hero__numero' }, String(p.cliente)),
      rotulo);
    conTooltip(grupo, () => htmlCliente(p, n));
    agregar(p.cliente, grupo, rotulo, pulso);
    return grupo;
  });

  const lienzo = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'intro-hero__svg', focusable: 'false', 'aria-hidden': 'true' },
    marco,
    capaArcos,
    marcador,
    deposito,
    svg('g', { class: 'intro-hero__nodos' }, grupos));

  const envoltura = el('div', { class: 'intro-hero' }, lienzo);
  const v = { envoltura, marco, capaArcos, marcador, nodos, W, H, M, r, rutaInstancia: sim.ruta, posInstancia: P, arcos: [] };
  v.trazar = (ruta, pos) => trazarCircuito(v, ruta, pos);
  v.trazar(sim.ruta, P);
  return v;
}

/** Arcos de un circuito: los tramos en tinta; el regreso al depósito, punteado. */
function trazarCircuito(v, ruta, pos) {
  v.capaArcos.replaceChildren();
  v.arcos = ruta.slice(0, -1).map((desde, i) => {
    const hasta = ruta[i + 1];
    const geo = curva(pos[desde], pos[hasta]);
    if (i < ruta.length - 2) {
      const trazo = svg('path', { d: geo.d, class: 'intro-hero__arco' });
      v.capaArcos.append(trazo);
      return { ...geo, hasta, regreso: false, trazo, guia: trazo, puntos: [] };
    }
    const guia = svg('path', { d: geo.d, class: 'intro-hero__guia' });
    const puntos = puntosA(geo.muestras, 13).map(([x, y]) => svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.3, class: 'intro-hero__punto' }));
    v.capaArcos.append(guia, ...puntos);
    return { ...geo, hasta, regreso: true, trazo: null, guia, puntos };
  });
}

/** Dibuja los arcos de v.arcos uno tras otro desde `t`; `alLlegar(arco, t)` al terminar cada uno. */
function dibujarArcos(tl, v, t, duracionTotal, alLlegar = null) {
  const total = sumar(v.arcos.map((a) => a.largo)) || 1;
  for (const arco of v.arcos) {
    const dur = (duracionTotal * arco.largo) / total;
    if (arco.regreso) {
      if (arco.puntos.length) tl.from(arco.puntos, { autoAlpha: 0, duration: 0.1, ease: 'none', stagger: dur / Math.max(1, arco.puntos.length) }, t);
    } else {
      tl.fromTo(arco.trazo, { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, ease: 'none' }, t);
    }
    t += dur;
    alLlegar?.(arco, t);
  }
  return t;
}

/** El marcador recorre el circuito una vez y hace latir a cada cliente al llegar. */
function recorrer(tl, v, t) {
  const total = sumar(v.arcos.map((a) => a.largo)) || 1;
  const velocidad = total / 9;
  tl.set(v.marcador, { autoAlpha: 1 }, t);
  for (const arco of v.arcos) {
    const dur = limitar(arco.largo / velocidad, 0.5, 3.2);
    tl.to(v.marcador, { motionPath: { path: arco.guia }, duration: dur, ease: 'sine.inOut' }, t);
    t += dur;
    const nodo = arco.regreso ? null : v.nodos.get(arco.hasta);
    if (nodo?.pulso) {
      tl.fromTo(nodo.pulso, { attr: { r: v.r }, autoAlpha: 0.75 }, { attr: { r: v.r * 2.1 }, autoAlpha: 0, duration: 0.9, ease: 'power2.out', immediateRender: false }, t - 0.05);
      t += 0.4;
    }
  }
  tl.to(v.marcador, { autoAlpha: 0, duration: 0.35 }, t);
  return t + 0.35;
}

/**
 * Portada en bucle: primero la ruta de la instancia; después, en cada vuelta, los
 * nodos se mueven a posiciones al azar, se traza un circuito tipo vendedor viajero
 * y el marcador lo recorre. Cada etapa es una timeline que crea la siguiente al
 * terminar, dentro del contexto (enCtx) para que destruir() la revierta.
 */
function animarHero(v, primera, seccionHero, enCtx) {
  if (movimientoReducido()) return; // la ruta de la instancia queda dibujada, sin marcador
  const nodos = [...v.nodos.values()];
  const ids = nodos.map((nd) => nd.id);
  const pintarTodos = () => nodos.forEach((nd) => nd.pintar());
  gsap.set(v.marcador, { autoAlpha: 0 });

  // El bucle solo corre con la portada en pantalla.
  let actual = null;
  const vigia = ScrollTrigger.create({
    trigger: seccionHero,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (st) => (st.isActive ? actual?.play() : actual?.pause()),
  });
  const etapa = (opciones = {}) => {
    actual = gsap.timeline({ ...opciones, paused: !vigia.isActive });
    return actual;
  };
  const despues = (fn) => () => enCtx(fn);

  // Recorre el circuito ya dibujado y pasa a la vuelta i + 1.
  const cerrar = (tl, t, i) => {
    t = recorrer(tl, v, t);
    tl.call(despues(() => mover(i + 1)), null, t + 1.2);
  };

  // Vuelta 0: entrada con la ruta de la instancia.
  const tl = gsap.timeline({ delay: primera ? 0.6 : 0.15 });
  actual = tl;
  const dep = v.nodos.get(0);
  tl.fromTo(dep, { s: 0.2 }, { s: 1, duration: 0.55, ease: 'back.out(2)', onUpdate: dep.pintar }, 0);
  tl.from(dep.grupo, { autoAlpha: 0, duration: 0.3 }, 0);
  tl.from(v.marco, { autoAlpha: 0, duration: 1 }, 0.3);
  const fin = dibujarArcos(tl, v, 0.3, 2.5, (arco, llegada) => {
    const nodo = arco.regreso ? null : v.nodos.get(arco.hasta);
    if (!nodo) return;
    tl.fromTo(nodo, { s: 0.2 }, { s: 1, duration: 0.5, ease: 'back.out(2.4)', onUpdate: nodo.pintar }, llegada - 0.08);
    tl.from(nodo.grupo, { autoAlpha: 0, duration: 0.25 }, llegada - 0.08);
  });
  cerrar(tl, fin + 0.3, 0);

  // Vuelta i ≥ 1: se borra el circuito y los nodos viajan a posiciones nuevas.
  function mover(i) {
    const pos = posicionesAlAzar(ids, v.W, v.H, v.M, v.r);
    const ruta = circuitoVendedor(ids, pos);
    const tl = etapa();
    tl.to(v.capaArcos, { autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, 0);
    // El marco y los D_i describen la instancia: no valen para los circuitos al azar.
    if (i === 1) tl.to([v.marco, ...nodos.map((nd) => nd.rotulo).filter(Boolean)], { autoAlpha: 0, duration: 0.5 }, 0);
    tl.to(nodos, {
      x: (j) => pos[nodos[j].id][0],
      y: (j) => pos[nodos[j].id][1],
      duration: 1.4,
      ease: 'power3.inOut',
      stagger: { amount: 0.25, from: 'random' },
      onUpdate: pintarTodos,
    }, 0.35);
    tl.call(despues(() => dibujar(i, ruta, pos)), null, '+=0.15');
  }

  // Traza el circuito nuevo, lo recorre y sigue con la próxima vuelta.
  function dibujar(i, ruta, pos) {
    v.trazar(ruta, pos);
    const tl = etapa();
    tl.set(v.capaArcos, { autoAlpha: 1 }, 0);
    cerrar(tl, dibujarArcos(tl, v, 0, 2.2) + 0.2, i);
  }
}

// ---------------------------------------------------------------------------
// Idea 1 · Importa la espera, no la distancia
// ---------------------------------------------------------------------------

// Esquema: cuatro clientes; tiempos ilustrativos (no son de la instancia).
const ESPERA = { viaje: [62, 46, 74, 54], descarga: [12, 9, 15, 11], carga: [9, 12, 8, 10], retraso: 30, regreso: 56 };

function ideaEspera(sim, contexto) {
  const { estado, enCtx, memoria, vistos } = contexto;
  const E = ESPERA;
  const R = E.viaje.length;
  const W = 560;
  const x0 = 58;
  const xFin = W - 26;
  const ejeY = 24;
  const fila0 = 56;
  const paso = 50;
  const alto = 20;
  const H = fila0 + (R - 1) * paso + alto + 30;
  const maximo = sumar(E.viaje) + sumar(E.descarga) + sumar(E.carga) + E.retraso + E.regreso;
  const esc = (xFin - x0) / maximo;
  const idRayado = nuevoId('rayado');
  const idTitulo = nuevoId('titulo');
  const idDesc = nuevoId('desc');

  const TIPOS = {
    viaje: (j) => `<div class="tt-titulo">Viaje al cliente ${j + 1}</div><div class="tt-fila"><span>c<sub>ij</sub></span><span>${E.viaje[j]}</span></div>`,
    descarga: (j) => `<div class="tt-titulo">Descarga de la entrega ${j + 1}</div><div class="tt-fila"><span>${PARAM_HTML.ua} α<sub>i</sub></span><span>${E.descarga[j]}</span></div><div class="tt-sep"></div>Al terminar: D<sub>${j + 1}</sub>`,
    carga: (j) => `<div class="tt-titulo">Carga de recogidas en ${j + 1}</div><div class="tt-fila"><span>${PARAM_HTML.lb}(Σ z + β<sub>i</sub>)</span><span>${E.carga[j]}</span></div>`,
    retraso: (j) => `<div class="tt-titulo">Retraso Δ en el cliente ${j + 1}</div>Por ejemplo, retirar recogidas junto a la puerta: ${PARAM_HTML.ub} Σ z<sub>ji</sub>.`,
    despues: () => `<div class="tt-titulo">Después de la última entrega</div>No pesa en Σ D<sub>i</sub>.`,
    regreso: () => `<div class="tt-titulo">Regreso al depósito</div>No pesa en Σ D<sub>i</sub>.`,
  };

  const lienzo = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'intro-espera__svg', role: 'img', 'aria-labelledby': `${idTitulo} ${idDesc}` },
    svg('title', { id: idTitulo }, 'Esquema de la espera de cuatro clientes'),
    svg('desc', { id: idDesc }, 'Cada fila es la espera D de un cliente, desde la salida del depósito hasta que termina su entrega. Un retraso en un cliente desplaza su espera y la de todos los clientes siguientes.'),
    svg('defs', {},
      svg('pattern', { id: idRayado, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svg('rect', { width: 6, height: 6, class: 'intro-espera__rayado-fondo' }),
        svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'intro-espera__rayado-linea' }))));

  // Eje del tiempo
  lienzo.append(
    svg('line', { x1: x0, x2: xFin, y1: ejeY, y2: ejeY, class: 'intro-espera__eje' }),
    svg('path', { d: `M${xFin - 6},${ejeY - 4} L${xFin},${ejeY} L${xFin - 6},${ejeY + 4}`, class: 'intro-espera__eje' }),
    svg('text', { x: x0, y: ejeY - 9, class: 'intro-espera__texto intro-espera__texto--suave' }, '0'),
    svg('text', { x: xFin, y: ejeY - 9, 'text-anchor': 'end', class: 'intro-espera__texto intro-espera__texto--suave' }, 'tiempo'),
    svg('text', { x: 27, y: ejeY + 4, 'text-anchor': 'middle', class: 'intro-espera__texto intro-espera__texto--rotulo' }, 'orden'));

  const banda = svg('rect', { x: x0, y: fila0, width: 0, height: 0, rx: 3, class: 'intro-espera__banda' });
  lienzo.append(banda);

  const filas = [];
  for (let r = 0; r < R; r++) {
    const y = fila0 + r * paso;
    const segs = [];
    for (let j = 0; j <= r; j++) {
      segs.push({ tipo: 'viaje', j, dur: E.viaje[j] });
      segs.push({ tipo: 'retraso', j, dur: E.retraso });
      segs.push({ tipo: 'descarga', j, dur: E.descarga[j], finD: j === r });
      if (j < r) segs.push({ tipo: 'carga', j, dur: E.carga[j] });
    }
    if (r === R - 1) {
      segs.push({ tipo: 'despues', j: r, dur: E.carga[r] });
      segs.push({ tipo: 'regreso', j: r, dur: E.regreso });
    }
    const idClip = nuevoId('clip');
    const recorte = svg('rect', { x: 0, y: y - 4, width: W, height: alto + 8 });
    const grupo = svg('g', { 'clip-path': `url(#${idClip})` });
    for (const seg of segs) {
      const esRegreso = seg.tipo === 'regreso';
      seg.nodo = svg('rect', {
        x: x0,
        y: esRegreso ? y + alto / 2 - 4 : y,
        width: 0,
        height: esRegreso ? 8 : alto,
        rx: esRegreso ? 4 : 2,
        class: `intro-espera__seg intro-espera__seg--${seg.tipo}`,
        style: seg.tipo === 'retraso' ? `fill: url(#${idRayado})` : null,
      });
      conTooltip(seg.nodo, () => TIPOS[seg.tipo](seg.j));
      grupo.append(seg.nodo);
    }
    const marca = svg('line', { x1: x0, x2: x0, y1: y - 5, y2: y + alto + 5, class: 'intro-espera__marca' });
    const etiqueta = svg('text', { x: x0, y: y - 8, 'text-anchor': 'end', class: 'intro-espera__texto intro-espera__texto--d' }, ...subSVG('D', r + 1));
    const mas = svg('text', { x: x0, y: y - 8, class: 'intro-espera__texto intro-espera__texto--mas' }, '+Δ');
    lienzo.append(
      svg('defs', {}, svg('clipPath', { id: idClip }, recorte)),
      svg('circle', { cx: 27, cy: y + alto / 2, r: 13, class: 'intro-espera__orden' }),
      svg('text', { x: 27, y: y + alto / 2, dy: '0.36em', 'text-anchor': 'middle', class: 'intro-espera__texto intro-espera__texto--orden' }, String(r + 1)),
      grupo, marca, etiqueta, mas);
    filas.push({ y, segs, recorte, marca, etiqueta, mas, fin: 0 });
  }
  const ultima = filas[R - 1];
  const noPesa = svg('text', { x: xFin, y: ultima.y + alto + 22, 'text-anchor': 'end', class: 'intro-espera__texto intro-espera__texto--suave intro-espera__texto--nopesa' },
    'después de ', ...subSVG('D', R), ': no pesa');
  lienzo.append(noPesa);

  const lectura = el('p', { class: 'intro-espera__lectura', 'aria-live': 'polite' });
  const opciones = [-1, ...E.viaje.map((_, j) => j)];
  const botones = opciones.map((m) => el('button', {
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': m < 0 ? 'Ninguno: sin retraso' : `Retraso en el cliente ${m + 1}`,
    onclick: () => {
      memoria.espera = m;
      memoria.esperaUsuario = true;
      enCtx(() => disponer(m, movimientoReducido() ? 0 : 0.85));
    },
  }, m < 0 ? 'Ninguno' : String(m + 1)));

  function ajustar(nodo, attr, duracion) {
    if (duracion) gsap.to(nodo, { attr, duration: duracion, ease: 'power3.inOut', overwrite: 'auto' });
    else gsap.set(nodo, { attr });
  }

  function disponer(m, duracion) {
    let inicioRetraso = 0;
    filas.forEach((fila, r) => {
      let t = 0;
      for (const seg of fila.segs) {
        const dur = seg.tipo === 'retraso' ? (seg.j === m ? E.retraso : 0) : seg.dur;
        if (seg.tipo === 'retraso' && seg.j === m && r === m) inicioRetraso = t;
        ajustar(seg.nodo, { x: x0 + t * esc, width: dur * esc }, duracion);
        t += dur;
        if (seg.finD) fila.fin = t;
      }
      const xD = x0 + fila.fin * esc;
      ajustar(fila.marca, { x1: xD, x2: xD }, duracion);
      ajustar(fila.etiqueta, { x: xD - 3 }, duracion);
      ajustar(fila.mas, { x: xD + 3 }, duracion);
      const visible = m >= 0 && r >= m ? 1 : 0;
      if (duracion) gsap.to(fila.mas, { autoAlpha: visible, duration: duracion * 0.6, delay: visible ? duracion * 0.5 : 0, overwrite: 'auto' });
      else gsap.set(fila.mas, { autoAlpha: visible });
    });
    if (m >= 0) {
      const yBanda = filas[m].y - 13;
      ajustar(banda, { x: x0 + inicioRetraso * esc, width: E.retraso * esc, y: yBanda, height: filas[R - 1].y + alto + 6 - yBanda }, duracion);
    }
    if (duracion) gsap.to(banda, { autoAlpha: m >= 0 ? 1 : 0, duration: duracion * 0.6, overwrite: 'auto' });
    else gsap.set(banda, { autoAlpha: m >= 0 ? 1 : 0 });

    botones.forEach((b, i) => b.setAttribute('aria-pressed', String(opciones[i] === m)));
    const afectados = R - m;
    lectura.innerHTML = m < 0
      ? 'Sin retrasos. Elige en qué cliente ocurre un retraso Δ para ver cuántas esperas empuja.'
      : `Un retraso Δ en el cliente ${m + 1} de la ruta empuja ${afectados === 1 ? 'solo su propia espera' : `su espera y la de los ${afectados - 1} siguientes`}: Σ D<sub>i</sub> crece <strong class="num">${afectados === 1 ? 'Δ' : `${afectados}Δ`}</strong>.`;
  }

  const leyenda = el('ul', { class: 'intro-leyenda' },
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--viaje)' } }), el('span', { html: 'viaje c<sub>ij</sub>' })),
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--op-ua)' } }), el('span', { html: `descarga ${PARAM_HTML.ua} α<sub>i</sub>` })),
    el('li', {}, el('span', { class: 'muestra intro-muestra--rayado' }), el('span', { html: `retraso Δ, p. ej. ${PARAM_HTML.ub} Σ z<sub>ji</sub>` })),
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--op-lb)' } }), el('span', { html: `carga ${PARAM_HTML.lb}(Σ z + β)` })));

  const figura = el('figure', { class: 'tarjeta intro-panel intro-espera' },
    el('div', { class: 'intro-panel__cabecera' },
      el('h4', { class: 'tarjeta__titulo intro-panel__titulo' }, 'Cuatro clientes, una línea de tiempo'),
      el('div', { class: 'intro-control' },
        el('span', { class: 'intro-control__etiqueta', 'aria-hidden': 'true' }, 'Retraso Δ en el cliente'),
        el('div', { class: 'segmentado intro-segmentado', role: 'group', 'aria-label': 'Cliente donde ocurre el retraso' }, botones))),
    lienzo,
    el('figcaption', { class: 'intro-panel__pie' }, lectura, leyenda));

  // Dato real: cuánto pesa cada tramo según los clientes que retrasa.
  const n = sim.n;
  const tramos = sim.arcos.filter((a) => !a.regreso);
  const pesoViaje = sumar(tramos.map((a, k) => a.c * (n - k)));
  const manipulacion = sim.objetivo - pesoViaje;
  const primero = tramos[0];
  const regreso = sim.arcos[sim.arcos.length - 1];
  const notaNodo = nota(
    'El primer tramo, ', el('span', { class: 'num' }, `${primero.desde} → ${primero.hasta}`), ' (',
    el('span', { html: `c<sub>${indiceArco(primero.desde, primero.hasta)}</sub>` }), ' = ', el('span', { class: 'num' }, num(primero.c)),
    `), se cuenta ${n} ${n === 1 ? 'vez' : 'veces'}. De Σ D`, el('sub', {}, 'i'), ' = ', el('strong', { class: 'num' }, num(sim.objetivo)),
    ', el viaje aporta ', el('span', { class: 'num' }, num(pesoViaje)), ' y la manipulación ', el('span', { class: 'num' }, num(manipulacion)),
    '; el regreso ', el('span', { class: 'num' }, `${regreso.desde} → 0`), ' (c = ', el('span', { class: 'num' }, num(regreso.c)), ') no suma.');

  const texto = el('div', { class: 'intro-idea__texto' },
    el('span', { class: 'intro-idea__numero', 'aria-hidden': 'true' }, '01'),
    el('h3', { class: 'intro-idea__titulo' }, 'Importa la espera, no la distancia'),
    el('p', { html: 'El objetivo no es recorrer menos, sino que los clientes esperen menos: se minimiza la suma de los instantes D<sub>i</sub> en que cada uno termina de recibir su entrega. Es la lógica del <em>Traveling Repairman</em>: cada cliente cuenta su espera desde que el camión sale del depósito.' }),
    el('p', { html: 'Por eso cada tiempo de viaje y de manipulación se multiplica por el número de clientes que retrasa: un minuto perdido al comienzo lo sufren todos, uno al final casi nadie. El regreso al depósito y lo que ocurre después de la última entrega no pesan.' }),
    el('div', { class: 'intro-formulas' },
      el('div', { class: 'intro-formula' }, formula(String.raw`\min \sum_{i \in V_c} D_i`, 'min Σ D_i')),
      el('div', { class: 'intro-formula' },
        formula(String.raw`D_i = T_i + u_b \sum_{j} z_{ji} + u_a\,\alpha_i`, 'D_i = T_i + u_b Σ z_ji + u_a α_i'),
        el('span', { class: 'intro-formula__pie', html: 'llegada · retirar las recogidas junto a la puerta · descargar la entrega' }))),
    notaNodo);

  const idea = el('article', { class: 'intro-idea', 'aria-label': 'Idea 1: importa la espera, no la distancia' }, texto, figura);

  function animar() {
    const recortes = filas.map((f) => f.recorte);
    const etiquetas = [...filas.flatMap((f) => [f.etiqueta, f.marca]), noPesa];
    if (movimientoReducido() || vistos.has('espera')) {
      disponer(memoria.espera ?? 0, 0);
      return;
    }
    disponer(-1, 0);
    gsap.set(recortes, { attr: { width: 0 } });
    gsap.set(etiquetas, { autoAlpha: 0 });
    const tl = gsap.timeline({
      scrollTrigger: { trigger: figura, start: 'top 75%', once: true },
      onStart: () => vistos.add('espera'),
    });
    tl.to(recortes, { attr: { width: W }, duration: 1.1, ease: 'power2.out', stagger: 0.22 })
      .to(etiquetas, { autoAlpha: 1, duration: 0.35, stagger: 0.11 }, 0.7)
      .call(() => {
        if (!memoria.esperaUsuario) {
          memoria.espera = 0;
          enCtx(() => disponer(0, 0.9));
        }
      }, null, '+=0.45');
  }

  return { nodo: idea, animar };
}

// ---------------------------------------------------------------------------
// Idea 2 · Una sola puerta (Figura 1)
// ---------------------------------------------------------------------------

const PUERTA = (() => {
  const caja = { x: 80, y: 44, w: 280, h: 110 };
  const piso = 184;
  const altoBloque = 98;
  const yBloque = caja.y + 6;
  const ySuelo = piso - altoBloque;
  const bloques = {
    w: { x: 86, w: 56, tipo: 'w', letra: 'w', cajas: 3 },
    y2: { x: 146, w: 40, tipo: 'y', letra: 'i+2', cajas: 2 },
    y1: { x: 189, w: 40, tipo: 'y', letra: 'i+1', cajas: 2 },
    y0: { x: 232, w: 40, tipo: 'y', letra: 'i', cajas: 2 },
    z: { x: 276, w: 78, tipo: 'z', letra: 'z', cajas: 4 },
  };
  const beta = { x: 518, w: 30, tipo: 'beta', letra: 'β', cajas: 1 };
  const bisagra = `${caja.x + caja.w} ${caja.y}`;
  const dy = ySuelo - yBloque;
  // Desplazamientos (dx, dy) de cada bloque móvil en los cuatro momentos.
  const estados = [
    { z: [0, 0], y0: [0, 0], beta: [0, 0], puerta: 0, op: null },
    { z: [102, dy], y0: [0, 0], beta: [0, 0], puerta: -84, op: { param: 'ub', x: 417, texto: ' · Σ z' } },
    { z: [102, dy], y0: [234, dy], beta: [0, 0], puerta: -84, op: { param: 'ua', x: 486, texto: ' · α → D' } },
    { z: [232 - 276, 0], y0: [234, dy], beta: [314 - 518, yBloque - ySuelo], puerta: 0, op: { param: 'lb', x: 430, texto: ' · (Σ z + β)' } },
  ];
  return { caja, piso, altoBloque, yBloque, ySuelo, bloques, beta, bisagra, estados, W: 560, H: 236 };
})();

const PUERTA_TEXTO = [
  { titulo: 'Llegada al cliente i', html: 'La entrega de <em>i</em> quedó junto a la puerta, pero delante tiene las recogidas <strong>z</strong> de clientes anteriores que usaron P1.' },
  { titulo: 'Paso 1 · Retirar las recogidas junto a la puerta', tex: String.raw`u_b \sum_j z_{ji}`, plano: 'u_b Σ z_ji', html: 'Todavía no se entrega nada: este tiempo retrasa a <em>i</em> y a todos los que siguen.' },
  { titulo: 'Paso 2 · Descargar la entrega de i', tex: String.raw`u_a\,\alpha_i`, plano: 'u_a α_i', html: 'Al terminar, el cliente queda atendido: ese instante es D<sub>i</sub>.' },
  { titulo: 'Paso 4 · Cargar recogidas retiradas y nuevas', tex: String.raw`\ell_b\left(\sum_j z_{ji} + \beta_i\right)`, plano: 'ℓ_b (Σ z_ji + β_i)', html: 'Con P1 vuelven junto a la puerta y estorbarán en la próxima parada. Este tiempo ya solo retrasa a los siguientes.' },
];

function ideaPuerta(sim, contexto) {
  const { estado, enCtx, memoria, vistos } = contexto;
  const G = PUERTA;
  const { caja } = G;
  const idTitulo = nuevoId('titulo');
  const idDesc = nuevoId('desc');

  const bloque = (def, y) => {
    const g = svg('g', { class: `intro-puerta__bloque intro-puerta__bloque--${def.tipo}` });
    g.append(svg('rect', { x: def.x, y, width: def.w, height: G.altoBloque, rx: 4, class: 'intro-puerta__caja' }));
    for (let c = 1; c < def.cajas; c++) {
      const xc = def.x + (def.w * c) / def.cajas;
      g.append(svg('line', { x1: xc, x2: xc, y1: y + 5, y2: y + G.altoBloque - 5, class: 'intro-puerta__junta' }));
    }
    g.append(svg('line', { x1: def.x + 5, x2: def.x + def.w - 5, y1: y + G.altoBloque / 2, y2: y + G.altoBloque / 2, class: 'intro-puerta__junta' }));
    const esLetra = def.tipo !== 'y';
    g.append(svg('text', {
      x: def.x + def.w / 2,
      y: y + G.altoBloque / 2,
      dy: '0.35em',
      'text-anchor': 'middle',
      class: esLetra ? 'intro-puerta__letra' : 'intro-puerta__destino',
    }, def.tipo === 'beta' ? subSVG('β', 'i') : def.letra));
    return g;
  };

  const nodosBloque = Object.fromEntries(Object.entries(G.bloques).map(([clave, def]) => [clave, bloque(def, G.yBloque)]));
  const nodoBeta = bloque(G.beta, G.ySuelo);

  const puerta = svg('line', { x1: caja.x + caja.w, x2: caja.x + caja.w, y1: caja.y, y2: caja.y + caja.h, class: 'intro-puerta__hoja' });
  const op = svg('text', { x: 0, y: G.ySuelo - 10, 'text-anchor': 'middle', class: 'intro-puerta__op' });
  // Etiqueta de la operación: texto en tinta (legible) y una muestra con el color del parámetro.
  const ponerOp = (destino) => {
    op.replaceChildren(...(destino.op
      ? [svg('tspan', { class: `intro-puerta__op-muestra intro-puerta__op-muestra--${destino.op.param}` }, '■ '), ...paramSVG(destino.op.param), destino.op.texto]
      : []));
    if (destino.op) op.setAttribute('x', destino.op.x);
  };

  const rotulo = (x0, x1, lineas, tipo) => {
    const yb = G.piso + 12;
    return svg('g', { class: `intro-puerta__rotulo intro-puerta__rotulo--${tipo}` },
      svg('path', { d: `M${x0},${yb - 4} V${yb} H${x1} V${yb - 4}` }),
      svg('text', { x: (x0 + x1) / 2, y: yb + 15, 'text-anchor': 'middle' },
        svg('tspan', { x: (x0 + x1) / 2, class: 'intro-puerta__rotulo-letra' }, lineas[0]),
        svg('tspan', { x: (x0 + x1) / 2, dy: '1.25em' }, lineas[1])));
  };
  const B = G.bloques;
  const rotulos = [
    rotulo(B.w.x, B.w.x + B.w.w, ['w', 'recogidas al fondo'], 'w'),
    rotulo(B.y2.x, B.y0.x + B.y0.w, ['y', 'entregas pendientes'], 'y'),
    rotulo(B.z.x, B.z.x + B.z.w, ['z', 'recogidas junto a la puerta'], 'z'),
  ];

  const xCliente = G.beta.x + G.beta.w / 2 - 22;
  const cliente = svg('g', { class: 'intro-puerta__cliente' },
    svg('path', { d: `M${xCliente},${G.piso} V${G.ySuelo - 52}` }),
    svg('path', { d: `M${xCliente},${G.ySuelo - 52} h22 l-6,7 l6,7 h-22 Z`, class: 'intro-puerta__bandera' }),
    // Anclado a la derecha de la bandera: en móvil (texto más grande) no se sale del dibujo.
    svg('text', { x: xCliente + 26, y: G.ySuelo - 60, 'text-anchor': 'end' }, 'cliente ', svg('tspan', { 'font-style': 'italic' }, 'i')));

  const lienzo = svg('svg', { viewBox: `0 0 ${G.W} ${G.H}`, class: 'intro-puerta__svg', role: 'img', 'aria-labelledby': `${idTitulo} ${idDesc}` },
    svg('title', { id: idTitulo }, 'Figura 1: la carga dentro del camión'),
    svg('desc', { id: idDesc }, 'Caja del camión desde el frente F hasta la puerta trasera R: recogidas al fondo (w), entregas pendientes (y, la del próximo cliente junto a la puerta) y recogidas junto a la puerta (z). Para sacar la entrega del cliente hay que retirar antes las recogidas z.'),
    svg('line', { x1: 4, x2: G.W - 4, y1: G.piso, y2: G.piso, class: 'intro-puerta__suelo' }),
    // Cabina y chasis
    svg('path', { d: `M76,${caja.y + 34} H44 Q32,${caja.y + 34} 26,${caja.y + 48} L16,${caja.y + 74} Q13,${caja.y + 80} 13,${caja.y + 88} V${caja.y + caja.h + 4} H76 Z`, class: 'intro-puerta__cabina' }),
    svg('path', { d: `M70,${caja.y + 42} H46 Q40,${caja.y + 42} 37,${caja.y + 49} L30,${caja.y + 66} H70 Z`, class: 'intro-puerta__ventana' }),
    svg('line', { x1: 12, x2: caja.x + caja.w + 8, y1: caja.y + caja.h + 4, y2: caja.y + caja.h + 4, class: 'intro-puerta__chasis' }),
    [44, 120, 322].map((cx) => svg('g', { class: 'intro-puerta__rueda' },
      svg('circle', { cx, cy: G.piso - 13, r: 13 }),
      svg('circle', { cx, cy: G.piso - 13, r: 4.5, class: 'intro-puerta__buje' }))),
    svg('rect', { x: caja.x, y: caja.y, width: caja.w, height: caja.h, rx: 4, class: 'intro-puerta__carroceria' }),
    // Frente y puerta
    svg('text', { x: caja.x + 4, y: caja.y - 12, class: 'intro-puerta__extremo' }, 'F', svg('tspan', { class: 'intro-puerta__extremo-texto', dx: 6 }, 'frente')),
    svg('text', { x: caja.x + caja.w - 2, y: caja.y - 12, 'text-anchor': 'end', class: 'intro-puerta__extremo' }, svg('tspan', { class: 'intro-puerta__extremo-texto', dx: -6 }, 'puerta '), 'R'),
    cliente,
    Object.values(nodosBloque),
    nodoBeta,
    puerta,
    op,
    rotulos);

  // Leyenda en HTML (en pantallas angostas reemplaza los rótulos del dibujo).
  const leyenda = el('ul', { class: 'intro-leyenda' },
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--b-fondo)' } }), el('span', { html: '<strong>w</strong> · recogidas (b) al fondo' })),
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--a)' } }), el('span', { html: '<strong>y</strong> · entregas (a) pendientes' })),
    el('li', {}, el('span', { class: 'muestra', style: { '--color': 'var(--b-puerta)' } }), el('span', { html: '<strong>z</strong> · recogidas (b) junto a la puerta' })));

  const tituloPaso = el('p', { class: 'intro-puerta__paso' });
  const formulaPaso = el('span', { class: 'intro-puerta__formula' });
  const textoPaso = el('p', { class: 'intro-puerta__texto' });
  const indicador = el('span', { class: 'intro-puerta__indicador num', 'aria-hidden': 'true' });
  const anterior = el('button', { type: 'button', class: 'boton boton--icono', 'aria-label': 'Momento anterior', onclick: () => manual(actual - 1) }, '←');
  const siguiente = el('button', { type: 'button', class: 'boton boton--icono', 'aria-label': 'Momento siguiente', onclick: () => manual(actual + 1) }, '→');
  const repetir = el('button', { type: 'button', class: 'boton intro-puerta__repetir', onclick: () => enCtx(() => reproducir(true)) }, '↺ Repetir');

  let actual = 0;
  let transicion = null;
  let auto = null;

  function mover(tl, nodo, [dx, dy], dur, pos) {
    const yActual = gsap.getProperty(nodo, 'y');
    const subir = dy < yActual; // entra al camión: primero sube y luego avanza
    const primero = subir ? { y: dy } : { x: dx };
    const segundo = subir ? { x: dx } : { y: dy };
    tl.to(nodo, { ...primero, duration: dur * 0.55, ease: 'power2.inOut', overwrite: 'auto' }, pos)
      .to(nodo, { ...segundo, duration: dur * 0.45, ease: 'power2.inOut' }, '>');
  }

  function irA(s, animar = true) {
    s = limitar(s, 0, G.estados.length - 1);
    const destino = G.estados[s];
    const abre = destino.puerta !== 0;
    const dur = animar && !movimientoReducido() ? 1 : 0;
    actual = s;
    memoria.puerta = s;
    transicion?.kill();

    if (!dur) {
      gsap.set(puerta, { rotation: destino.puerta, svgOrigin: G.bisagra });
      for (const clave of ['z', 'y0', 'beta']) {
        const nodo = clave === 'beta' ? nodoBeta : nodosBloque[clave];
        gsap.set(nodo, { x: destino[clave][0], y: destino[clave][1] });
      }
      gsap.set(nodosBloque.y0, { autoAlpha: s === 3 ? 0.45 : 1 });
      gsap.set(rotulos, { autoAlpha: s === 0 ? 1 : 0 });
      gsap.set(op, { autoAlpha: destino.op ? 1 : 0 });
      ponerOp(destino);
    } else {
      const tl = gsap.timeline();
      transicion = tl;
      if (abre) tl.to(puerta, { rotation: destino.puerta, svgOrigin: G.bisagra, duration: 0.45, ease: 'power2.out', overwrite: 'auto' }, 0);
      const inicio = abre ? 0.3 : 0;
      tl.to(rotulos, { autoAlpha: s === 0 ? 1 : 0, duration: 0.3, overwrite: 'auto' }, 0);
      tl.to(op, { autoAlpha: 0, duration: 0.15, overwrite: 'auto' }, 0);
      // El texto cambia cuando la etiqueta anterior ya se ocultó (antes saltaba de golpe).
      tl.call(() => ponerOp(destino), null, 0.15);
      mover(tl, nodosBloque.z, destino.z, dur, inicio);
      mover(tl, nodosBloque.y0, destino.y0, dur, inicio + (s === 2 ? 0 : 0.1));
      mover(tl, nodoBeta, destino.beta, dur, inicio + 0.25);
      tl.to(nodosBloque.y0, { autoAlpha: s === 3 ? 0.45 : 1, duration: 0.4, overwrite: 'auto' }, inicio + 0.5);
      // La puerta se cierra cuando todos los bloques ya terminaron de moverse.
      if (!abre) tl.to(puerta, { rotation: 0, svgOrigin: G.bisagra, duration: 0.45, ease: 'power2.inOut', overwrite: 'auto' }, inicio + 0.25 + dur);
      if (destino.op) tl.to(op, { autoAlpha: 1, duration: 0.3 }, inicio + 0.45);
    }

    // Leyenda del momento.
    const info = PUERTA_TEXTO[s];
    tituloPaso.textContent = info.titulo;
    formulaPaso.replaceChildren();
    if (info.tex) tex(formulaPaso, info.tex, info.plano);
    formulaPaso.hidden = !info.tex;
    textoPaso.innerHTML = info.html;
    indicador.textContent = `${s + 1} / ${G.estados.length}`;
    anterior.disabled = s === 0;
    siguiente.disabled = s === G.estados.length - 1;
  }

  function manual(s) {
    memoria.puertaUsuario = true;
    auto?.kill();
    auto = null;
    enCtx(() => irA(s, true));
  }

  function reproducir(desdeCero) {
    if (!desdeCero && memoria.puertaUsuario) return; // no pisar lo que eligió el usuario
    auto?.kill();
    if (movimientoReducido()) {
      irA(0, false);
      return;
    }
    if (desdeCero) irA(0, true);
    auto = gsap.timeline({ delay: desdeCero ? 1.3 : 0.4 });
    auto.call(() => enCtx(() => irA(1)), null, 0)
      .call(() => enCtx(() => irA(2)), null, 2.3)
      .call(() => enCtx(() => irA(3)), null, 4.6);
  }

  const figura = el('figure', { class: 'tarjeta intro-panel intro-puerta' },
    el('div', { class: 'intro-panel__cabecera' },
      // .tarjeta__titulo va en mayúsculas: las letras de la mercancía (a, b) conservan su caja.
      el('h4', { class: 'tarjeta__titulo intro-panel__titulo' }, 'Figura 1 · Patrón ', el('span', { class: 'intro-math' }, '(F, b…b, a…a, b…b, R)')),
      el('div', { class: 'intro-puerta__controles' }, anterior, indicador, siguiente, repetir)),
    lienzo,
    el('figcaption', { class: 'intro-panel__pie intro-puerta__pie' },
      el('div', { class: 'intro-puerta__momento', 'aria-live': 'polite' }, tituloPaso, formulaPaso, textoPaso),
      leyenda));

  // Dato real: carga inicial y la entrega más tapada por recogidas.
  const n = sim.n;
  const ordenInicial = sim.arcos[0].pila.filter((b) => b.tipo === 'y').map((b) => sim.porCliente.get(b.cliente)).filter(Boolean);
  const chips = (lista) => lista.map((p) => chipCliente(p, n, estado));
  const mostrarOrden = ordenInicial.length <= 8
    ? unir(chips(ordenInicial))
    : [...chips(ordenInicial.slice(0, 3)).flatMap((c) => [c, ', ']), '…, ', ...unir(chips(ordenInicial.slice(-2)))];
  const tapada = sim.paradas.filter((p) => p.alpha > 0 && p.zEntrada > 0).sort((a, b) => b.zEntrada - a.zEntrada)[0];
  const partesTapada = tapada
    ? [' En el cliente ', chipCliente(tapada, n, estado), ` primero ${tapada.zEntrada === 1 ? 'baja 1 recogida' : `bajan ${fmt(tapada.zEntrada)} recogidas`}: `,
      el('span', { html: PARAM_HTML.ub }), ' × ', el('span', { class: 'num' }, fmt(tapada.zEntrada)), ' = ', el('strong', { class: 'num' }, num(tapada.ops[0]?.duracion ?? tapada.tasa.ub * tapada.zEntrada)), '.']
    : [' Ninguna entrega queda tapada por recogidas en esta ruta.'];
  const notaNodo = nota(
    'El camión sale con ', el('span', { class: 'num' }, fmt(sim.cargaInicial.total)), ' de Q = ', el('span', { class: 'num' }, fmt(sim.Q)),
    ` unidades, apiladas del frente a la puerta para ${ordenInicial.length === 1 ? 'el cliente' : 'los clientes'} `, ...mostrarOrden, '.', ...partesTapada);

  const texto = el('div', { class: 'intro-idea__texto' },
    el('span', { class: 'intro-idea__numero', 'aria-hidden': 'true' }, '02'),
    el('h3', { class: 'intro-idea__titulo' }, 'Una sola puerta: último en entrar, primero en salir'),
    el('p', { html: 'El camión se carga y descarga solo por la puerta trasera R. La carga mantiene siempre el patrón de la Figura 1: desde el frente F, recogidas al fondo (<strong>w</strong>), entregas pendientes (<strong>y</strong>) y recogidas junto a la puerta (<strong>z</strong>).' }),
    el('p', { html: 'Las entregas se cargan en el depósito en orden inverso a la ruta, así la del próximo cliente queda junto a la puerta. La mercancía <em>a</em> se entrega; la <em>b</em> se recoge y vuelve al depósito. Si hay recogidas delante de la puerta, hay que bajarlas antes de descargar y subirlas después.' }),
    notaNodo);

  const idea = el('article', { class: 'intro-idea intro-idea--invertida', 'aria-label': 'Idea 2: una sola puerta' }, texto, figura);

  function animar() {
    if (movimientoReducido() || vistos.has('puerta')) {
      irA(memoria.puerta ?? 0, false);
      return;
    }
    irA(0, false);
    const entran = [nodosBloque.w, nodosBloque.y2, nodosBloque.y1, nodosBloque.y0, nodosBloque.z];
    const tl = gsap.timeline({
      scrollTrigger: { trigger: figura, start: 'top 72%', once: true },
      onStart: () => vistos.add('puerta'),
    });
    // La puerta se cierra cuando el último bloque (z) ya entró; antes se cerraba encima de él.
    const finEntrada = 0.05 + 0.14 * (entran.length - 1) + 0.75;
    tl.fromTo(puerta, { rotation: -84, svgOrigin: G.bisagra }, { rotation: -84, svgOrigin: G.bisagra, duration: 0.01 }, 0)
      .from(entran, { x: '+=250', autoAlpha: 0, duration: 0.75, ease: 'power3.out', stagger: 0.14 }, 0.05)
      .from([cliente, nodoBeta], { autoAlpha: 0, duration: 0.5 }, 0.4)
      .to(puerta, { rotation: 0, svgOrigin: G.bisagra, duration: 0.5, ease: 'power2.inOut' }, finEntrada - 0.1)
      .from(rotulos, { autoAlpha: 0, y: 6, duration: 0.45, stagger: 0.12 }, '<')
      // Dentro del contexto: así destruir() también mata la secuencia automática.
      .call(() => enCtx(() => reproducir(false)), null, '+=0.6');
  }

  function destruir() {
    auto?.kill();
    auto = null;
    transicion?.kill();
    transicion = null;
  }

  return { nodo: idea, animar, destruir };
}

// ---------------------------------------------------------------------------
// Idea 3 · Política 3 (Tabla 3)
// ---------------------------------------------------------------------------

const PASOS_TABLA = [
  {
    paso: 1,
    p1: { texto: 'Retirar las recogidas junto a la puerta', tex: String.raw`u_b \sum_j z_{ji}`, plano: 'u_b Σ z_ji' },
    p2: { texto: 'Retirar las recogidas junto a la puerta', tex: String.raw`u_b \sum_j z_{ji}`, plano: 'u_b Σ z_ji' },
  },
  {
    paso: 2,
    p1: { texto: 'Descargar la entrega del cliente', tex: String.raw`u_a\,\alpha_i`, plano: 'u_a α_i' },
    p2: { texto: 'Descargar la entrega del cliente', tex: String.raw`u_a\,\alpha_i`, plano: 'u_a α_i' },
  },
  { hito: 'D' },
  {
    paso: 3,
    p1: null,
    p2: { texto: 'Retirar las entregas que continúan a bordo', tex: String.raw`u_a \sum_j y_{ij}`, plano: 'u_a Σ y_ij', solo: true },
  },
  {
    paso: 4,
    p1: { texto: 'Cargar recogidas retiradas y nuevas junto a la puerta', tex: String.raw`\ell_b\left(\sum_j z_{ji} + \beta_i\right)`, plano: 'ℓ_b (Σ z_ji + β_i)' },
    p2: { texto: 'Cargar recogidas retiradas y nuevas al fondo', tex: String.raw`\ell_b\left(\sum_j z_{ji} + \beta_i\right)`, plano: 'ℓ_b (Σ z_ji + β_i)' },
  },
  {
    paso: 5,
    p1: null,
    p2: { texto: 'Recargar las entregas', tex: String.raw`\ell_a \sum_j y_{ij}`, plano: 'ℓ_a Σ y_ij', solo: true },
  },
  { hito: 'F' },
];

function mini(destino) {
  // Patrón de la carga al salir: P1 deja las recogidas en z; P2, en w.
  return el('span', { class: 'intro-mini', 'aria-hidden': 'true' },
    el('span', { class: 'intro-mini__extremo' }, 'F'),
    el('span', { class: `intro-mini__b intro-mini__b--w${destino === 'w' ? ' intro-mini__b--destino' : ''}` }),
    el('span', { class: 'intro-mini__b intro-mini__b--y' }),
    el('span', { class: `intro-mini__b intro-mini__b--z${destino === 'z' ? ' intro-mini__b--destino' : ' intro-mini__b--vacio'}` }),
    el('span', { class: 'intro-mini__extremo' }, 'R'));
}

function ideaPolitica(sim, contexto) {
  const { estado, vistos } = contexto;
  const n = sim.n;
  const p1 = sim.paradas.filter((p) => p.politica === 1);
  const p2 = sim.paradas.filter((p) => p.politica === 0);

  const cabecera = (pol, lista) => {
    const esP1 = pol === 1;
    return el('th', { scope: 'col', class: `intro-tabla__cabeza intro-tabla__cabeza--p${esP1 ? 1 : 2}` },
      el('span', { class: 'intro-tabla__cabeza-fila' },
        el('span', { class: `politica-chip politica-chip--p${esP1 ? 1 : 2}` }, esP1 ? 'P1' : 'P2'),
        el('span', { class: 'intro-tabla__s num', html: `s<sub>i</sub> = ${esP1 ? 1 : 0}` })),
      el('span', { class: 'intro-tabla__cabeza-texto' }, esP1 ? 'Recogidas junto a la puerta' : 'Recogidas al fondo'),
      mini(esP1 ? 'z' : 'w'),
      el('span', { class: 'intro-tabla__clientes' },
        lista.length ? lista.map((p) => chipCliente(p, n, estado)) : el('span', { class: 'intro-tabla__ninguno' }, 'ningún cliente')));
  };

  const celda = (dato, pol) => {
    if (!dato) return el('td', { class: 'intro-celda intro-celda--vacia' }, el('span', { class: 'visualmente-oculto' }, 'No aplica'), el('span', { 'aria-hidden': 'true' }, '—'));
    return el('td', { class: `intro-celda intro-celda--p${pol}${dato.solo ? ' intro-celda--solo' : ''}` },
      dato.solo ? el('span', { class: 'intro-celda__solo' }, 'solo P2') : null,
      el('span', { class: 'intro-celda__texto' }, dato.texto),
      formula(dato.tex, dato.plano, 'intro-celda__formula'));
  };

  const hito = (tipo) => el('tr', { class: `intro-tabla__hito intro-tabla__hito--${tipo}` },
    el('td', { class: 'intro-tabla__paso' }),
    el('td', { colspan: 2 },
      el('div', { class: 'intro-hito' },
        el('span', { class: 'intro-hito__marca', html: `${tipo}<sub>i</sub>` }),
        el('span', { class: 'intro-hito__texto', html: tipo === 'D'
          ? 'fin de la entrega. Lo anterior retrasa al cliente <em>i</em> y a los siguientes; lo posterior, solo a los siguientes.'
          : 'el camión sale hacia el próximo cliente.' }))));

  const filas = PASOS_TABLA.map((fila) => (fila.hito
    ? hito(fila.hito)
    : el('tr', { class: 'intro-tabla__fila' },
      el('th', { scope: 'row', class: 'intro-tabla__paso num' }, String(fila.paso)),
      celda(fila.p1, 1),
      celda(fila.p2, 2))));

  const tabla = el('table', { class: 'intro-tabla' },
    el('caption', { class: 'visualmente-oculto' }, 'Secuencia de operaciones de la Tabla 3 en cada cliente bajo P1 y P2'),
    el('colgroup', {}, el('col', { class: 'intro-tabla__col-paso' }), el('col', {}), el('col', {})),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', class: 'intro-tabla__paso' }, el('span', { class: 'visualmente-oculto' }, 'Paso')), cabecera(1, p1), cabecera(0, p2))),
    el('tbody', {}, filas));

  const figura = el('figure', { class: 'tarjeta intro-panel intro-politica' },
    el('div', { class: 'intro-panel__cabecera' }, el('h4', { class: 'tarjeta__titulo intro-panel__titulo' }, 'Tabla 3 · Operaciones en el cliente ', el('em', { class: 'intro-math' }, 'i'))),
    tabla,
    el('figcaption', { class: 'intro-panel__pie' },
      el('div', { class: 'intro-formula intro-formula--ancha' },
        formula(String.raw`F_i = D_i + \ell_b\left(\sum_j z_{ji} + \beta_i\right) + q_i`, 'F_i = D_i + ℓ_b (Σ z_ji + β_i) + q_i'),
        el('span', { class: 'intro-formula__pie' },
          'con ', formula(String.raw`q_i = h_a \sum_j y_{ij}`, 'q_i = h_a Σ y_ij'), ' bajo P2 ', el('span', { html: `(h<sub>a</sub> = ${PARAM_HTML.ua} + ${PARAM_HTML.la})` }), ' y q', el('sub', {}, 'i'), ' = 0 bajo P1'))));

  // Dato real: quiénes usan P2 y cuánto pagan.
  const dato = (p) => [chipCliente(p, n, estado), ' (q', el('sub', {}, String(p.cliente)), ' = ', el('strong', { class: 'num' }, num(p.q)), ')'];
  let partes;
  if (!p2.length) {
    partes = ['Todos los clientes usan P1, así que q', el('sub', {}, 'i'), ' = 0 en toda la ruta.'];
  } else if (p2.length === 1) {
    const p = p2[0];
    partes = ['El cliente ', chipCliente(p, n, estado), ' usa P2 y su q', el('sub', {}, String(p.cliente)), ' = ', el('strong', { class: 'num' }, num(p.q)),
      p.yPendiente === 0 ? ': ya no quedan entregas a bordo, así que dejar las recogidas al fondo no le cuesta nada extra.' : '.'];
  } else {
    const visibles = p2.slice(0, 6);
    const resto = p2.length - visibles.length;
    const lista = resto > 0
      ? [...visibles.flatMap((p, i) => (i ? [', ', ...dato(p)] : dato(p))), ` y ${resto} más`]
      : unir(visibles.map((p) => dato(p)));
    partes = ['Usan P2 los clientes ', ...lista,
      '; en total Σ q', el('sub', {}, 'i'), ' = ', el('strong', { class: 'num' }, num(sumar(p2.map((p) => p.q)))), '.'];
    const gratis = p2.find((p) => p.yPendiente === 0);
    if (gratis) partes.push(` En el cliente ${gratis.cliente}, q = 0 porque ya no quedan entregas a bordo.`);
  }
  const notaNodo = nota(...partes);

  const texto = el('div', { class: 'intro-idea__texto' },
    el('span', { class: 'intro-idea__numero', 'aria-hidden': 'true' }, '03'),
    el('h3', { class: 'intro-idea__titulo' }, 'Política 3: decidir en cada cliente'),
    el('p', { html: 'En cada cliente se decide dónde dejar las recogidas. Con <strong>P1</strong> (s<sub>i</sub> = 1) quedan junto a la puerta: no cuesta nada extra ahora, pero estorbarán en cada parada siguiente. Con <strong>P2</strong> (s<sub>i</sub> = 0) se sacan las entregas que siguen a bordo, las recogidas van al fondo y las entregas se recargan.' }),
    el('p', { html: 'P2 paga hoy más manipulación para liberar la puerta. Cerca del final de la ruta quedan pocas entregas a bordo (Σ y<sub>ij</sub> pequeño), así que P2 resulta relativamente más barata.' }),
    notaNodo);

  const idea = el('article', { class: 'intro-idea', 'aria-label': 'Idea 3: Política 3' }, texto, figura);

  function animar() {
    if (movimientoReducido() || vistos.has('politica')) return;
    const cabezas = [...tabla.querySelectorAll('thead th')];
    const celdas = filas.map((f) => [...f.children]);
    const tl = gsap.timeline({
      scrollTrigger: { trigger: figura, start: 'top 75%', once: true },
      onStart: () => vistos.add('politica'),
    });
    tl.from(cabezas, { autoAlpha: 0, y: 12, duration: 0.6, ease: 'power3.out', stagger: 0.1 });
    celdas.forEach((grupo, i) => {
      tl.from(grupo, { autoAlpha: 0, y: 14, duration: 0.5, ease: 'power3.out', stagger: 0.06 }, 0.25 + i * 0.13);
    });
    tl.from(tabla.querySelectorAll('.intro-hito__marca'), { scale: 0.4, duration: 0.5, ease: 'back.out(2.5)', stagger: 0.4 }, 0.6);
  }

  return { nodo: idea, animar };
}

// ---------------------------------------------------------------------------
// Módulo
// ---------------------------------------------------------------------------

export function crear(raiz, estado) {
  const fondo = raiz?.hero ?? null;
  const escena = raiz?.problema ?? null;
  const seccionHero = fondo?.closest('.hero') ?? document.getElementById('inicio');
  const contenidoHero = seccionHero?.querySelector('.hero__contenido') ?? null;

  let ctx = null;
  let mm = null;
  let desuscribir = null;
  let ideas = [];
  let renderizado = false;
  let entradaHecha = false;
  // Lo que ya se vio no se vuelve a animar al cambiar de solución.
  const vistos = new Set();
  const memoria = {};
  const enCtx = (fn) => (ctx ? ctx.add(fn) : fn());

  function entradaPortada() {
    if (entradaHecha || !seccionHero) return;
    entradaHecha = true;
    if (movimientoReducido() || !window.gsap) return;
    const q = (s) => seccionHero.querySelector(s);
    const titulo = q('.hero__titulo');
    const antetitulo = q('.hero__antetitulo');
    const despues = [q('.hero__subtitulo'), q('.hero__pregunta'), q('.hero__instancia')].filter(Boolean);
    const bajar = q('.hero__bajar');
    // type 'chars' respeta los elementos anidados: el <sub>3</sub> se parte por dentro.
    const partido = titulo && window.SplitText ? window.SplitText.create(titulo, { type: 'chars', charsClass: 'hero__letra' }) : null;
    const letras = partido?.chars?.length ? partido.chars : [titulo].filter(Boolean);
    const animados = [antetitulo, ...despues, bajar].filter(Boolean);
    const tl = gsap.timeline({
      delay: 0.45,
      onComplete: () => {
        partido?.revert();
        gsap.set(animados, { clearProps: 'transform,opacity,visibility' });
      },
    });
    if (antetitulo) tl.from(antetitulo, { y: 14, autoAlpha: 0, duration: 0.8, ease: 'power3.out' }, 0);
    if (letras.length) tl.from(letras, { yPercent: 70, autoAlpha: 0, rotate: 5, transformOrigin: '0% 100%', duration: 1.15, ease: 'expo.out', stagger: 0.05 }, 0.1);
    if (despues.length) tl.from(despues, { y: 22, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.11 }, 0.6);
    if (bajar) tl.from(bajar, { autoAlpha: 0, duration: 0.8, ease: 'power2.out' }, 1.1);
  }

  function resaltar(cliente) {
    for (const contenedor of [fondo, escena]) {
      if (!contenedor) continue;
      for (const nodo of contenedor.querySelectorAll('[data-cliente]')) {
        nodo.classList.toggle('es-resaltado', cliente != null && Number(nodo.dataset.cliente) === cliente);
      }
    }
  }

  function render(sim, salida) {
    if (!window.gsap) return;
    // Si render se llama dos veces sin destruir() entre medio, no deben quedar
    // contextos, matchMedia ni suscripciones huérfanas.
    if (ctx || mm || desuscribir || ideas.length) destruir();
    entradaPortada(); // fuera de cualquier contexto: no se revierte ni se repite
    const primera = !renderizado;
    renderizado = true;

    const contexto = { estado, enCtx, memoria, vistos };
    const hero = fondo ? construirHero(sim, salida, estado) : null;
    if (hero) fondo.replaceChildren(hero.envoltura);
    ideas = escena ? [ideaEspera(sim, contexto), ideaPuerta(sim, contexto), ideaPolitica(sim, contexto)] : [];
    if (escena) escena.replaceChildren(el('div', { class: 'intro-ideas' }, ideas.map((i) => i.nodo)));

    ctx = gsap.context(() => {
      if (hero) animarHero(hero, primera, seccionHero, enCtx);
      for (const idea of ideas) idea.animar();
    });

    mm = gsap.matchMedia();
    if (hero && seccionHero) {
      mm.add(ESCRITORIO, () => {
        // Paralaje: la ruta sube más lento y se desvanece; el texto sube y se atenúa.
        gsap.to(hero.envoltura, {
          yPercent: 16,
          autoAlpha: 0.15,
          ease: 'none',
          scrollTrigger: { trigger: seccionHero, start: 'top top', end: 'bottom top', scrub: 0.5 },
        });
        if (contenidoHero) {
          gsap.to(contenidoHero, {
            y: -90,
            autoAlpha: 0,
            ease: 'none',
            scrollTrigger: { trigger: seccionHero, start: 'top top', end: 'bottom 20%', scrub: 0.5 },
          });
        }
      });
    }

    desuscribir = estado.on('hover', resaltar);
    resaltar(estado.get('hover'));
  }

  function destruir() {
    mm?.revert();
    mm = null;
    for (const idea of ideas) idea.destruir?.();
    ideas = [];
    ctx?.revert();
    ctx = null;
    desuscribir?.();
    desuscribir = null;
    ocultarTooltip();
    fondo?.replaceChildren();
    escena?.replaceChildren();
  }

  return { render, destruir };
}
