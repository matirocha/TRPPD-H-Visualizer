// Selector de soluciones: un botón en la barra que abre un panel con una fila
// por dimensión (algoritmo, n, instancia, h). Si la combinación elegida no
// existe en Outputs se abre la más parecida.
import { el, fmt } from './util.js';

const DIMENSIONES = [
  { clave: 'alg', etiqueta: 'Algoritmo', valor: (s) => s.algoritmo.clave, texto: (_, s) => s.algoritmo.nombre.split(' · ')[0] },
  { clave: 'n', etiqueta: 'Clientes', valor: (s) => s.instancia.n, texto: (v) => `n = ${v}` },
  { clave: 'inst', etiqueta: 'Instancia', valor: (s) => s.instancia.id ?? s.instancia.nombre, texto: (v) => String(v) },
  { clave: 'h', etiqueta: 'Manipulación h', valor: (s) => s.instancia.h ?? '—', texto: (v) => (typeof v === 'number' ? fmt(v) : v) },
];

const claveDe = (s) => Object.fromEntries(DIMENSIONES.map((d) => [d.clave, d.valor(s)]));
const ordenar = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

/** contenedor: lugar del botón en la barra. alElegir(archivo) se llama al elegir; luego main.js llama pintar(). */
export function crearSelector({ contenedor, alElegir }) {
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

  function elegir(archivo) {
    if (archivo && archivo !== actual) alElegir(archivo);
  }

  /** Instancia anterior o siguiente con las demás dimensiones fijas. */
  function vecina(clave, paso) {
    const valores = valoresDe(DIMENSIONES[2]).map((o) => o.valor);
    const j = valores.indexOf(clave.inst) + paso;
    if (j < 0 || j >= valores.length) return null;
    return buscar({ ...clave, inst: valores[j] }).salida;
  }

  const boton = el('button', {
    type: 'button', class: 'selector-boton', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    onclick: () => (abierto ? cerrar(false) : abrir()),
  });
  const panel = el('div', { class: 'selector-panel', role: 'dialog', 'aria-label': 'Elegir solución' });
  contenedor.replaceChildren(boton, panel);

  function pintarPanel() {
    const s = manifest.find((x) => x.archivo === actual);
    if (!s) return;
    const clave = claveDe(s);
    const enfocado = panel.contains(document.activeElement) ? document.activeElement.dataset.pista : null;

    const grupos = DIMENSIONES.map((d) => el('div', { class: 'selector-grupo' },
      el('span', { class: 'selector-grupo__etiqueta' }, d.etiqueta),
      el('div', { class: 'selector-grupo__opciones' }, valoresDe(d).map(({ valor, texto }) => {
        const { salida, exacta } = buscar({ ...clave, [d.clave]: valor });
        return el('button', {
          type: 'button',
          class: `selector-opcion${exacta ? '' : ' selector-opcion--aproximada'}`,
          'aria-pressed': String(clave[d.clave] === valor),
          title: exacta ? null : 'No existe esta combinación: se abre la más parecida',
          dataset: { pista: `${d.clave}:${valor}` },
          onclick: () => elegir(salida?.archivo),
        }, texto);
      }))));

    const anterior = vecina(clave, -1);
    const siguiente = vecina(clave, 1);
    const flecha = (destino, texto, simbolo) => el('button', {
      type: 'button', class: 'selector-flecha', 'aria-label': texto, title: texto, disabled: !destino,
      dataset: { pista: texto }, onclick: () => elegir(destino?.archivo),
    }, simbolo);

    panel.replaceChildren(
      el('div', { class: 'selector-panel__cabecera' },
        el('span', { class: 'selector-panel__titulo' }, 'Elegir solución'),
        flecha(anterior, 'Instancia anterior', '←'),
        flecha(siguiente, 'Instancia siguiente', '→')),
      ...grupos,
      el('p', { class: 'selector-panel__archivo' }, `Outputs/${actual}`));
    if (enfocado) panel.querySelector(`[data-pista="${CSS.escape(enfocado)}"]`)?.focus({ preventScroll: true });
  }

  function pintarBoton() {
    const s = manifest.find((x) => x.archivo === actual);
    if (!s) return;
    const i = s.instancia;
    const detalle = [i.id != null ? `id ${i.id}` : i.nombre, `n ${i.n}`, i.h != null ? `h ${fmt(i.h)}` : null].filter(Boolean).join(' · ');
    boton.setAttribute('aria-label', `Solución: ${s.algoritmo.nombre}, ${detalle}. Cambiar`);
    boton.replaceChildren(
      el('span', { class: 'selector-boton__alg' }, s.algoritmo.nombre.split(' · ')[0]),
      el('span', { class: 'selector-boton__detalle num' }, detalle),
      el('span', { class: 'selector-boton__icono', 'aria-hidden': 'true' }));
  }

  function abrir() {
    abierto = true;
    boton.setAttribute('aria-expanded', 'true');
    pintarPanel();
    panel.dataset.abierto = '';
    (panel.querySelector('[aria-pressed="true"]') ?? panel.querySelector('button'))?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', fuera, true);
    document.addEventListener('keydown', teclas);
  }

  function cerrar(devolverFoco) {
    if (!abierto) return;
    abierto = false;
    boton.setAttribute('aria-expanded', 'false');
    delete panel.dataset.abierto;
    document.removeEventListener('pointerdown', fuera, true);
    document.removeEventListener('keydown', teclas);
    if (devolverFoco) boton.focus({ preventScroll: true });
  }

  const fuera = (e) => {
    if (!contenedor.contains(e.target)) cerrar(false);
  };
  const teclas = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(true);
    }
  };

  return {
    pintar(lista, archivo) {
      manifest = lista;
      actual = archivo;
      pintarBoton();
      if (abierto) pintarPanel();
    },
  };
}
