// Acceso a las soluciones: API del servidor Node o, en la exportación estática, datos/.
let modo = null;

async function leerJSON(url) {
  const respuesta = await fetch(url, { cache: 'no-store' });
  if (!respuesta.ok) throw new Error(`${url}: ${respuesta.status}`);
  return respuesta.json();
}

export async function cargarManifest() {
  try {
    const { salidas } = await leerJSON('api/salidas');
    modo = 'api';
    return salidas;
  } catch {
    const { salidas } = await leerJSON('datos/manifest.json');
    modo = 'estatico';
    return salidas;
  }
}

export function cargarSalida(archivo) {
  const ruta = archivo.split('/').map(encodeURIComponent).join('/');
  return leerJSON(modo === 'estatico' ? `datos/${ruta}` : `api/salidas/${ruta}`);
}

export const enVivo = () => modo === 'api' && 'EventSource' in window;

/** Llama a fn({archivos}) cada vez que el servidor detecta cambios en Outputs. */
export function escucharCambios(fn, alEstado = () => {}) {
  if (!enVivo()) return null;
  const fuente = new EventSource('api/eventos');
  fuente.addEventListener('cambio', (e) => fn(JSON.parse(e.data)));
  fuente.addEventListener('open', () => alEstado(true));
  fuente.addEventListener('error', () => alEstado(false));
  return fuente;
}
