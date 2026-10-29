// Sección 02 · Rendimiento: tiempos de ejecución del modelo de Gurobi con y sin
// las restricciones (20)-(23) y (24)-(29).
//
// A. Esta instancia: una barra por variante; la que se está mostrando va en tinta.
// B. Todas las instancias con el mismo n: un punto por instancia en cada variante
//    y una marca en la mediana; la instancia mostrada lleva un anillo.
// Debajo, una tabla con la mediana, la media y el máximo de cada variante.
//
// Los datos salen del manifest (segundos, segundosTotal y nodos de cada salida),
// así que no hace falta abrir cada archivo. Clic en una barra o un punto abre
// esa solución.
import {
  VARIANTES, claveVariante, el, fmt, mostrarTooltip, moverTooltip, movimientoReducido, ocultarTooltip, svg,
} from './util.js';

const METRICAS = {
  segundos: {
    texto: 'Resolución', unidad: ' s', decimales: 3,
    ayuda: 'Tiempo que tarda Gurobi en resolver el modelo (Runtime).',
  },
  segundosTotal: {
    texto: 'Total', unidad: ' s', decimales: 3,
    ayuda: 'Construcción del modelo, resolución y lectura de la solución.',
  },
  nodos: {
    texto: 'Nodos B&B', unidad: '', decimales: 0,
    ayuda: 'Nodos del árbol de ramificación y acotamiento que explora Gurobi.',
  },
};

// Etiquetas cortas para el eje de las variantes
const CORTA = { '00': '(1)–(19)', 10: '+ (20)–(23)', '01': '+ (24)–(29)', 11: '(1)–(29)' };
const ESTADOS = { OPTIMAL: 'óptima', TIME_LIMIT: 'límite de tiempo', SUBOPTIMAL: 'subóptima' };

const mediana = (v) => {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const mismaInstancia = (a, b) => a.instancia.n === b.instancia.n && a.instancia.id === b.instancia.id && a.instancia.h === b.instancia.h;

/** Barra horizontal con el extremo de datos redondeado y el inicio recto, sobre el eje. */
function barra(x0, x1, y, alto, r = 4) {
  const w = Math.max(2, x1 - x0);
  const rr = Math.min(r, w, alto / 2);
  const x = x0 + w;
  return `M${x0},${y}H${x - rr}Q${x},${y} ${x},${y + rr}V${y + alto - rr}Q${x},${y + alto} ${x - rr},${y + alto}H${x0}Z`;
}

/** opciones: manifest() lista de salidas, actual() archivo mostrado, elegir(archivo). */
export function crear(raiz, estado, { manifest, actual, elegir }) {
  let vista = null;
  let metrica = 'segundos';
  return {
    render() {
      vista?.destruir();
      vista = montar(raiz, { manifest: manifest(), actual: actual(), elegir, metrica, cambiarMetrica });
    },
    destruir() {
      vista?.destruir();
      vista = null;
      raiz.replaceChildren();
    },
  };

  function cambiarMetrica(nueva) {
    metrica = nueva;
    vista?.destruir();
    vista = montar(raiz, { manifest: manifest(), actual: actual(), elegir, metrica, cambiarMetrica, sinAnimar: true });
  }
}

function montar(raiz, { manifest, actual, elegir, metrica, cambiarMetrica, sinAnimar = false }) {
  const d3 = window.d3;
  const M = METRICAS[metrica];
  const valor = (s) => s[metrica];
  const texto = (v) => (v == null ? '—' : `${fmt(v, M.decimales)}${M.unidad}`);

  const conVariante = manifest.filter((s) => s.algoritmo.variante && valor(s) != null);
  const mostrada = manifest.find((s) => s.archivo === actual);
  if (!conVariante.length || !mostrada) {
    raiz.replaceChildren(el('div', { class: 'contenedor' },
      el('div', { class: 'tarjeta' }, el('p', {}, 'No hay soluciones de Gurobi con variantes en Outputs. Ejecuta notebooks/modelo_trppdh3.py con RESTRICCIONES_20_23 y RESTRICCIONES_24_29 = [False, True].'))));
    return { destruir() {} };
  }
  const claveActual = claveVariante(mostrada.algoritmo.variante);
  const n = mostrada.instancia.n;
  const delInstancia = VARIANTES.map((v) => ({
    v, s: conVariante.find((s) => claveVariante(s.algoritmo.variante) === v.clave && mismaInstancia(s, mostrada)) ?? null,
  }));
  const delN = VARIANTES.map((v) => ({
    v, salidas: conVariante.filter((s) => claveVariante(s.algoritmo.variante) === v.clave && s.instancia.n === n),
  }));
  const base = delInstancia[0].s;

  const ctx = gsap.context(() => {}, raiz);
  const st = { ancho: 0, temporizador: 0, destruyendo: false };

  // --- Controles: una fila sobre los gráficos ----------------------------------
  const control = el('div', { class: 'rend-control' },
    el('span', { class: 'rend-control__etiqueta' }, 'Medida'),
    el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Medida de rendimiento' },
      Object.entries(METRICAS).map(([clave, m]) => el('button', {
        type: 'button', 'aria-pressed': String(clave === metrica),
        onclick: () => clave !== metrica && cambiarMetrica(clave),
      }, m.texto))),
    el('span', { class: 'rend-control__ayuda' }, M.ayuda));

  // --- A · Esta instancia --------------------------------------------------------
  const objetivos = delInstancia.filter((d) => d.s).map((d) => d.s.objetivo);
  const iguales = objetivos.every((o) => Math.abs(o - objetivos[0]) < 1e-4);
  const marcoA = el('div', { class: 'rend-grafico' });
  const tarjetaA = el('article', { class: 'tarjeta rend-tarjeta', 'aria-labelledby': 'rend-a-titulo' },
    el('h3', { class: 'tarjeta__titulo', id: 'rend-a-titulo' }, `Esta instancia · ${mostrada.instancia.nombre}`),
    el('p', { class: 'rend-bajada', html: 'Una barra por variante del modelo; en tinta, la que se está mostrando. Clic en una barra para abrirla.' }),
    marcoA,
    el('p', { class: `rend-nota${iguales ? '' : ' rend-nota--error'}` },
      el('span', { class: 'rend-nota__icono', 'aria-hidden': 'true' }, iguales ? '✓' : '!'),
      el('span', { html: iguales
        ? `Las ${objetivos.length} variantes llegan al mismo óptimo, Σ D<sub>i</sub> = ${fmt(objetivos[0])}: las restricciones (20)–(29) solo cambian el tiempo.`
        : `Las variantes no llegan al mismo Σ D<sub>i</sub> (${objetivos.map((o) => fmt(o)).join(' · ')}); revisa el estado de cada una.` })));

  // --- B · Todas las instancias con este n --------------------------------------
  const marcoB = el('div', { class: 'rend-grafico' });
  const totalB = delN[0].salidas.length;
  const tarjetaB = el('article', { class: 'tarjeta rend-tarjeta', 'aria-labelledby': 'rend-b-titulo' },
    el('h3', { class: 'tarjeta__titulo', id: 'rend-b-titulo' }, `Todas las instancias con n = ${n}`),
    el('p', { class: 'rend-bajada', html: `Un punto por instancia (${totalB} combinaciones de ID y h) y una raya en la mediana. El anillo es la instancia mostrada.` }),
    marcoB);

  // --- Tabla resumen ------------------------------------------------------------
  const resumen = delN.map(({ v, salidas }) => {
    const vals = salidas.map(valor);
    return { v, cantidad: vals.length, mediana: vals.length ? mediana(vals) : null, media: vals.length ? media(vals) : null, max: vals.length ? Math.max(...vals) : null };
  });
  const mediaBase = resumen[0].media;
  const tabla = el('article', { class: 'tarjeta rend-tarjeta rend-tarjeta--tabla', 'aria-labelledby': 'rend-t-titulo' },
    el('h3', { class: 'tarjeta__titulo', id: 'rend-t-titulo' }, `Resumen por variante · n = ${n} · ${M.texto.toLowerCase()}`),
    el('div', { class: 'tabla-desplazable' }, el('table', { class: 'tabla rend-tabla' },
      el('thead', {}, el('tr', {}, ['Variante', 'Restricciones', 'Instancias', 'Mediana', 'Media', 'Máximo', 'Media vs (1)–(19)']
        .map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, resumen.map((r) => el('tr', { class: r.v.clave === claveActual ? 'resaltado' : '' },
        el('td', {}, CORTA[r.v.clave]),
        el('td', {}, r.v.etiqueta),
        el('td', {}, String(r.cantidad)),
        el('td', {}, texto(r.mediana)),
        el('td', {}, texto(r.media)),
        el('td', {}, texto(r.max)),
        el('td', {}, r.media == null || !mediaBase ? '—' : r.v.clave === '00' ? 'referencia' : `× ${fmt(r.media / mediaBase, 2)}`)))))));

  const contenedor = el('div', { class: 'contenedor rend' }, control, el('div', { class: 'rend-rejilla' }, tarjetaA, tarjetaB), tabla);
  raiz.replaceChildren(contenedor);

  dibujar();
  if (!sinAnimar && !movimientoReducido()) {
    ctx.add(() => {
      gsap.fromTo(marcoA.querySelectorAll('.rend-barra'), { scaleX: 0, transformOrigin: '0% 50%' }, {
        scaleX: 1, duration: 0.9, ease: 'power3.out', stagger: 0.08, clearProps: 'transform',
        scrollTrigger: { trigger: marcoA, start: 'top 85%', once: true },
      });
      gsap.fromTo(marcoB.querySelectorAll('.rend-punto'), { autoAlpha: 0 }, {
        autoAlpha: 1, duration: 0.5, ease: 'power1.out', stagger: 0.006, clearProps: 'opacity,visibility',
        scrollTrigger: { trigger: marcoB, start: 'top 85%', once: true },
      });
    });
  }

  st.ancho = contenedor.clientWidth;
  const ro = new ResizeObserver(() => {
    clearTimeout(st.temporizador);
    st.temporizador = setTimeout(() => {
      if (st.destruyendo || Math.abs(contenedor.clientWidth - st.ancho) <= 1) return;
      st.ancho = contenedor.clientWidth;
      dibujar();
    }, 160);
  });
  ro.observe(contenedor);

  return {
    destruir() {
      st.destruyendo = true;
      ro.disconnect();
      clearTimeout(st.temporizador);
      ocultarTooltip();
      ctx.revert();
    },
  };

  // --- Dibujo -------------------------------------------------------------------

  function dibujar() {
    dibujarA();
    dibujarB();
  }

  function medidas(marco) {
    const ancho = Math.max(280, marco.clientWidth);
    const angosto = ancho < 420;
    return { ancho, izq: angosto ? 92 : 104, der: angosto ? 74 : 92, angosto };
  }

  function eje(g, x, alto) {
    const ticks = M.decimales === 0 ? x.ticks(4).filter(Number.isInteger) : x.ticks(4);
    d3.select(g).attr('transform', `translate(0,${alto})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat((v) => fmt(v, M.decimales)).tickSizeOuter(0));
  }

  function rotulo(clave, y, actualFila) {
    return svg('text', { class: `rend-rotulo${actualFila ? ' rend-rotulo--actual' : ''}`, x: 0, y, 'dominant-baseline': 'middle' }, CORTA[clave]);
  }

  function tooltipSalida(s, v) {
    const relacion = base && s !== base && valor(base) > 0 ? `<br>× ${fmt(valor(s) / valor(base), 2)} respecto de (1)–(19)` : '';
    return `<strong>${v.etiqueta}</strong> · ${s.instancia.nombre}<br>`
      + `Resolución ${fmt(s.segundos, 3)} s · total ${fmt(s.segundosTotal, 3)} s<br>`
      + `Nodos B&amp;B ${fmt(s.nodos, 0)}<br>`
      + `Σ D<sub>i</sub> = ${fmt(s.objetivo)}${s.estado ? ` (${ESTADOS[s.estado] ?? s.estado.toLowerCase()})` : ''}${relacion}`;
  }

  function interactivo(nodo, s, v, etiqueta) {
    Object.assign(nodo.dataset, { archivo: s.archivo });
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('role', 'button');
    nodo.setAttribute('aria-label', etiqueta);
    nodo.addEventListener('pointerenter', (e) => mostrarTooltip(tooltipSalida(s, v), e));
    nodo.addEventListener('pointermove', moverTooltip);
    nodo.addEventListener('pointerleave', ocultarTooltip);
    nodo.addEventListener('click', () => s.archivo !== actual && elegir(s.archivo));
    nodo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (s.archivo !== actual) elegir(s.archivo);
      }
    });
  }

  function dibujarA() {
    const { ancho, izq, der } = medidas(marcoA);
    const fila = 46;
    const alto = fila * VARIANTES.length;
    const maximo = Math.max(...delInstancia.filter((d) => d.s).map((d) => valor(d.s)), 1e-9);
    const x = d3.scaleLinear().domain([0, maximo]).nice(4).range([izq, ancho - der]);
    const svgA = svg('svg', { class: 'rend-svg', viewBox: `0 0 ${ancho} ${alto + 28}`, width: ancho, height: alto + 28, role: 'img', 'aria-label': `${M.texto} por variante en ${mostrada.instancia.nombre}` });
    const guias = svg('g', { class: 'rend-guias' }, x.ticks(4).map((t) => svg('line', { x1: x(t), x2: x(t), y1: 0, y2: alto })));
    const filas = delInstancia.map(({ v, s }, i) => {
      const y = i * fila + fila / 2;
      const esActual = v.clave === claveActual;
      if (!s) {
        return svg('g', {}, rotulo(v.clave, y, false),
          svg('text', { class: 'rend-valor rend-valor--falta', x: izq + 6, y, 'dominant-baseline': 'middle' }, 'sin solución en Outputs'));
      }
      const g = svg('g', { class: `rend-fila${esActual ? ' rend-fila--actual' : ''}` },
        svg('rect', { class: 'rend-zona', x: 0, y: i * fila + 2, width: ancho, height: fila - 4, rx: 8 }),
        rotulo(v.clave, y, esActual),
        svg('path', { class: 'rend-barra', d: barra(izq, x(valor(s)), y - 9, 18) }),
        svg('text', { class: 'rend-valor', x: x(valor(s)) + 8, y, 'dominant-baseline': 'middle' }, texto(valor(s))));
      interactivo(g, s, v, `${v.etiqueta}: ${texto(valor(s))}. Abrir esta variante`);
      return g;
    });
    const gEje = svg('g', { class: 'rend-eje' });
    svgA.append(guias, ...filas, gEje);
    eje(gEje, x, alto);
    marcoA.replaceChildren(svgA);
  }

  function dibujarB() {
    const { ancho, izq, der } = medidas(marcoB);
    const fila = 58;
    const alto = fila * VARIANTES.length;
    const todos = delN.flatMap((d) => d.salidas.map(valor));
    const x = d3.scaleLinear().domain([0, Math.max(...todos, 1e-9)]).nice(4).range([izq, ancho - der]);
    const svgB = svg('svg', { class: 'rend-svg', viewBox: `0 0 ${ancho} ${alto + 28}`, width: ancho, height: alto + 28, role: 'img', 'aria-label': `${M.texto} de cada instancia con n = ${n}, por variante` });
    const guias = svg('g', { class: 'rend-guias' }, x.ticks(4).map((t) => svg('line', { x1: x(t), x2: x(t), y1: 0, y2: alto })));
    const filas = delN.map(({ v, salidas }, i) => {
      const y = i * fila + fila / 2;
      const esActual = v.clave === claveActual;
      const g = svg('g', { class: 'rend-franja' },
        svg('line', { class: 'rend-carril', x1: izq, x2: ancho - der, y1: y, y2: y }),
        rotulo(v.clave, y, esActual));
      if (!salidas.length) return g;
      // Dispersión vertical fija por instancia (ID y h) para que los puntos no se tapen
      const orden = [...salidas].sort((a, b) => a.instancia.id - b.instancia.id || a.instancia.h - b.instancia.h);
      let destacado = null;
      orden.forEach((s, k) => {
        const dy = ((k % 7) - 3) * 4.2;
        const p = svg('g', { class: 'rend-punto' },
          svg('circle', { class: 'rend-punto__zona', cx: x(valor(s)), cy: y + dy, r: 8 }),
          svg('circle', { class: 'rend-punto__marca', cx: x(valor(s)), cy: y + dy, r: 4 }));
        interactivo(p, s, v, `${s.instancia.nombre}, ${v.etiqueta}: ${texto(valor(s))}`);
        if (mismaInstancia(s, mostrada)) {
          p.classList.add('rend-punto--actual');
          destacado = p;
        } else g.append(p);
      });
      const med = mediana(orden.map(valor));
      g.append(
        svg('line', { class: 'rend-mediana', x1: x(med), x2: x(med), y1: y - 17, y2: y + 17 }),
        svg('text', { class: 'rend-valor', x: ancho - der + 8, y, 'dominant-baseline': 'middle' }, texto(med)));
      if (destacado) g.append(destacado); // encima de los demás
      return g;
    });
    const encabezado = svg('text', { class: 'rend-encabezado', x: ancho - der + 8, y: -6 }, 'mediana');
    const gEje = svg('g', { class: 'rend-eje' });
    svgB.append(guias, encabezado, ...filas, gEje);
    svgB.setAttribute('viewBox', `0 -16 ${ancho} ${alto + 44}`);
    svgB.setAttribute('height', alto + 44);
    eje(gEje, x, alto);
    marcoB.replaceChildren(svgB);
  }
}
