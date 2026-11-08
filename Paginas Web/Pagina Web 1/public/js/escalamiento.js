// Tiempo de ejecución según n (sección Rendimiento, bajo la comparación por instancia).
//
// Una línea por método con el tiempo promedio de las instancias de cada n: Gurobi (la variante
// elegida en la tabla), la heurística de 2 fases y las cuatro metaheurísticas (en ellas, el promedio
// de los tiempos promedio de sus réplicas). El eje y es logarítmico porque los tiempos van de 10⁻⁴ s
// a la hora de límite de Gurobi. El color es la familia (Gurobi en tinta; 2 fases, ILS e ITS con la
// paleta de rendimiento.css) y el trazo la evaluación: continuo exacta, discontinuo heurística.
// Rótulos al final de cada línea (en pantallas anchas), leyenda arriba, tooltip por n, una franja
// en el n de la tabla y, debajo, los mismos datos en una tabla.
import { segundos } from './comparacion.js';
import { el, fmt, mostrarTooltip, moverTooltip, movimientoReducido, ocultarTooltip, svg } from './util.js';

const LIMITE_GUROBI = 3600;
let contador = 0;

/** Familia de un método: da el color de su línea (clase rend-esc__serie--<familia>). */
const familia = (clave) => (clave === 'gurobi' ? 'gurobi' : clave === 'dos_fases' ? '2f' : clave.slice(0, 3));

/** Muestra de leyenda: un tramo de línea con su marcador. */
function muestra(s) {
  return svg('svg', { class: `rend-esc__muestra rend-esc__serie--${s.familia}${s.heuristica ? ' rend-esc__serie--heuristica' : ''}`, viewBox: '0 0 28 12', width: 28, height: 12, 'aria-hidden': 'true' },
    svg('line', { class: 'rend-esc__linea', x1: 1, x2: 27, y1: 6, y2: 6 }),
    svg('circle', { class: 'rend-esc__punto', cx: 14, cy: 6, r: 3.5 }));
}

/**
 * instancias: filas de lib/resultados.js; heuristicas: [{clave, corto}] en el orden de la tabla;
 * gurobiDe(fila, variante): corrida de Gurobi de una fila. Devuelve {nodo, pintar(opciones), destruir}.
 * opciones: {variante, textoVariante, h ('todos' o un valor), grupo ({n, banco} de la tabla)}.
 */
export function graficoTiempos({ instancias, heuristicas, gurobiDe }) {
  const uid = ++contador;
  const series = [{ clave: 'gurobi', nombre: 'Gurobi' }, ...heuristicas.map((h) => ({ clave: h.clave, nombre: h.corto }))]
    .map((s) => ({ ...s, familia: familia(s.clave), heuristica: s.clave.endsWith('_heuristico') }));

  const titulo = el('h3', { class: 'tarjeta__titulo', id: `rend-esc-titulo-${uid}` }, 'Tiempo de ejecución según n');
  const bajada = el('p', { class: 'rend-bajada' });
  const leyenda = el('ul', { class: 'rend-esc__leyenda', 'aria-label': 'Métodos' });
  const marco = el('div', { class: 'rend-esc__grafico' });
  const tablaDatos = el('div', { class: 'tabla-desplazable' });
  const nodo = el('article', { class: 'tarjeta rend-tarjeta rend-esc', 'aria-labelledby': titulo.id },
    titulo, bajada, leyenda, marco,
    el('details', { class: 'rend-esc__datos' }, el('summary', {}, 'Ver los datos en una tabla'), tablaDatos));

  const ctx = gsap.context(() => {}, nodo);
  const st = { opciones: null, datos: [], grupos: [], ancho: 0, temporizador: 0, animado: false };
  const ro = new ResizeObserver(() => {
    clearTimeout(st.temporizador);
    st.temporizador = setTimeout(() => {
      if (!st.opciones || Math.abs(marco.clientWidth - st.ancho) <= 1) return;
      dibujar();
    }, 160);
  });
  ro.observe(marco);

  return {
    nodo,
    pintar(opciones) {
      st.opciones = opciones;
      calcular();
      textos();
      dibujar();
    },
    destruir() {
      ro.disconnect();
      clearTimeout(st.temporizador);
      ocultarTooltip();
      ctx.revert();
    },
  };

  /** Promedio por n de cada método, con el h de la tabla. */
  function calcular() {
    const { variante, h } = st.opciones;
    const filas = instancias.filter((f) => h === 'todos' || f.h === h);
    st.grupos = [...new Map(filas.map((f) => [`${f.banco}|${f.n}`, { n: f.n, banco: f.banco }])).values()]
      .sort((a, b) => a.n - b.n || a.banco.localeCompare(b.banco))
      .map((g) => ({ ...g, filas: filas.filter((f) => f.n === g.n && f.banco === g.banco) }));
    st.datos = series.map((s) => ({
      ...s,
      puntos: st.grupos.map((g) => {
        const valores = g.filas
          .map((f) => (s.clave === 'gurobi' ? gurobiDe(f, variante)?.segundos : f.heuristicas[s.clave]?.segundos))
          .filter((v) => v != null && v > 0);
        return { n: g.n, banco: g.banco, valor: valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null, cantidad: valores.length };
      }).filter((p) => p.valor != null),
    }));
  }

  function textos() {
    const { textoVariante, h } = st.opciones;
    const cantidades = [...new Set(st.grupos.map((g) => g.filas.length))];
    const porN = cantidades.length === 1 ? ` (${cantidades[0]} por n${h === 'todos' ? '' : `, con h = ${fmt(h)}`})` : h === 'todos' ? '' : ` con h = ${fmt(h)}`;
    bajada.innerHTML = `Tiempo promedio de las instancias de cada n${porN}; en las heurísticas, el promedio de sus réplicas. `
      + `Gurobi va con la variante elegida en la tabla (${textoVariante.toLowerCase()}) y se detiene a los 3 600 s. `
      + 'La escala vertical es logarítmica: cada línea de la grilla multiplica el tiempo por 10. '
      + 'Trazo continuo, evaluación exacta; discontinuo, heurística. La franja marca el n de la tabla.';
    leyenda.replaceChildren(...series.map((s) => el('li', {}, muestra(s),
      el('span', {}, s.nombre, s.clave === 'gurobi' ? el('span', { class: 'rend-esc__nota' }, ` · ${textoVariante}`) : null))));
    // Los mismos datos, en una tabla
    tablaDatos.replaceChildren(el('table', { class: 'tabla rend-esc__tabla' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'n'), el('th', { scope: 'col' }, 'Banco'), el('th', { scope: 'col' }, 'Instancias'),
        series.map((s) => el('th', { scope: 'col' }, s.nombre)))),
      el('tbody', {}, st.grupos.map((g) => el('tr', { class: g.n === st.opciones.grupo.n && g.banco === st.opciones.grupo.banco ? 'resaltado' : '' },
        el('td', {}, String(g.n)), el('td', {}, g.banco), el('td', {}, String(g.filas.length)),
        st.datos.map((s) => {
          const p = s.puntos.find((q) => q.n === g.n && q.banco === g.banco);
          return el('td', {}, p ? `${segundos(p.valor)} s` : '—');
        }))))));
  }

  function dibujar() {
    const d3 = window.d3;
    const { grupo } = st.opciones;
    const W = Math.max(300, marco.clientWidth);
    st.ancho = marco.clientWidth;
    const angosto = W < 620;
    const m = { izq: angosto ? 50 : 62, der: angosto ? 14 : 158, sup: 30, inf: 46 };
    const H = angosto ? 320 : 400;
    const valores = st.datos.flatMap((s) => s.puntos.map((p) => p.valor));
    if (!valores.length) {
      marco.replaceChildren(el('p', { class: 'rend-bajada' }, 'No hay tiempos para este filtro.'));
      return;
    }
    const lo = Math.floor(Math.log10(Math.min(...valores)));
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...valores))));
    const y = d3.scaleLog().domain([10 ** lo, 10 ** hi]).range([H - m.inf, m.sup]);
    const ns = [...new Set(st.grupos.map((g) => g.n))];
    const x = d3.scaleLinear().domain(d3.extent(ns)).range([m.izq + 16, W - m.der - 16]);
    const paso = ns.length > 1 ? Math.min(...ns.slice(1).map((n, i) => x(n) - x(ns[i]))) : 40;
    const abajo = H - m.inf;

    const raiz = svg('svg', {
      class: 'rend-esc__svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': `Tiempo promedio de ejecución según n, en escala logarítmica, para ${series.map((s) => s.nombre).join(', ')}. Los datos están en la tabla bajo el gráfico.`,
    });
    const idClip = `rend-esc-clip-${uid}`;
    const rectClip = svg('rect', { x: 0, y: 0, width: W, height: H });
    raiz.append(svg('defs', {}, svg('clipPath', { id: idClip }, rectClip)));

    // Franja del n de la tabla
    if (ns.includes(grupo.n)) {
      raiz.append(svg('rect', { class: 'rend-esc__franja', x: x(grupo.n) - Math.min(18, paso / 2.2), y: m.sup - 8, width: 2 * Math.min(18, paso / 2.2), height: abajo - m.sup + 8, rx: 6 }));
    }

    // Grilla y eje y: una línea por potencia de 10
    const potencias = d3.range(lo, hi + 1);
    raiz.append(svg('g', { class: 'rend-esc__grilla' },
      potencias.map((e) => svg('line', { x1: m.izq, x2: W - m.der, y1: y(10 ** e), y2: y(10 ** e) }))));
    raiz.append(svg('g', { class: 'rend-esc__eje' },
      potencias.map((e) => svg('text', { x: m.izq - 8, y: y(10 ** e), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, segundos(10 ** e))),
      svg('text', { class: 'rend-esc__titulo-eje', x: m.izq - 8, y: m.sup - 16, 'text-anchor': 'end' }, 's')));

    // Límite de tiempo de Gurobi: el rótulo va bajo la línea, a la derecha, donde Gurobi ya está plano
    if (LIMITE_GUROBI >= 10 ** lo && LIMITE_GUROBI <= 10 ** hi) {
      raiz.append(svg('g', { class: 'rend-esc__limite' },
        svg('line', { x1: m.izq, x2: W - m.der, y1: y(LIMITE_GUROBI), y2: y(LIMITE_GUROBI) }),
        svg('text', { x: x(ns.at(-1)) - 8, y: y(LIMITE_GUROBI) + 15, 'text-anchor': 'end' }, 'límite de Gurobi: 3 600 s')));
    }

    // Cambio de banco (Battarra hasta n = 25, Erdogan desde n = 30)
    const bancos = [...new Set(st.grupos.map((g) => g.banco))];
    if (bancos.length === 2) {
      const ultimo = Math.max(...st.grupos.filter((g) => g.banco === bancos[0]).map((g) => g.n));
      const primero = Math.min(...st.grupos.filter((g) => g.banco === bancos[1]).map((g) => g.n));
      if (ultimo < primero) {
        const xb = (x(ultimo) + x(primero)) / 2;
        raiz.append(svg('g', { class: 'rend-esc__banco' },
          svg('line', { x1: xb, x2: xb, y1: m.sup - 18, y2: abajo }),
          svg('text', { x: xb - 6, y: m.sup - 20, 'text-anchor': 'end' }, `banco ${bancos[0]}`),
          svg('text', { x: xb + 6, y: m.sup - 20 }, `banco ${bancos[1]}`)));
      }
    }

    // Eje x
    raiz.append(svg('g', { class: 'rend-esc__eje' },
      svg('line', { class: 'rend-esc__base', x1: m.izq, x2: W - m.der, y1: abajo, y2: abajo }),
      ns.map((n) => svg('text', { class: n === grupo.n ? 'rend-esc__actual' : null, x: x(n), y: abajo + 18, 'text-anchor': 'middle' }, String(n))),
      svg('text', { class: 'rend-esc__titulo-eje', x: (m.izq + W - m.der) / 2, y: H - 6, 'text-anchor': 'middle' }, 'n (clientes)')));

    // Líneas y puntos; Gurobi al final para que quede encima
    const linea = d3.line().x((p) => x(p.n)).y((p) => y(p.valor));
    const orden = [...st.datos.slice(1), st.datos[0]];
    const capa = svg('g', { 'clip-path': `url(#${idClip})` },
      orden.map((s) => svg('g', { class: `rend-esc__serie rend-esc__serie--${s.familia}${s.heuristica ? ' rend-esc__serie--heuristica' : ''}` },
        svg('path', { class: 'rend-esc__linea', d: linea(s.puntos) }),
        s.puntos.map((p) => svg('circle', { class: 'rend-esc__punto', cx: x(p.n), cy: y(p.valor), r: 4, 'data-n': p.n })))));
    raiz.append(capa);

    // Rótulos al final de cada línea, separados al menos 15 px, con una guía si se movieron
    if (!angosto) {
      const rotulos = st.datos.filter((s) => s.puntos.length).map((s) => {
        const p = s.puntos.at(-1);
        return { s, p, x: x(p.n), y0: y(p.valor), y: y(p.valor) };
      }).sort((a, b) => a.y0 - b.y0);
      const sep = 15;
      for (let i = 1; i < rotulos.length; i++) rotulos[i].y = Math.max(rotulos[i].y, rotulos[i - 1].y + sep);
      for (let i = rotulos.length - 1; i >= 0; i--) {
        rotulos[i].y = Math.min(rotulos[i].y, i === rotulos.length - 1 ? abajo : rotulos[i + 1].y - sep);
      }
      raiz.append(svg('g', { class: 'rend-esc__rotulos' }, rotulos.map((r) => svg('g', {
        class: `rend-esc__serie--${r.s.familia}${r.s.heuristica ? ' rend-esc__serie--heuristica' : ''}`,
      },
      svg('path', { class: 'rend-esc__guia', d: `M${r.x + 7},${r.y0} L${r.x + 14},${r.y} H${r.x + 18}` }),
      svg('text', { class: 'rend-esc__rotulo', x: r.x + 22, y: r.y, 'dominant-baseline': 'middle' },
        r.s.nombre, svg('tspan', { class: 'rend-esc__rotulo-valor', dx: 6 }, `${segundos(r.p.valor)} s`))))));
    }

    // Interacción: una zona por n con guía vertical y tooltip con los seis tiempos
    const guia = svg('line', { class: 'rend-esc__cursor', x1: 0, x2: 0, y1: m.sup - 8, y2: abajo, visibility: 'hidden' });
    raiz.append(guia);
    const bordes = ns.map((n, i) => [i ? (x(ns[i - 1]) + x(n)) / 2 : m.izq, i < ns.length - 1 ? (x(n) + x(ns[i + 1])) / 2 : W - m.der]);
    raiz.append(svg('g', { class: 'rend-esc__zonas' }, ns.map((n, i) => {
      const zona = svg('rect', { x: bordes[i][0], y: m.sup - 8, width: bordes[i][1] - bordes[i][0], height: abajo - m.sup + 8 });
      const encender = (e) => {
        guia.setAttribute('x1', x(n));
        guia.setAttribute('x2', x(n));
        guia.setAttribute('visibility', 'visible');
        for (const c of capa.querySelectorAll('.rend-esc__punto')) c.classList.toggle('rend-esc__punto--activo', Number(c.dataset.n) === n);
        mostrarTooltip(tooltip(n), e);
      };
      zona.addEventListener('pointerenter', encender);
      zona.addEventListener('pointermove', moverTooltip);
      zona.addEventListener('pointerleave', () => {
        guia.setAttribute('visibility', 'hidden');
        for (const c of capa.querySelectorAll('.rend-esc__punto--activo')) c.classList.remove('rend-esc__punto--activo');
        ocultarTooltip();
      });
      return zona;
    })));

    marco.replaceChildren(raiz);

    // Las líneas se trazan de izquierda a derecha la primera vez que la tarjeta entra en pantalla
    if (!st.animado && !movimientoReducido()) {
      st.animado = true;
      ctx.add(() => gsap.fromTo(rectClip, { attr: { width: 0 } }, {
        attr: { width: W }, duration: 1.6, ease: 'power2.out',
        scrollTrigger: { trigger: marco, start: 'top 85%', once: true },
      }));
    }
  }

  function tooltip(n) {
    const g = st.grupos.find((q) => q.n === n);
    const filas = st.datos.map((s) => ({ s, p: s.puntos.find((q) => q.n === n) })).filter((d) => d.p)
      .sort((a, b) => b.p.valor - a.p.valor);
    return `<strong>n = ${n} · banco ${g.banco}</strong> · ${g.filas.length} instancias<br>`
      + filas.map(({ s, p }) => `<span class="rend-esc__clave rend-esc__serie--${s.familia}${s.heuristica ? ' rend-esc__serie--heuristica' : ''}"></span>`
        + `${s.nombre}: ${segundos(p.valor)} s`).join('<br>');
  }
}
