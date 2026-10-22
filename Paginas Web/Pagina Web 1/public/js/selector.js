// Selector de soluciones.
//
// Barra superior: un botón con la solución actual abre un panel flotante.
// Sección Instancia: el mismo panel, fijo en la página.
// El panel tiene una fila por dimensión (algoritmo, n, instancia, h) y cada
// opción muestra el Σ D de la solución a la que lleva; si esa combinación no
// existe en Outputs se elige la más parecida y la opción se ve atenuada.
import { el, fmt } from './util.js';

const DIMENSIONES = [
  { clave: 'alg', etiqueta: 'Algoritmo', valor: (s) => s.algoritmo.clave, texto: (_, s) => s.algoritmo.nombre },
  { clave: 'n', etiqueta: 'Clientes |V_c|', valor: (s) => s.instancia.n, texto: (v) => `n = ${v}` },
  { clave: 'inst', etiqueta: 'Instancia', valor: (s) => s.instancia.id ?? s.instancia.nombre, texto: (v) => (typeof v === 'number' ? String(v) : v) },
  { clave: 'h', etiqueta: 'Manipulación h = h_a = h_b', valor: (s) => s.instancia.h ?? '—', texto: (v) => (typeof v === 'number' ? `h ${fmt(v)}` : v) },
];

const ESTADOS = { OPTIMAL: 'óptima', TIME_LIMIT: 'límite de tiempo', SUBOPTIMAL: 'subóptima', FEASIBLE: 'factible' };

const claveDe = (s) => Object.fromEntries(DIMENSIONES.map((d) => [d.clave, d.valor(s)]));
const conSub = (texto) => texto.replace(/_([a-z])/g, '<sub>$1</sub>');
const ordenar = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
const nombreCorto = (nombre) => nombre.split(' · ')[0];
const monograma = (nombre) => nombre.trim().charAt(0).toUpperCase();
const sigma = (v) => (v == null ? '—' : fmt(v));

let contador = 0;

/**
 * barra: contenedor del botón en la barra superior; enLinea: contenedor del panel fijo.
 * alElegir(archivo) se llama al elegir una solución; luego main.js llama pintar().
 */
export function crearSelector({ barra, enLinea, alElegir }) {
  const uid = ++contador;
  let manifest = [];
  let actual = null;
  let abierto = false;

  /** Coincidencia exacta o, si no existe, la que comparte más dimensiones en orden de prioridad. */
  function buscar(deseada) {
    let mejor = null;
    let puntaje = -1;
    for (const s of manifest) {
      const k = claveDe(s);
      const p = DIMENSIONES.reduce((suma, d, i) => suma + (k[d.clave] === deseada[d.clave] ? 2 ** (DIMENSIONES.length - i) : 0), 0);
      if (p > puntaje) {
        mejor = s;
        puntaje = p;
      }
    }
    return { salida: mejor, exacta: puntaje === 2 ** (DIMENSIONES.length + 1) - 2 };
  }

  function valoresDe(d) {
    const valores = new Map();
    for (const s of manifest) {
      const v = d.valor(s);
      if (!valores.has(v)) valores.set(v, d.texto(v, s));
    }
    return [...valores.keys()].sort(ordenar).map((v) => ({ valor: v, texto: valores.get(v) }));
  }

  // --- Panel (compartido por el flotante y el de la sección) --------------------

  function opcion(d, clave, { valor, texto }) {
    const { salida, exacta } = buscar({ ...clave, [d.clave]: valor });
    const elegida = clave[d.clave] === valor;
    const comun = {
      type: 'button',
      'aria-pressed': String(elegida),
      dataset: { dim: d.clave, valor: String(valor) },
      title: exacta ? null : 'No hay esta combinación en Outputs: se abre la más parecida',
      onclick: () => {
        if (salida && salida.archivo !== actual) alElegir(salida.archivo);
      },
    };
    const objetivo = exacta ? salida?.objetivo : null;
    if (d.clave === 'alg') {
      return el('button', { ...comun, class: `selector-opcion selector-opcion--alg${exacta ? '' : ' selector-opcion--aproximada'}` },
        el('span', { class: 'selector-monograma', 'aria-hidden': 'true' }, monograma(texto)),
        el('span', { class: 'selector-opcion__texto' }, texto),
        el('span', { class: 'selector-opcion__valor num' }, `Σ D ${sigma(objetivo)}`));
    }
    return el('button', { ...comun, class: `selector-opcion selector-opcion--ficha${exacta ? '' : ' selector-opcion--aproximada'}` },
      el('span', { class: 'selector-opcion__texto' }, texto),
      el('span', { class: 'selector-opcion__valor num' }, sigma(objetivo)));
  }

  /** Instancia anterior o siguiente con las demás dimensiones fijas. */
  function vecina(clave, paso) {
    const d = DIMENSIONES.find((x) => x.clave === 'inst');
    const valores = valoresDe(d).map((o) => o.valor);
    const i = valores.indexOf(clave.inst);
    const j = i + paso;
    if (i < 0 || j < 0 || j >= valores.length) return null;
    return buscar({ ...clave, inst: valores[j] }).salida;
  }

  function panel(flotante) {
    const s = manifest.find((x) => x.archivo === actual);
    if (!s) return [];
    const clave = claveDe(s);
    const grupos = DIMENSIONES.map((d) => {
      const opciones = valoresDe(d);
      const id = `selector-${uid}-${flotante ? 'f' : 'l'}-${d.clave}`;
      const botones = opciones.map((o) => opcion(d, clave, o));
      // Barras proporcionales a Σ D en las fichas de instancia: se comparan de un vistazo.
      if (d.clave === 'inst') {
        const objetivos = opciones.map((o) => {
          const { salida, exacta } = buscar({ ...clave, inst: o.valor });
          return exacta ? salida.objetivo ?? 0 : 0;
        });
        const maximo = Math.max(...objetivos);
        botones.forEach((b, i) => b.append(el('span', {
          class: 'selector-opcion__barra',
          style: { '--escala': maximo > 0 ? (objetivos[i] / maximo).toFixed(3) : '0' },
          'aria-hidden': 'true',
        })));
      }
      return el('div', { class: `selector-grupo selector-grupo--${d.clave}`, role: 'group', 'aria-labelledby': id },
        el('span', { class: 'selector-grupo__etiqueta', id, html: conSub(d.etiqueta) }),
        el('div', { class: 'selector-grupo__opciones' }, botones));
    });

    const anterior = vecina(clave, -1);
    const siguiente = vecina(clave, 1);
    const flecha = (destino, texto, simbolo) => el('button', {
      type: 'button', class: 'selector-flecha', 'aria-label': texto, title: texto, disabled: !destino,
      onclick: () => destino && alElegir(destino.archivo),
    }, el('span', { 'aria-hidden': 'true' }, simbolo));

    return [
      el('div', { class: 'selector-panel__cabecera' },
        el('div', { class: 'selector-panel__resumen' },
          el('p', { class: 'selector-panel__titulo' }, flotante ? 'Elegir solución' : 'Solución mostrada'),
          el('p', { class: 'selector-panel__objetivo' },
            el('span', { class: 'num' }, `Σ D = ${sigma(s.objetivo)}`),
            s.estado ? el('span', { class: 'selector-panel__estado' }, ESTADOS[s.estado] ?? s.estado.toLowerCase()) : null)),
        el('div', { class: 'selector-panel__acciones' },
          flecha(anterior, 'Instancia anterior', '←'),
          flecha(siguiente, 'Instancia siguiente', '→'),
          flotante ? el('button', { type: 'button', class: 'selector-flecha', 'aria-label': 'Cerrar', title: 'Cerrar', onclick: () => cerrar(true) },
            el('span', { 'aria-hidden': 'true' }, '×')) : null)),
      ...grupos,
      el('p', { class: 'selector-panel__archivo' }, `Outputs/${actual}`, el('span', {}, `${manifest.length} soluciones`)),
    ];
  }

  /** Repinta conservando el foco en la misma opción (el clic reconstruye el panel). */
  function repintar(contenedor, flotante) {
    const enfocado = contenedor.contains(document.activeElement) ? document.activeElement : null;
    const pista = enfocado?.dataset?.dim ? `[data-dim="${enfocado.dataset.dim}"][data-valor="${CSS.escape(enfocado.dataset.valor)}"]` : null;
    const indiceFlecha = enfocado?.classList.contains('selector-flecha') ? [...contenedor.querySelectorAll('.selector-flecha')].indexOf(enfocado) : -1;
    contenedor.replaceChildren(...panel(flotante));
    let destino = pista ? contenedor.querySelector(pista) : null;
    if (!destino && indiceFlecha >= 0) destino = contenedor.querySelectorAll('.selector-flecha')[indiceFlecha];
    if (enfocado && destino && !destino.disabled) destino.focus({ preventScroll: true });
  }

  // --- Botón y panel flotante de la barra ----------------------------------------

  const idPanel = `selector-flotante-${uid}`;
  const boton = el('button', {
    type: 'button', class: 'selector-boton', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': idPanel,
    onclick: () => (abierto ? cerrar(false) : abrir()),
  });
  const flotante = el('div', { class: 'selector-panel selector-panel--flotante', id: idPanel, role: 'dialog', 'aria-label': 'Elegir solución' });
  barra.replaceChildren(boton, flotante);

  function pintarBoton() {
    const s = manifest.find((x) => x.archivo === actual);
    if (!s) return;
    const i = s.instancia;
    const detalle = [i.id != null ? `id ${i.id}` : i.nombre, `n ${i.n}`, i.h != null ? `h ${fmt(i.h)}` : null].filter(Boolean).join(' · ');
    boton.setAttribute('aria-label', `Solución: ${s.algoritmo.nombre}, ${detalle}, Σ D ${sigma(s.objetivo)}. Cambiar solución`);
    boton.replaceChildren(
      el('span', { class: 'selector-monograma', 'aria-hidden': 'true' }, monograma(s.algoritmo.nombre)),
      el('span', { class: 'selector-boton__texto', 'aria-hidden': 'true' },
        el('span', { class: 'selector-boton__alg' }, nombreCorto(s.algoritmo.nombre)),
        el('span', { class: 'selector-boton__detalle num' }, detalle)),
      el('span', { class: 'selector-boton__valor num', 'aria-hidden': 'true' }, `Σ D ${sigma(s.objetivo)}`),
      el('span', { class: 'selector-boton__flecha', 'aria-hidden': 'true' }));
  }

  function abrir() {
    abierto = true;
    boton.setAttribute('aria-expanded', 'true');
    flotante.dataset.abierto = '';
    repintar(flotante, true);
    (flotante.querySelector('[aria-pressed="true"]') ?? flotante.querySelector('button'))?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', fuera, true);
    document.addEventListener('keydown', teclas);
  }

  function cerrar(devolverFoco) {
    if (!abierto) return;
    abierto = false;
    boton.setAttribute('aria-expanded', 'false');
    delete flotante.dataset.abierto;
    document.removeEventListener('pointerdown', fuera, true);
    document.removeEventListener('keydown', teclas);
    if (devolverFoco) boton.focus({ preventScroll: true });
  }

  function fuera(e) {
    if (!barra.contains(e.target)) cerrar(false);
  }

  function teclas(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(true);
    }
  }

  return {
    pintar(lista, archivo) {
      manifest = lista;
      actual = archivo;
      pintarBoton();
      if (abierto) repintar(flotante, true);
      if (enLinea) {
        enLinea.classList.add('selector-panel', 'selector-panel--en-linea');
        repintar(enLinea, false);
      }
    },
  };
}
