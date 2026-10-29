# Página Web 2 · Visualizador TRPPD-H₃

Misma funcionalidad que la Página Web 1 con un diseño más simple: portada
corta, y una sola escena con el reproductor, el mapa (sin grilla), la carga del
camión con la explicación paso a paso de la Tabla 3 y la tabla de tiempo por
cliente. Lee las soluciones de `Outputs/`.

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm start
```

Abre <http://localhost:3001> (puerto distinto al de la Página 1, para tener las
dos abiertas). Después de correr un algoritmo, recarga la página para ver sus
soluciones.

| Comando | Qué hace |
|---|---|
| `npm start` | servidor en el puerto 3001 (`PORT` para cambiarlo) |
| `npm run verificar` | compara la simulación de la página con cada solución de `Outputs` |
| `npm run exportar` | copia la página y las soluciones en `dist/` para un hosting estático |

`?s=<algoritmo>/<instancia>.json` en la URL abre una solución concreta.

## Diseño

- Paleta: fondo gris claro, tarjetas blancas. Entregas (a) en coral, recogidas
  (b) en verde azulado; descargar (u) es el tono claro y cargar (ℓ) el oscuro.
  Política 1 en azul, Política 2 en magenta.
- Tipografía: Manrope (texto) y JetBrains Mono (números).
- `public/js/modelo.js`, `estado.js` y `datos.js` son los de la Página 1; las
  vistas (`mapa.js`, `camion.js`, `tabla.js`) están reescritas.
