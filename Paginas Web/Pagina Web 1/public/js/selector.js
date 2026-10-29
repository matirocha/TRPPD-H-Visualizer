// Selector de soluciones.
//
// Barra superior: un botón con la solución actual abre un panel flotante.
// Sección Instancia: el mismo panel, fijo en la página.
// El panel abre con tres datos grandes (ID de instancia, n y la función
// objetivo Σ D) y debajo una fila de botones por dimensión (ID, n, h,
// algoritmo). Si una combinación no existe en Outputs se elige la más parecida
// y su botón se ve atenuado. Para el modelo de Gurobi, dos interruptores
// agregan las restricciones (20)-(23) y (24)-(29) a (1)-(19).
import { VARIANTES, claveVariante, el, fmt } from './util.js';

const DIMENSIONES = [
  {
    clave: 'inst', etiqueta: 'ID de instancia', ayuda: 'Instancia 1 a 10 de e_vigo',
    valor: (s) => s.instancia.id ?? s.instancia.nombre, texto: (v) => String(v),
  },
  {
    clave: 'n', etiqueta: 'Clientes n', ayuda: 'n = |V<sub>c</sub>|',
    valor: (s) => s.instancia.n, texto: (v) => String(v),
  },
  {
    clave: 'h', etiqueta: 'Manipulación h', ayuda: 'h = h<sub>a</sub> = h<sub>b</sub>',
    valor: (s) => s.instancia.h ?? '—', texto: (v) => (typeof v === 'number' ? fmt(v) : v),
  },
  {
    clave: 'alg', etiqueta: 'Algoritmo', ayuda: 'Quién resolvió',
    valor: (s) => s.algoritmo.clave, texto: (_, s) => nombreCorto(s.algoritmo.nombre),
  },
  {
    clave: 'var', etiqueta: 'Restricciones', ayuda: '(1)–(19) siempre',
    valor: (s) => claveVariante(s.algoritmo.variante) ?? SIN_VARIANTE, texto: (v) => v,
  },
];

// Prioridad al buscar la solución más parecida: el algoritmo se conserva antes que la
// instancia, y la instancia antes que las restricciones.
const PRIORIDAD = ['alg', 'n', 'inst', 'h', 'var'];

// Algoritmos sin variantes (enumeración, etc.): coinciden con cualquier combinación de interruptores.
const SIN_VARIANTE = '—';
const coincide = (dim, a, b) => a === b || (dim === 'var' && (a === SIN_VARIANTE || b === SIN_VARIANTE));
const INTERRUPTORES = [
  { indice: 0, numeros: '(20)–(23)', nombre: 'Explicitación de las cargas' },
  { indice: 1, numeros: '(24)–(29)', nombre: 'Desigualdad de latencia' },
];

const ESTADOS = { OPTIMAL: 'óptima', TIME_LIMIT: 'límite de tiempo', SUBOPTIMAL: 'subóptima', FEASIBLE: 'factible' };

const claveDe = (s) => Object.fromEntries(DIMENSIONES.map((d) => [d.clave, d.valor(s)]));
const ordenar = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
const nombreCorto = (nombre) => nombre.split(' · ')[0];
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
      const p = PRIORIDAD.reduce((suma, c, i) => suma + (coincide(c, k[c], deseada[c]) ? 2 ** (PRIORIDAD.length - i) : 0), 0);
      if (p > puntaje) {
        mejor = s;
        puntaje = p;
      }
    }
    return { salida: mejor, exacta: puntaje === 2 ** (PRIORIDAD.length + 1) - 2 };
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
    return el('button', {
      type: 'button',
      class: `selector-opcion${exacta ? '' : ' selector-opcion--aproximada'}`,
      'aria-pressed': String(elegida),
      dataset: { dim: d.clave, valor: String(valor) },
      title: exacta ? `Σ D = ${sigma(salida?.objetivo)}` : 'No hay esta combinación en Outputs: se abre la más parecida',
      onclick: () => {
        if (salida && salida.archivo !== actual) alElegir(salida.archivo);
      },
    }, texto);
  }

  /** Interruptores (20)-(23) y (24)-(29): cada uno cambia un dígito de la clave de variante. */
  function interruptores(clave) {
    const bits = clave.var === SIN_VARIANTE ? null : clave.var;
    const botones = INTERRUPTORES.map(({ indice, numeros, nombre }) => {
      const activo = bits?.[indice] === '1';
      const nuevo = bits && [...bits].map((b, i) => (i === indice ? (activo ? '0' : '1') : b)).join('');
      const { salida, exacta } = nuevo ? buscar({ ...clave, var: nuevo }) : { salida: null, exacta: false };
      const titulo = !bits
        ? 'Solo para el modelo de Gurobi'
        : exacta
          ? `${activo ? 'Quitar' : 'Agregar'} ${numeros}: ${fmt(salida.segundos, 3)} s en Gurobi`
          : 'No hay esta combinación en Outputs para esta instancia';
      return el('button', {
        type: 'button',
        role: 'switch',
        class: 'selector-interruptor',
        'aria-checked': String(activo),
        disabled: !bits || !exacta,
        dataset: { dim: 'var', valor: String(indice) },
        title: titulo,
        onclick: () => {
          if (exacta && salida.archivo !== actual) alElegir(salida.archivo);
        },
      },
      el('span', { class: 'selector-interruptor__pista', 'aria-hidden': 'true' }, el('span', { class: 'selector-interruptor__perilla' })),
      el('span', { class: 'selector-interruptor__texto' },
        el('span', { class: 'selector-interruptor__numeros num' }, numeros),
        el('span', { class: 'selector-interruptor__nombre' }, nombre)));
    });
    const modelo = VARIANTES.find((v) => v.clave === bits);
    return [...botones,
      el('span', { class: 'selector-interruptor__modelo' }, modelo ? `Modelo ${modelo.etiqueta}` : 'Sin variantes en este algoritmo')];
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

  const flecha = (destino, texto, simbolo) => el('button', {
    type: 'button', class: 'selector-flecha', 'aria-label': texto, title: texto, disabled: !destino,
    onclick: () => destino && alElegir(destino.archivo),
  }, el('span', { 'aria-hidden': 'true' }, simbolo));

  /** Los tres datos que identifican la solución: ID, n y Σ D. */
  function resumen(s, clave) {
    const ids = valoresDe(DIMENSIONES[0]).length;
    const dato = (modificador, etiqueta, valor, nota) => el('div', { class: `selector-dato selector-dato--${modificador}` },
      el('span', { class: 'selector-dato__etiqueta', html: etiqueta }),
      el('span', { class: 'selector-dato__valor num' }, valor),
      el('span', { class: 'selector-dato__nota' }, nota));
    return el('div', { class: 'selector-datos' },
      dato('id', 'ID de instancia', String(clave.inst), `instancia ${clave.inst} de ${ids} del banco e_vigo`),
      dato('n', 'Clientes', `n = ${clave.n}`, el('span', { html: 'a visitar, |V<sub>c</sub>|' })),
      dato('obj', 'Función objetivo Σ D<sub>i</sub>', sigma(s.objetivo),
        el('span', {}, 'espera total',
          s.estado ? el('span', { class: 'selector-dato__estado' }, ESTADOS[s.estado] ?? s.estado.toLowerCase()) : null)));
  }

  function panel(flotante) {
    const s = manifest.find((x) => x.archivo === actual);
    if (!s) return [];
    const clave = claveDe(s);
    const hayVariantes = manifest.some((x) => x.algoritmo.variante);
    const filas = DIMENSIONES.filter((d) => d.clave !== 'var' || hayVariantes).map((d) => {
      const id = `selector-${uid}-${flotante ? 'f' : 'l'}-${d.clave}`;
      let opciones;
      if (d.clave === 'var') opciones = interruptores(clave);
      else {
        const botones = valoresDe(d).map((o) => opcion(d, clave, o));
        opciones = d.clave === 'inst'
          ? [flecha(vecina(clave, -1), 'Instancia anterior', '←'), ...botones, flecha(vecina(clave, 1), 'Instancia siguiente', '→')]
          : botones;
      }
      return el('div', { class: `selector-fila selector-fila--${d.clave}`, role: 'group', 'aria-labelledby': id },
        el('div', { class: 'selector-fila__rotulo', id },
          el('span', { class: 'selector-fila__etiqueta' }, d.etiqueta),
          el('span', { class: 'selector-fila__ayuda', html: d.ayuda })),
        el('div', { class: 'selector-fila__opciones' }, opciones));
    });

    return [
      el('div', { class: 'selector-panel__cabecera' },
        el('p', { class: 'selector-panel__titulo' }, flotante ? 'Elegir solución' : 'Solución mostrada'),
        el('p', { class: 'selector-panel__algoritmo' }, s.algoritmo.nombre),
        flotante ? el('button', { type: 'button', class: 'selector-cerrar', 'aria-label': 'Cerrar', title: 'Cerrar', onclick: () => cerrar(true) },
          el('span', { 'aria-hidden': 'true' }, '×')) : null),
      resumen(s, clave),
      el('div', { class: 'selector-filas' }, filas),
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
    const id = i.id ?? i.nombre;
    const h = i.h != null ? `, h ${fmt(i.h)}` : '';
    boton.setAttribute('aria-label', `Solución: ID ${id}, n ${i.n}, Σ D ${sigma(s.objetivo)} (${s.algoritmo.nombre}${h}). Cambiar solución`);
    boton.title = `${s.algoritmo.nombre}${h}`;
    const dato = (modificador, etiqueta, valor) => el('span', { class: `selector-boton__dato selector-boton__dato--${modificador}`, 'aria-hidden': 'true' },
      el('span', { class: 'selector-boton__etiqueta' }, etiqueta),
      el('span', { class: 'selector-boton__valor num' }, valor));
    boton.replaceChildren(
      dato('id', 'ID', String(id)),
      dato('n', 'n', String(i.n)),
      dato('obj', 'Σ D', sigma(s.objetivo)),
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
