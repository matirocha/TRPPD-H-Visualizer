// Punto de entrada: carga las soluciones, arma el selector y la portada, y
// entrega la simulación a cada vista (mapa, tabla y carga del camión).
//
// Cada vista es un módulo con crear(raiz, estado) -> { render(sim, salida), destruir() }.
import { cargarManifest, cargarSalida } from './datos.js';
import { crearEstado } from './estado.js';
import { normalizar, simular } from './modelo.js';
import { $, $$, avisar, el, fmt, movimientoReducido } from './util.js';
import { crearSelector } from './selector.js';
import * as mapa from './mapa.js';
import * as tabla from './tabla.js';
import * as camion from './camion.js';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, MotionPathPlugin);

const estado = crearEstado({ salida: null, sim: null, hover: null, modoNodo: 'tiempo', avance: null, modoContinuo: false });
let manifest = [];
let modulos = [];
let selector = null;
let objetivoMostrado = 0;

// --- Portada ----------------------------------------------------------------

function pintarPortada(sim, salida) {
  const ok = sim.verificacion.ok && sim.avisos.length === 0;
  const valor = el('span', { class: 'dato__valor num' }, fmt(objetivoMostrado));
  $('#portada-datos').replaceChildren(
    el('div', { class: 'dato dato--grande' },
      el('span', { class: 'dato__etq', html: 'Espera total Σ D<sub>i</sub>' }), valor),
    el('div', { class: 'dato' },
      el('span', { class: 'dato__etq' }, 'Solución'),
      el('span', { class: 'dato__texto' }, `${salida.algoritmo.nombre.split(' · ')[0]} · ${salida.instancia.nombre}`)),
    el('div', { class: 'dato' },
      el('span', { class: 'dato__etq' }, 'Ruta'),
      el('span', { class: 'dato__texto num' }, sim.ruta.join(' → '))),
    el('span', {
      class: `insignia${ok ? '' : ' insignia--error'}`,
      title: ok
        ? `La simulación reproduce los ${sim.verificacion.comparados} valores del archivo (Σ D, T, D, F, q).`
        : [...sim.verificacion.diferencias.map((d) => `${d.etiqueta}: ${fmt(d.simulado, 4)} vs ${fmt(d.reportado, 4)}`), ...sim.avisos].join('\n'),
    }, ok ? '✓ Verificada' : '! Con diferencias'));

  // Σ D cuenta desde el valor anterior
  const obj = { v: objetivoMostrado };
  objetivoMostrado = sim.objetivo;
  if (movimientoReducido()) valor.textContent = fmt(sim.objetivo);
  else gsap.to(obj, { v: sim.objetivo, duration: 1.2, ease: 'power3.out', onUpdate: () => { valor.textContent = fmt(obj.v); } });
}

// --- Carga de soluciones ----------------------------------------------------

async function mostrar(archivo) {
  let salida;
  let sim;
  try {
    salida = normalizar(await cargarSalida(archivo), archivo);
    sim = simular(salida);
  } catch (error) {
    console.error(error);
    avisar(`No se pudo leer ${archivo}: ${error.message}`, 'error');
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set('s', archivo);
  history.replaceState(null, '', url);

  estado.set({ salida, sim, hover: null, avance: null });
  selector.pintar(manifest, archivo);
  pintarPortada(sim, salida);
  for (const m of modulos) {
    try {
      m.destruir();
      m.render(sim, salida);
    } catch (error) {
      console.error(error);
    }
  }
  ScrollTrigger.refresh();
  document.title = `${salida.instancia.nombre} · TRPPD-H₃`;
}

/** Al cambiar de solución la escena se desvanece, se reconstruye y vuelve a aparecer. */
async function cambiar(archivo) {
  const escena = $('#escena');
  if (movimientoReducido()) return mostrar(archivo);
  await gsap.to(escena, { autoAlpha: 0, y: 10, duration: 0.2, ease: 'power1.in' });
  await mostrar(archivo);
  gsap.to(escena, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' });
}

// --- Animaciones generales ----------------------------------------------------

function animarPortada() {
  if (movimientoReducido()) return;
  const titulo = $('#portada-titulo');
  titulo.replaceChildren(...titulo.textContent.trim().split(/\s+/).map((palabra) =>
    el('span', { class: 'palabra' }, el('span', { class: 'palabra__interior' }, palabra))));
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.palabra__interior', { yPercent: 110, duration: 0.9, stagger: 0.07 })
    .from('[data-aparecer]', { autoAlpha: 0, y: 18, duration: 0.7, stagger: 0.1 }, 0.35)
    .from('.dato, .insignia', { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.08 }, 0.7);
  gsap.to('.portada__flecha', { y: 4, duration: 0.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
}

function animarEntradas() {
  if (movimientoReducido()) return;
  const bloques = $$('.recorrido__controles, .recorrido__mapa, .recorrido__tabla, .recorrido__carga');
  gsap.set(bloques, { autoAlpha: 0, y: 30 });
  ScrollTrigger.batch(bloques, {
    start: 'top 92%',
    once: true,
    onEnter: (lote) => gsap.to(lote, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.1, overwrite: true }),
  });
}

function iniciarNavegacion() {
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (st) => document.body.classList.toggle('con-scroll', st.scroll() > 16),
  });
  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('a[href^="#"]');
    const destino = enlace && $(enlace.getAttribute('href'));
    if (!destino) return;
    e.preventDefault();
    gsap.to(window, { duration: movimientoReducido() ? 0 : 0.9, scrollTo: { y: destino, offsetY: 64 }, ease: 'power2.inOut' });
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
    aviso.innerHTML = 'No se encontraron soluciones en <code>Outputs</code>.';
    return;
  }

  selector = crearSelector({ contenedor: $('#selector'), alElegir: (archivo) => cambiar(archivo) });
  modulos = [
    mapa.crear($('#mapa'), estado),
    tabla.crear($('#tabla'), estado),
    camion.crear($('#carga'), estado, { escena: $('#escena'), controles: $('#controles') }),
  ];

  const pedido = new URL(location.href).searchParams.get('s');
  const inicial = manifest.find((s) => s.archivo === pedido)
    ?? manifest.find((s) => s.archivo === 'gurobi/vigo_n5_id1_h0.5.json')
    ?? manifest[0];
  iniciarNavegacion();
  await mostrar(inicial.archivo);
  aviso.classList.add('carga-inicial--lista');
  animarPortada();
  animarEntradas();
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

iniciar();
