// Estado compartido entre secciones. Claves usadas:
//   salida  solución normalizada (modelo.normalizar)
//   sim     resultado de modelo.simular
//   hover   cliente resaltado en todas las vistas (número o null)
//   modoNodo 'tiempo' | 'unitario': qué muestran las tarjetas uₐ ℓₐ u_b ℓ_b del mapa
export function crearEstado(inicial = {}) {
  let estado = { ...inicial };
  const oyentes = new Map();

  const avisar = (clave, valor, anterior) => {
    for (const fn of oyentes.get(clave) ?? []) fn(valor, anterior, estado);
  };

  return {
    get: (clave) => (clave === undefined ? estado : estado[clave]),
    set(parcial) {
      const anterior = estado;
      estado = { ...estado, ...parcial };
      for (const clave of Object.keys(parcial)) {
        if (!Object.is(anterior[clave], estado[clave])) avisar(clave, estado[clave], anterior[clave]);
      }
    },
    /** Suscribe fn(valor, anterior, estado) a una clave; devuelve la función para desuscribir. */
    on(clave, fn) {
      if (!oyentes.has(clave)) oyentes.set(clave, new Set());
      oyentes.get(clave).add(fn);
      return () => oyentes.get(clave).delete(fn);
    },
  };
}
