# Página Web 1 · Visualizador TRPPD-H₃

Página con animaciones de scroll que muestra, para cada solución guardada en
`Outputs/`, el mapa de la ruta, la carga del camión en cada tramo y los tiempos
de atención de cada cliente. La propuesta de diseño está en [DISENO.md](DISENO.md).

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm start
```

Abre <http://localhost:3000>. El servidor lee `../../Outputs` (o la carpeta de
la variable `OUTPUTS_DIR`) y avisa a la página cuando aparece o cambia una
solución, así que basta con correr un algoritmo para verla.

| Comando | Qué hace |
|---|---|
| `npm start` | servidor en el puerto 3000 (`PORT` para cambiarlo) |
| `npm run dev` | igual, reiniciando el servidor al editar `server.js` |
| `npm run verificar` | recorre cada solución de `Outputs` con la simulación de la página y la compara con lo reportado |
| `npm run exportar` | copia la página, sus librerías y las soluciones en `dist/` para un hosting estático |

La página acepta `?s=<algoritmo>/<instancia>.json` en la URL para abrir una
solución concreta, por ejemplo `?s=gurobi/vigo_n5_id3_h1.json`.
