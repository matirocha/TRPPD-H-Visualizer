// Punto de entrada: carga las soluciones, arma el selector (selector.js) y la
// sección de la instancia, y entrega la simulación a cada sección visual.
//
// Cada sección es un módulo con crear(raiz, estado) -> { render(sim, salida), destruir() }.
// render se llama cada vez que cambia la solución elegida, siempre después de destruir().
import { cargarManifest, cargarSalida } from './datos.js';
import { crearEstado } from './estado.js';
import { PARAMETROS, PARAMETRO_INFO, normalizar, simular } from './modelo.js';
import { $, $$, PARAM_HTML, avisar, el, fmt, movimientoReducido } from './util.js';
import { crearSelector } from './selector.js';
import * as intro from './intro.js';
import * as mapa from './mapa.js';
import * as camion from './camion.js';
import * as tiempos from './tiempos.js';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, MotionPathPlugin, SplitText);

const estado = crearEstado({ salida: null, sim: null, hover: null, modoNodo: 'tiempo', avance: null });
let manifest = [];
let archivoActual = null;
let modulos = [];
let selector = null;

// --- Sección Instancia ------------------------------------------------------

const valoresKpi = new Map();

function animarNumero(nodo, clave, valor, decimales = 2) {
  const desde = valoresKpi.get(clave) ?? 0;
  valoresKpi.set(clave, valor);
  if (movimientoReducido()) {
    nodo.textContent = fmt(valor, decimales);
    return;
  }
  const obj = { v: desde };
  gsap.to(obj, {
    v: valor,
    duration: 1.1,
    ease: 'power3.out',
    onUpdate: () => { nodo.textContent = fmt(obj.v, decimales); },
    scrollTrigger: desde === 0 ? { trigger: nodo, start: 'top 90%', once: true } : undefined,
  });
}

function kpi({ clase = '', etiqueta, clave, valor, decimales = 2, texto, nota, formula }) {
  const valorNodo = el('span', { class: 'kpi__valor' }, texto ?? fmt(valoresKpi.get(clave) ?? 0, decimales));
  const nodo = el('article', { class: `kpi ${clase}` },
    el('span', { class: 'kpi__etiqueta' }, etiqueta),
    valorNodo,
    nota ? el('p', { class: 'kpi__nota', html: nota }) : null,
    formula ? el('div', { class: 'kpi__formula', 'data-tex': formula }) : null);
  if (texto == null) animarNumero(valorNodo, clave, valor, decimales);
  return nodo;
}

function tex(raiz) {
  for (const nodo of $$('[data-tex]', raiz)) {
    if (window.katex) katex.render(nodo.dataset.tex, nodo, { throwOnError: false, displayMode: false });
    else nodo.textContent = nodo.dataset.tex;
  }
}

function renderInstancia(sim, salida) {
  const I = salida.instancia;
  const S = salida.solucion;

  $('#hero-instancia').replaceChildren(
    el('span', { class: 'hero__chip' }, salida.algoritmo.nombre),
    el('span', { class: 'hero__chip' }, `${I.nombre}`),
    el('span', { class: 'hero__chip hero__chip--fuerte' }, `Σ D`, el('sub', {}, 'i'), ` = ${fmt(sim.objetivo)}`));

  const kpis = $('#kpis');
  kpis.replaceChildren(
    kpi({
      clase: 'kpi--principal', etiqueta: 'Espera total de los clientes', clave: 'obj', valor: sim.objetivo,
      nota: `Suma de los instantes D<sub>i</sub> en que cada cliente termina de recibir su entrega. Es la función objetivo (1).`,
      formula: String.raw`\min \sum_{i \in V_c} D_i`,
    }),
    kpi({ etiqueta: 'Tiempo de viaje', clave: 'viaje', valor: sim.viaje, nota: `Σ c<sub>ij</sub> de la ruta, con el regreso al depósito.` }),
    kpi({ etiqueta: 'Regreso al depósito', clave: 'regreso', valor: sim.regreso, nota: 'Instante de llegada al depósito; no pesa en el objetivo.' }),
    kpi({ etiqueta: 'Manipulación adicional', clave: 'manip', valor: sim.manipulacionAdicional, nota: `Término de (31) en Battarra et al.: h<sub>b</sub>·z + q<sub>i</sub>.` }),
    kpi({
      etiqueta: 'Política 3', clave: 'pol', texto: `${sim.politicas.p1} · ${sim.politicas.p2}`,
      nota: `<span class="politica-chip politica-chip--p1">P1</span> en ${sim.politicas.p1} ${sim.politicas.p1 === 1 ? 'cliente' : 'clientes'} y <span class="politica-chip politica-chip--p2">P2</span> en ${sim.politicas.p2}.`,
    }));
  tex(kpis);

  // Tabla de clientes
  const filas = sim.paradas.map((p) => el('tr', {
    dataset: { cliente: p.cliente },
    onpointerenter: () => estado.set({ hover: p.cliente }),
    onpointerleave: () => estado.set({ hover: null }),
  },
    el('td', {}, String(p.k)),
    el('td', {}, el('span', { class: `cliente-chip ${p.politica === 1 ? '' : 'cliente-chip--p2'}` }, String(p.cliente))),
    el('td', {}, fmt(p.alpha)),
    el('td', {}, fmt(p.beta)),
    el('td', {}, el('span', { class: `politica-chip politica-chip--p${p.politica === 1 ? 1 : 2}` }, p.politica === 1 ? 'P1' : 'P2')),
    el('td', {}, fmt(p.c)),
    el('td', {}, fmt(p.T)),
    el('td', {}, el('strong', {}, fmt(p.D))),
    el('td', {}, fmt(p.F)),
    el('td', {}, fmt(p.servicio))));
  const encabezados = ['#', 'Cliente', 'α<sub>i</sub>', 'β<sub>i</sub>', 'Política', 'c<sub>ji</sub>', 'T<sub>i</sub> llegada', 'D<sub>i</sub> entrega', 'F<sub>i</sub> salida', 'F<sub>i</sub>−T<sub>i</sub>'];
  $('#tabla-clientes').replaceChildren(el('table', { class: 'tabla' },
    el('thead', {}, el('tr', {}, encabezados.map((h) => el('th', { scope: 'col', html: h })))),
    el('tbody', {}, filas),
    el('tfoot', {}, el('tr', {},
      el('td', { colspan: 7, html: 'Σ D<sub>i</sub>' }), el('td', {}, fmt(sim.objetivo)), el('td', {}), el('td', {})))));

  // Parámetros
  const rango = (p) => {
    const v = I[p].slice(1);
    const min = Math.min(...v);
    const max = Math.max(...v);
    return min === max ? fmt(min, 3) : `${fmt(min, 3)}–${fmt(max, 3)}`;
  };
  $('#parametros').replaceChildren(
    el('h3', { class: 'tarjeta__titulo' }, 'Parámetros de la instancia'),
    el('div', { class: 'parametros' }, PARAMETROS.map((p) => el('div', { class: 'parametro', style: { '--color': `var(--op-${p})` } },
      el('span', { class: 'parametro__nombre', html: PARAM_HTML[p] }),
      el('span', { class: 'parametro__valor' }, rango(p)),
      el('span', { class: 'parametro__detalle' }, PARAMETRO_INFO[p].detalle)))),
    el('dl', { class: 'datos-lista' },
      ...dato('Clientes n', I.n),
      ...dato('Capacidad Q', fmt(I.Q)),
      ...dato('Σ α (entregas)', fmt(sim.sumaAlpha)),
      ...dato('Σ β (recogidas)', fmt(sim.sumaBeta)),
      ...dato('Carga máxima a bordo', `${fmt(sim.cargaMaxima)} / ${fmt(I.Q)}`),
      ...(I.h != null ? dato('h = h_a = h_b', fmt(I.h, 3)) : [])));

  // Origen y verificación
  const v = sim.verificacion;
  const ok = v.ok && sim.avisos.length === 0;
  const alg = salida.algoritmo;
  const fecha = salida.generado ? new Date(salida.generado).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  $('#verificacion').replaceChildren(
    el('h3', { class: 'tarjeta__titulo' }, 'Origen y verificación'),
    el('dl', { class: 'datos-lista', style: { marginTop: 0 } },
      ...dato('Algoritmo', alg.nombre),
      ...(S.estado ? dato('Estado', S.estado) : []),
      ...(S.gap != null ? dato('Gap', `${fmt(S.gap * 100, 2)} %`) : []),
      ...(S.segundos != null ? dato('Tiempo de cómputo', `${fmt(S.segundos, 3)} s`) : []),
      ...(S.nodos != null ? dato('Nodos B&B', fmt(S.nodos, 0)) : []),
      ...(fecha ? dato('Generado', fecha) : [])),
    el('div', { class: `verificacion ${ok ? '' : 'verificacion--error'}`, style: { marginTop: '16px' } },
      el('p', { class: 'verificacion__estado' },
        el('span', { class: 'verificacion__icono', 'aria-hidden': 'true' }, ok ? '✓' : '!'),
        ok ? 'La simulación reproduce la solución' : 'Hay diferencias con la solución'),
      el('p', {}, ok
        ? `Al recorrer la ruta con la secuencia de la Tabla 3 se obtienen los mismos ${v.comparados} valores reportados (Σ D_i, T_i, D_i, F_i, q_i…).`
        : 'La página muestra los valores simulados con la secuencia de la Tabla 3.'),
      v.diferencias.length || sim.avisos.length
        ? el('ul', {}, [...v.diferencias.map((d) => el('li', {}, `${d.etiqueta}: ${fmt(d.simulado, 4)} vs ${fmt(d.reportado, 4)}`)), ...sim.avisos.map((a) => el('li', {}, a))])
        : null,
      v.cargasDistintas.length
        ? el('p', {}, 'Los flujos w, y, z reportados difieren de la carga física (sin las restricciones (20)–(23) no son únicos); se muestran los simulados.')
        : null));

  construirLeyenda();
}

function dato(etiqueta, valor) {
  return [el('dt', { html: etiqueta.replace(/_([a-z])/g, '<sub>$1</sub>') }), el('dd', {}, String(valor))];
}

function construirLeyenda() {
  const item = (clase, color, html) => el('li', {}, el('span', { class: `muestra ${clase}`, style: { '--color': color } }), el('span', { html }));
  $('#leyenda').replaceChildren(
    el('div', { class: 'leyenda__grupo' }, el('h4', {}, 'Carga a bordo'), el('ul', { class: 'leyenda__lista' },
      item('', 'var(--b-fondo)', '<strong>w</strong> · recogidas (b) al fondo'),
      item('', 'var(--a)', '<strong>y</strong> · entregas (a) pendientes'),
      item('', 'var(--b-puerta)', '<strong>z</strong> · recogidas (b) junto a la puerta'))),
    el('div', { class: 'leyenda__grupo' }, el('h4', {}, 'Tiempos'), el('ul', { class: 'leyenda__lista' },
      ...PARAMETROS.map((p) => item('', `var(--op-${p})`, `${PARAM_HTML[p]} · ${PARAMETRO_INFO[p].nombre.toLowerCase()}`)),
      item('muestra--linea', 'var(--viaje)', 'c<sub>ij</sub> · viaje'))),
    el('div', { class: 'leyenda__grupo' }, el('h4', {}, 'Nodos'), el('ul', { class: 'leyenda__lista' },
      item('muestra--cuadro', 'var(--deposito)', 'Depósito 0'),
      item('muestra--anillo', 'var(--p1)', 'Política 1 (s<sub>i</sub> = 1): recogidas junto a la puerta'),
      item('muestra--anillo', 'var(--p2)', 'Política 2 (s<sub>i</sub> = 0): recogidas al fondo'))));
}

// Resaltado compartido en la tabla
estado.on('hover', (cliente) => {
  for (const fila of $$('#tabla-clientes tbody tr')) fila.classList.toggle('resaltado', Number(fila.dataset.cliente) === cliente);
});

// --- Carga de soluciones ----------------------------------------------------

async function mostrar(archivo, { silencioso = false } = {}) {
  let salida;
  let sim;
  try {
    salida = normalizar(await cargarSalida(archivo), archivo);
    sim = simular(salida);
  } catch (error) {
    console.error(error);
    avisar(`No se pudo leer ${archivo}: ${error.message}`, 'error');
    return false;
  }
  archivoActual = archivo;
  const url = new URL(location.href);
  url.searchParams.set('s', archivo);
  history.replaceState(null, '', url);

  estado.set({ salida, sim, hover: null, avance: null });
  selector.pintar(manifest, archivo);
  renderInstancia(sim, salida);
  for (const m of modulos) {
    try {
      m.destruir?.();
      m.render(sim, salida);
    } catch (error) {
      console.error(error);
    }
  }
  // Las secciones recrean sus pines en cada render: se reordenan los ScrollTriggers según su
  // posición en la página para que los de navegación cuenten el espacio de esos pines.
  ScrollTrigger.sort();
  ScrollTrigger.refresh();
  if (!silencioso) document.title = `${salida.instancia.nombre} · TRPPD-H₃`;
  return true;
}

// --- Navegación y animaciones generales ------------------------------------

function iniciarNavegacion() {
  const barra = $('#barra');
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    refreshPriority: -1, // después de los pines, para que 'max' incluya su espacio
    onUpdate: (st) => {
      gsap.set('#progreso', { scaleX: st.progress });
      barra.classList.toggle('barra--con-borde', st.scroll() > 24);
    },
  });
  for (const enlace of $$('.barra__nav a')) {
    const seccion = $(enlace.getAttribute('href'));
    if (!seccion) continue;
    ScrollTrigger.create({
      trigger: seccion,
      start: 'top 45%',
      end: 'bottom 45%',
      onToggle: ({ isActive }) => enlace.setAttribute('aria-current', String(isActive)),
    });
  }
  // Los enlaces internos se desplazan con ScrollTo para respetar los pines de ScrollTrigger.
  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('a[href^="#"]');
    if (!enlace) return;
    const destino = $(enlace.getAttribute('href'));
    if (!destino) return;
    e.preventDefault();
    gsap.to(window, { duration: movimientoReducido() ? 0 : 1, scrollTo: { y: destino, offsetY: 64 }, ease: 'power2.inOut' });
  });
}

function iniciarRevelado() {
  if (movimientoReducido()) return;
  const nodos = $$('[data-revelar]');
  gsap.set(nodos, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(nodos, {
    start: 'top 88%',
    once: true,
    onEnter: (lote) => gsap.to(lote, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: true }),
  });
}

async function iniciar() {
  const aviso = $('#carga-inicial');
  try {
    manifest = await cargarManifest();
  } catch {
    manifest = [];
  }
  if (!manifest.length) {
    aviso.classList.add('carga-inicial--error');
    aviso.innerHTML = 'No se encontraron soluciones en <code>Outputs</code>.<br>Ejecuta <code>python correr_trppdh3.py --n 5 --explicitacion</code> desde <code>notebooks/</code> y recarga.';
    return;
  }

  selector = crearSelector({ barra: $('#selector-barra'), enLinea: $('#selector'), alElegir: (archivo) => mostrar(archivo) });

  // Mapa y carga comparten la escena fijada: la carga lleva el scroll y el mapa la sigue.
  modulos = [
    intro.crear({ hero: $('#hero-fondo'), problema: $('#problema-escena') }, estado),
    mapa.crear($('#mapa-escena'), estado, { vinculado: true }),
    camion.crear($('#carga-escena'), estado, { fijar: $('#recorrido-escena'), grafico: $('#carga-grafico') }),
    tiempos.crear($('#tiempos-escena'), estado),
  ];

  const pedido = new URL(location.href).searchParams.get('s');
  const inicial = manifest.find((s) => s.archivo === pedido)
    ?? manifest.find((s) => s.archivo === 'gurobi/vigo_n5_id1_h0.5.json')
    ?? manifest[0];
  iniciarNavegacion();
  await mostrar(inicial.archivo, { silencioso: true });
  iniciarRevelado();

  aviso.classList.add('carga-inicial--lista');
  // Las fuentes cambian las medidas: se recalculan los pines al terminar de cargarlas.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

iniciar();
