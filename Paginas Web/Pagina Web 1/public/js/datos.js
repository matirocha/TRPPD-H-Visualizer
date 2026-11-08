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

/**
 * Resultados por instancia, leídos del Excel de resúmenes (lib/resultados.js). Si no se pueden
 * leer, devuelve {error} con la causa para mostrarla en la tabla.
 */
export async function cargarResultados() {
  if (modo === 'estatico') {
    try {
      return await leerJSON('datos/resultados.json');
    } catch (error) {
      return { error: `La versión exportada no trae datos/resultados.json (${error.message}): vuelve a correr npm run exportar y revisa sus avisos.` };
    }
  }
  let respuesta;
  try {
    respuesta = await fetch('api/resultados', { cache: 'no-store' });
  } catch (error) {
    return { error: `No se pudo consultar el servidor (${error.message}).` };
  }
  if (respuesta.ok) return respuesta.json();
  // Un servidor iniciado antes de que existiera /api/resultados responde 404: hay que reiniciarlo
  if (respuesta.status === 404) {
    return { error: 'El servidor que entrega la página no tiene /api/resultados: se inició antes de esta versión. Deténlo y vuelve a correr npm start.' };
  }
  const detalle = await respuesta.json().then((d) => d.error).catch(() => null);
  return { error: detalle ?? `El servidor respondió ${respuesta.status} al pedir /api/resultados.` };
}

export function cargarSalida(archivo) {
  const ruta = archivo.split('/').map(encodeURIComponent).join('/');
  return leerJSON(modo === 'estatico' ? `datos/${ruta}` : `api/salidas/${ruta}`);
}
