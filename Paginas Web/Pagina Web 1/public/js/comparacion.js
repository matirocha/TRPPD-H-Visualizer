// Comparación de corridas, compartida por Rendimiento (variantes de Gurobi) y Heurísticas.
//
// A. Esta instancia: una fila por serie (variante o algoritmo); la que se está mostrando va en tinta.
// B. Todas las instancias con el mismo banco y n: un punto por instancia en cada serie y una
//    marca en la mediana; la instancia mostrada lleva un anillo.
// Debajo, una tabla con la mediana, la media y el máximo de cada serie.
//
// Los datos salen del manifest, así que no hace falta abrir cada archivo. Clic en una barra o
// un punto abre esa solución. Con escala logarítmica (tiempos que van de milisegundos a horas)
// la fila A se dibuja con un punto en vez de una barra, porque el largo no sería proporcional.
//
// config:
//   metricas        {clave: {texto, unidad, decimales, escala?, log?, formato?, ayuda}}; el valor
//                   de una salida es salida[clave] · escala
//   series          [{clave, corta, etiqueta}], filas de los gráficos en orden
//   serieDe(s)      clave de la serie de una salida del manifest, o null si no participa
//   representante(salidas)  opcional: cuál usar cuando una serie tiene varias salidas por instancia
//   hayDatos(salidas, mostrada)  opcional: false muestra config.vacio(mostrada) en vez de los gráficos
//   titulos         {a(mostrada), bajadaA, b(grupo), bajadaB(total), tabla(grupo, M)}
//   nota(filas, medida)   {clase, icono, html} bajo el gráfico A, o null
//   tooltip(s, serie, filas)  html del tooltip de una salida
//   tabla           {encabezados, fila(r, resumen, texto) -> celdas}
import { el, fmt, mostrarTooltip, moverTooltip, movimientoReducido, ocultarTooltip, svg } from './util.js';

export const mediana = (v) => {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
export const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
// El nombre distingue los bancos (vigo_n30_id1_h0.1 y vigo_n30_id1_h0.1_Erdogan)
export const mismaInstancia = (a, b) => a.instancia.nombre === b.instancia.nombre;
export const mismoGrupo = (a, b) => a.instancia.n === b.instancia.n && a.instancia.banco === b.instancia.banco;

const CIFRAS = new Intl.NumberFormat('es-CL', { maximumSignificantDigits: 2 });
/** Segundos legibles de 0,0001 a miles: enteros desde 100 s, dos decimales desde 1 s y dos cifras significativas bajo 1 s. */
export const segundos = (v) => (v == null ? '—' : v >= 100 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : CIFRAS.format(v));

/** Barra horizontal con el extremo de datos redondeado y el inicio recto, sobre el eje. */
function barra(x0, x1, y, alto, r = 4) {
  const w = Math.max(2, x1 - x0);
  const rr = Math.min(r, w, alto / 2);
  const x = x0 + w;
  return `M${x0},${y}H${x - rr}Q${x},${y} ${x},${y + rr}V${y + alto - rr}Q${x},${y + alto} ${x - rr},${y + alto}H${x0}Z`;
}

/** opciones: manifest() lista de salidas, actual() archivo mostrado, elegir(archivo). */
export function crearComparacion(raiz, { manifest, actual, elegir }, config) {
  let vista = null;
  let metrica = Object.keys(config.metricas)[0];
  const abrir = (sinAnimar) => {
    vista?.destruir();
    vista = montar(raiz, { manifest: manifest(), actual: actual(), elegir, metrica, cambiarMetrica, sinAnimar }, config);
  };
  function cambiarMetrica(nueva) {
    metrica = nueva;
    abrir(true);
  }
  return {
    render() {
      abrir(false);
    },
    destruir() {
      vista?.destruir();
      vista = null;
      raiz.replaceChildren();
    },
  };
}

function montar(raiz, { manifest, actual, elegir, metrica, cambiarMetrica, sinAnimar = false }, C) {
  const d3 = window.d3;
  const M = C.metricas[metrica];
  const valor = (s) => (s?.[metrica] == null ? null : s[metrica] * (M.escala ?? 1));
  const texto = (v) => (v == null ? '—' : `${M.formato ? M.formato(v) : fmt(v, M.decimales)}${M.unidad}`);

  const participantes = manifest.filter((s) => C.serieDe(s));
  const mostrada = manifest.find((s) => s.archivo === actual);
  if (!mostrada || !participantes.length || (C.hayDatos && !C.hayDatos(participantes, mostrada))) {
    raiz.replaceChildren(el('div', { class: 'contenedor' }, el('div', { class: 'tarjeta' }, el('p', { html: C.vacio(mostrada) }))));
    return { destruir() {} };
  }
  const claveActual = C.serieDe(mostrada);
  const n = mostrada.instancia.n;
  const elegirUna = (salidas) => (C.representante ? C.representante(salidas) : salidas[0]) ?? null;
  const delInstancia = C.series.map((v) => ({
    v, s: elegirUna(participantes.filter((s) => C.serieDe(s) === v.clave && mismaInstancia(s, mostrada))),
  }));
  const delN = C.series.map((v) => {
    const porInstancia = d3.group(participantes.filter((s) => C.serieDe(s) === v.clave && mismoGrupo(s, mostrada)), (s) => s.instancia.nombre);
    return { v, salidas: [...porInstancia.values()].map(elegirUna).filter((s) => valor(s) != null) };
  });
  const grupo = `n = ${n} · banco ${mostrada.instancia.banco}`;
  const medida = { metrica, M, valor, texto };

  const ctx = gsap.context(() => {}, raiz);
  const st = { ancho: 0, temporizador: 0, destruyendo: false };

  // --- Controles: una fila sobre los gráficos ----------------------------------
  const control = el('div', { class: 'rend-control' },
    el('span', { class: 'rend-control__etiqueta' }, 'Medida'),
    el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Medida de rendimiento' },
      Object.entries(C.metricas).map(([clave, m]) => el('button', {
        type: 'button', 'aria-pressed': String(clave === metrica),
        onclick: () => clave !== metrica && cambiarMetrica(clave),
      }, m.texto))),
    el('span', { class: 'rend-control__ayuda', html: M.ayuda }));

  // --- A · Esta instancia --------------------------------------------------------
  const nota = C.nota?.(delInstancia, medida);
  const marcoA = el('div', { class: 'rend-grafico' });
  const tarjetaA = el('article', { class: 'tarjeta rend-tarjeta', 'aria-labelledby': `${raiz.id}-a` },
    el('h3', { class: 'tarjeta__titulo', id: `${raiz.id}-a` }, C.titulos.a(mostrada)),
    el('p', { class: 'rend-bajada', html: C.titulos.bajadaA }),
    marcoA,
    nota ? el('p', { class: `rend-nota${nota.clase}` },
      el('span', { class: 'rend-nota__icono', 'aria-hidden': 'true' }, nota.icono),
      el('span', { html: nota.html })) : null);

  // --- B · Todas las instancias con este banco y n -------------------------------
  const marcoB = el('div', { class: 'rend-grafico' });
  const totalB = Math.max(0, ...delN.map((d) => d.salidas.length));
  const tarjetaB = el('article', { class: 'tarjeta rend-tarjeta', 'aria-labelledby': `${raiz.id}-b` },
    el('h3', { class: 'tarjeta__titulo', id: `${raiz.id}-b` }, C.titulos.b(grupo)),
    el('p', { class: 'rend-bajada', html: C.titulos.bajadaB(totalB) }),
    marcoB);

  // --- Tabla resumen ------------------------------------------------------------
  const resumen = delN.map(({ v, salidas }) => {
    const vals = salidas.map(valor);
    return {
      v, salidas, cantidad: vals.length,
      mediana: vals.length ? mediana(vals) : null, media: vals.length ? media(vals) : null, max: vals.length ? Math.max(...vals) : null,
    };
  });
  const tabla = el('article', { class: 'tarjeta rend-tarjeta rend-tarjeta--tabla', 'aria-labelledby': `${raiz.id}-t` },
    el('h3', { class: 'tarjeta__titulo', id: `${raiz.id}-t` }, C.titulos.tabla(grupo, M)),
    el('div', { class: 'tabla-desplazable' }, el('table', { class: 'tabla rend-tabla' },
      el('thead', {}, el('tr', {}, C.tabla.encabezados.map((h) => el('th', { scope: 'col', html: h })))),
      el('tbody', {}, resumen.map((r) => el('tr', { class: r.v.clave === claveActual ? 'resaltado' : '' },
        C.tabla.fila(r, resumen, texto).map((celda) => el('td', {}, celda))))))));

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

  /** Escala lineal desde 0 o, si la medida es logarítmica, entre potencias de 10. */
  function escala(valores, rango) {
    if (!M.log) return d3.scaleLinear().domain([0, Math.max(...valores, 1e-9)]).nice(4).range(rango);
    const positivos = valores.filter((v) => v > 0);
    const min = Math.min(...positivos, 1);
    const max = Math.max(...positivos, min * 10);
    return d3.scaleLog().domain([10 ** Math.floor(Math.log10(min)), 10 ** Math.ceil(Math.log10(max))]).range(rango).clamp(true);
  }

  function marcas(x) {
    if (M.log) {
      const [a, b] = x.domain().map(Math.log10);
      const paso = Math.ceil((b - a) / 5);
      return d3.range(a, b + 1, paso).map((e) => 10 ** e);
    }
    const t = (k) => (M.decimales === 0 ? x.ticks(k).filter(Number.isInteger) : x.ticks(k));
    // Con números largos (Σ D) cuatro marcas no caben: se usan menos
    const largo = Math.max(...t(4).map((v) => fmt(v, M.decimales).length));
    return t(4).length * largo * 7.5 > x.range()[1] - x.range()[0] ? t(2) : t(4);
  }

  function eje(g, x, alto) {
    d3.select(g).attr('transform', `translate(0,${alto})`)
      .call(d3.axisBottom(x).tickValues(marcas(x)).tickFormat((v) => (M.formato ? M.formato(v) : fmt(v, M.decimales))).tickSizeOuter(0));
  }

  function guias(x, alto) {
    return svg('g', { class: 'rend-guias' }, marcas(x).map((t) => svg('line', { x1: x(t), x2: x(t), y1: 0, y2: alto })));
  }

  function rotulo(v, y, actualFila) {
    return svg('text', { class: `rend-rotulo${actualFila ? ' rend-rotulo--actual' : ''}`, x: 0, y, 'dominant-baseline': 'middle' }, v.corta);
  }

  function interactivo(nodo, s, v, etiqueta) {
    Object.assign(nodo.dataset, { archivo: s.archivo });
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('role', 'button');
    nodo.setAttribute('aria-label', etiqueta);
    nodo.addEventListener('pointerenter', (e) => mostrarTooltip(C.tooltip(s, v, delInstancia, medida), e));
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
    const alto = fila * C.series.length;
    const x = escala(delInstancia.filter((d) => valor(d.s) != null).map((d) => valor(d.s)), [izq, ancho - der]);
    const svgA = svg('svg', { class: 'rend-svg', viewBox: `0 0 ${ancho} ${alto + 28}`, width: ancho, height: alto + 28, role: 'img', 'aria-label': `${M.texto} por serie en ${mostrada.instancia.nombre}` });
    const filas = delInstancia.map(({ v, s }, i) => {
      const y = i * fila + fila / 2;
      const esActual = v.clave === claveActual;
      if (valor(s) == null) {
        return svg('g', {}, rotulo(v, y, false),
          svg('text', { class: 'rend-valor rend-valor--falta', x: izq + 6, y, 'dominant-baseline': 'middle' }, s ? 'sin dato para esta medida' : 'sin solución en Outputs'));
      }
      const fin = x(valor(s));
      const g = svg('g', { class: `rend-fila${esActual ? ' rend-fila--actual' : ''}` },
        svg('rect', { class: 'rend-zona', x: 0, y: i * fila + 2, width: ancho, height: fila - 4, rx: 8 }),
        rotulo(v, y, esActual),
        M.log
          ? [svg('line', { class: 'rend-carril', x1: izq, x2: ancho - der, y1: y, y2: y }), svg('circle', { class: 'rend-marca', cx: fin, cy: y, r: 6 })]
          : svg('path', { class: 'rend-barra', d: barra(izq, fin, y - 9, 18) }),
        svg('text', { class: 'rend-valor', x: fin + (M.log ? 12 : 8), y, 'dominant-baseline': 'middle' }, texto(valor(s))));
      interactivo(g, s, v, `${v.etiqueta}: ${texto(valor(s))}. Abrir esta solución`);
      return g;
    });
    const gEje = svg('g', { class: 'rend-eje' });
    svgA.append(guias(x, alto), ...filas, gEje);
    eje(gEje, x, alto);
    marcoA.replaceChildren(svgA);
  }

  function dibujarB() {
    const { ancho, izq, der } = medidas(marcoB);
    const fila = 58;
    const alto = fila * C.series.length;
    const x = escala(delN.flatMap((d) => d.salidas.map(valor)), [izq, ancho - der]);
    const svgB = svg('svg', { class: 'rend-svg', viewBox: `0 -16 ${ancho} ${alto + 44}`, width: ancho, height: alto + 44, role: 'img', 'aria-label': `${M.texto} de cada instancia con ${grupo}, por serie` });
    const filas = delN.map(({ v, salidas }, i) => {
      const y = i * fila + fila / 2;
      const esActual = v.clave === claveActual;
      const g = svg('g', { class: 'rend-franja' },
        svg('line', { class: 'rend-carril', x1: izq, x2: ancho - der, y1: y, y2: y }),
        rotulo(v, y, esActual));
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
    svgB.append(guias(x, alto), encabezado, ...filas, gEje);
    eje(gEje, x, alto);
    marcoB.replaceChildren(svgB);
  }
}
