// Utilidades compartidas: formato de números, creación de nodos DOM/SVG y tooltip único.

const NUMERO = new Map();

/** Número con coma decimal (es-CL) y hasta `decimales` cifras. */
export function fmt(valor, decimales = 2) {
  if (valor == null || Number.isNaN(valor)) return '—';
  if (!NUMERO.has(decimales)) {
    NUMERO.set(decimales, new Intl.NumberFormat('es-CL', { maximumFractionDigits: decimales }));
  }
  const limpio = Math.abs(valor) < 1e-9 ? 0 : valor;
  return NUMERO.get(decimales).format(limpio);
}

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

/** el('div', {class: 'x', onclick: fn, dataset: {k: 1}}, hijo1, 'texto', ...) */
export function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  aplicar(nodo, props);
  nodo.append(...hijos.flat().filter((h) => h != null && h !== false));
  return nodo;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** svg('circle', {cx: 1, class: 'nodo'}, ...hijos) */
export function svg(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElementNS(SVG_NS, etiqueta);
  aplicar(nodo, props);
  nodo.append(...hijos.flat().filter((h) => h != null && h !== false));
  return nodo;
}

function aplicar(nodo, props) {
  for (const [clave, valor] of Object.entries(props)) {
    if (valor == null || valor === false) continue;
    if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave === 'style' && typeof valor === 'object') {
      for (const [prop, v] of Object.entries(valor)) {
        nodo.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), v);
      }
    }
    else if (clave === 'html') nodo.innerHTML = valor;
    else if (clave === 'text') nodo.textContent = valor;
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
}

/** Valor de un token CSS de :root, p. ej. color('--a'). */
export function color(token) {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export const movimientoReducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const pantallaAncha = () => window.matchMedia('(min-width: 1080px)').matches;

// Etiquetas de los cuatro tiempos de manipulación (Tabla 1).
export const PARAM_HTML = {
  ua: 'u<sub>a</sub>',
  la: 'ℓ<sub>a</sub>',
  ub: 'u<sub>b</sub>',
  lb: 'ℓ<sub>b</sub>',
};

/** Etiqueta SVG con subíndice: devuelve [texto, tspan] para usar con svg('text', {}, ...). */
export function paramSVG(param) {
  const base = param[0] === 'u' ? 'u' : 'ℓ';
  return [base, svg('tspan', { 'baseline-shift': 'sub', 'font-size': '70%' }, param[1])];
}

export const sub = (base, i) => `${base}<sub>${i}</sub>`;
export const subIndice = (i, j) => (i > 9 || j > 9 ? `${i},${j}` : `${i}${j}`);
export const politicaCorta = (s) => (s === 1 ? 'P1' : 'P2');
export const POLITICA_TEXTO = {
  1: 'Política 1 · recogidas junto a la puerta',
  0: 'Política 2 · recogidas al fondo',
};

// Tooltip único para toda la página.
let tooltip;
export function mostrarTooltip(html, evento) {
  tooltip ??= document.getElementById('tooltip');
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  moverTooltip(evento);
}

export function moverTooltip(evento) {
  if (!tooltip || tooltip.hidden || !evento) return;
  const margen = 14;
  const { innerWidth: ancho, innerHeight: alto } = window;
  const caja = tooltip.getBoundingClientRect();
  let x = evento.clientX + margen;
  let y = evento.clientY + margen;
  if (x + caja.width > ancho - 8) x = evento.clientX - caja.width - margen;
  if (y + caja.height > alto - 8) y = evento.clientY - caja.height - margen;
  tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

export function ocultarTooltip() {
  if (tooltip) tooltip.hidden = true;
}

/** Conecta pointerenter/move/leave de un elemento a un tooltip con contenido dinámico. */
export function conTooltip(nodo, contenido) {
  nodo.addEventListener('pointerenter', (e) => mostrarTooltip(contenido(), e));
  nodo.addEventListener('pointermove', moverTooltip);
  nodo.addEventListener('pointerleave', ocultarTooltip);
}

export const filaTooltip = (etiqueta, valor) => `<div class="tt-fila"><span>${etiqueta}</span><span>${valor}</span></div>`;

/** Aviso breve en la esquina inferior. */
export function avisar(texto, tipo = 'info') {
  const contenedor = document.getElementById('avisos');
  const nodo = el('div', { class: `aviso aviso--${tipo}`, role: 'status' }, texto);
  contenedor.append(nodo);
  setTimeout(() => nodo.classList.add('aviso--saliendo'), 4200);
  setTimeout(() => nodo.remove(), 4800);
}
