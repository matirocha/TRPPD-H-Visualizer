# Página Web 1 · Propuesta de diseño

Visualizador de rutas del TRPPD-H₃ (Traveling Repairman Problem con recogidas,
entregas y costos de manipulación bajo la Política 3 de Battarra et al., 2010).

## Concepto

**"Hoja de ruta técnica"**: papel cálido, tinta oscura y datos en monoespaciada,
como un cuaderno de campo de logística. El camión recorre la ruta dos veces,
cada vez con una lente distinta.

1. **Mapa y carga, a la vez** (justo después de la portada): dónde va y cuánto
   tarda cada tramo, y qué lleva dentro y qué entra o sale por la única puerta.
2. **Reloj**: cuánto espera cada cliente y de qué está hecha esa espera.

## Identidad visual

| Uso | Token | Color |
|---|---|---|
| Fondo papel / superficie | `--papel` / `--superficie` | `#f4f0e8` / `#fbf9f5` |
| Tinta / texto secundario | `--tinta` / `--tinta-2` | `#17202a` / `#4d5866` |
| Entregas (mercancía a, bloque y) | `--a` | `#d4891c` ámbar |
| Recogidas al fondo (bloque w) | `--b-fondo` | `#263c7e` índigo oscuro |
| Recogidas junto a la puerta (bloque z) | `--b-puerta` | `#7f95d4` índigo claro |
| u<sub>a</sub> descargar a / ℓ<sub>a</sub> cargar a | `--op-ua` / `--op-la` | `#e5a53f` / `#93590c` |
| u<sub>b</sub> descargar b / ℓ<sub>b</sub> cargar b | `--op-ub` / `--op-lb` | `#7f95d4` / `#263c7e` |
| Viaje c<sub>ij</sub> | `--viaje` | `#a3abb5` |
| Política 1 (s<sub>i</sub> = 1) | `--p1` | `#12867d` verde azulado |
| Política 2 (s<sub>i</sub> = 0) | `--p2` | `#c63f4d` rojo |

Regla: **la mercancía define el tono y la operación la intensidad**. Todo lo
que es *a* es ámbar y todo lo que es *b* es índigo; descargar (u) es claro y
cargar (ℓ) es oscuro. Así las tarjetas u<sub>a</sub> ℓ<sub>a</sub> u<sub>b</sub> ℓ<sub>b</sub> del mapa, los bloques del
camión y los segmentos del reloj se leen con la misma leyenda. Las políticas
usan colores propios (verde azulado / rojo) que no se confunden con la carga.

Tipografía (servida desde `node_modules`, sin internet):
**Fraunces** para títulos, **Inter** para texto e interfaz, **IBM Plex Mono**
para números (con cifras tabulares). Decimales con coma (es-CL).

## Estructura de la página

| # | Sección | Contenido | Animación |
|---|---|---|---|
| 00 | Portada | Título, pregunta del problema, ruta de la instancia dibujada sobre papel liso | La ruta se traza sola; paralaje al bajar |
| 01 | Mapa y carga | A la izquierda, nodos con u<sub>a</sub>, ℓ<sub>a</sub>, u<sub>b</sub>, ℓ<sub>b</sub> y arcos con c<sub>ij</sub>; a la derecha, el camión con las unidades en su posición física y los pasos de la Tabla 3. Debajo, barras de carga por tramo vs Q | Reproductor (ver abajo): el camión se mueve en el mapa y cada operación de carga y descarga se anima al mismo tiempo |
| 02 | El problema | Tres ideas: latencia (Σ D<sub>i</sub>), una sola puerta (LIFO, Figura 1), Política 3 (Tabla 3) | Se construyen al entrar en pantalla |
| 03 | La instancia | Selector (algoritmo, n, id, h), KPIs, tabla de clientes, parámetros, verificación, leyenda | Contadores |
| 04 | Reloj | Línea de tiempo de la ruta con lupa de servicio y barras de espera D<sub>i</sub> por cliente | Cabezal ligado al scroll; barras que crecen |
| 05 | Datos | Cómo generar salidas y conectar algoritmos nuevos | — |

La sección 01 no depende del scroll: un reproductor sobre la escena tiene
**volver al inicio**, **explicación anterior**, **Iniciar / Pausar / Continuar /
Repetir**, el interruptor **Modo continuo** y una barra de avance (clic o
arrastre para saltar; los puntos son las llegadas a cada cliente).

- Modo continuo apagado (por defecto): el camión se detiene al final de cada
  paso de la Tabla 3 y al final de cada parada (D<sub>i</sub>, F<sub>i</sub>), para leer la
  explicación del panel; **Continuar** sigue hasta la próxima pausa.
- Modo continuo encendido: recorre la ruta completa sin parar.
- Con `prefers-reduced-motion` no hay animación: cada Continuar salta a la
  próxima pausa y el modo continuo avanza una pausa cada 2,5 s.

En escritorio la escena mide el alto de la ventana bajo la barra (mapa a la
izquierda; estado, camión y pasos a la derecha) y al apretar Iniciar se alinea
bajo la barra. En pantallas de menos de 960 px el mapa y el camión se apilan y
el reproductor queda pegado bajo la barra superior.

El selector de soluciones vive en la barra superior (un botón que abre un panel)
y, el mismo panel, en la sección 03. Cada opción muestra el Σ D de la solución
a la que lleva; las fichas de instancia tienen una barra proporcional a Σ D.

Lo que pide el enunciado y dónde está:

- **Mapa con un nodo por cliente que muestra u<sub>a</sub>, ℓ<sub>a</sub>, u<sub>b</sub>, ℓ<sub>b</sub>** → sección 01. Cada nodo tiene
  una tarjeta 2×2 con los cuatro tiempos. Un control alterna entre el *tiempo
  incurrido* en ese cliente (p. ej. u<sub>a</sub>·α<sub>i</sub>) y el *valor unitario* del parámetro.
- **Tiempo de viaje en cada arco** → etiqueta c<sub>ij</sub> en el punto medio de cada arco.
- **Carga del camión para cada cliente** → sección 01 (camión animado junto al mapa y barras w/y/z).
- **Gráfico del tiempo de cada cliente** → sección 04 (línea de tiempo y espera D<sub>i</sub>).

## Datos

- Las soluciones viven en `Outputs/<algoritmo>/<instancia>.json` (formato
  `trppdh3-salida/1`, descrito en `Outputs/README.md`).
- En local, el servidor (`server.js`, Express) las lista en `/api/salidas`; en
  la versión publicada, `npm run exportar` las copia a `dist/datos/`. En ambos
  casos se leen al cargar la página.
- La página **no confía ciegamente en los números del archivo**: vuelve a
  recorrer la ruta con la secuencia de la Tabla 3 (`public/js/modelo.js`) y
  compara T<sub>i</sub>, D<sub>i</sub>, F<sub>i</sub>, q<sub>i</sub> y Σ D<sub>i</sub> con lo reportado. Las cargas físicas (w, y, z)
  también salen de esa simulación, porque sin (20)–(23) los flujos del modelo
  no son únicos.
- Las instancias de e_vigo solo traen la matriz de costos; las coordenadas del
  mapa se recuperan con escalamiento multidimensional clásico (error medio de
  0,2 unidades frente a c<sub>ij</sub>).

## Arquitectura del código

```
Pagina Web 1/
  server.js            Express: estáticos y /api/salidas
  lib/salidas.js       lectura de Outputs (compartida con los scripts)
  scripts/exportar.js  copia estática en dist/
  scripts/verificar.js simulación JS vs. todas las salidas
  public/
    index.html         esqueleto de secciones
    css/base.css       tokens y componentes comunes (incluye el selector)
    css/<seccion>.css  estilos de cada sección
    css/recorrido.css  acomodo conjunto de mapa y carga
    js/main.js         arranque, sección Instancia
    js/selector.js     selector de soluciones (barra y sección Instancia)
    js/modelo.js       normalización y simulación (Tabla 3)
    js/estado.js       estado compartido (hover, avance del recorrido)
    js/util.js         formato, DOM/SVG, tooltip
    js/intro.js        portada y "El problema"
    js/mapa.js         mapa de la ruta
    js/camion.js       carga del camión
    js/tiempos.js      reloj
```

GSAP 3 (ScrollTrigger, DrawSVG, MotionPath, SplitText, ScrollTo), d3 y KaTeX
se cargan como scripts clásicos desde `node_modules` (`window.gsap`, `window.d3`,
`window.katex`). No hay empaquetador.

### Contrato de los módulos de sección

```js
export function crear(raiz, estado) {
  return {
    render(sim, salida) { /* construye la sección para esta solución */ },
    destruir() { /* revierte animaciones, ScrollTriggers, oyentes y DOM */ },
  };
}
```

- `main.js` llama `destruir()` y luego `render()` cada vez que se elige otra
  solución, y después `ScrollTrigger.refresh()`.
- Todo lo de GSAP se crea dentro de `gsap.context(() => …, raiz)` y se revierte
  con `ctx.revert()` en `destruir()`. Los *scrub* ligados al scroll (sección del
  reloj) solo en escritorio (`gsap.matchMedia()`, `(min-width: 960px)` y sin
  `prefers-reduced-motion`); en móvil o con movimiento reducido hay botones.
- La barra superior mide 64 px: los pines empiezan en `top top+=64`.
- Resaltado compartido: al pasar sobre un cliente se hace
  `estado.set({ hover: i })` y al salir `estado.set({ hover: null })`; cada vista
  escucha `estado.on('hover', fn)` y marca ese cliente.
- Mapa y carga van juntos: `camion.crear(raiz, estado, { escena, controles, grafico })`
  pone el reproductor en `#recorrido-controles` y las barras en `#carga-grafico`;
  `mapa.crear(raiz, estado, { vinculado: true })` no tiene scroll ni botones de
  avance propios. La carga
  publica en cada actualización `estado.avance = { tramo, viaje, servicio, reloj }`
  y el mapa se ubica en ese punto de su línea; al elegir una parada en el mapa
  se hace `estado.set({ pedirParada: { indice } })` y la carga mueve las dos
  vistas. `estado.modoContinuo` guarda el interruptor entre soluciones.
- Los colores salen siempre de los tokens CSS (clases o `style: { fill: 'var(--a)' }`).
- Las clases de cada sección llevan prefijo (`intro-`, `mapa-`, `camion-`, `tiempos-`).

### Estructura `sim` (resultado de `simular`)

```text
sim.paradas[k]   una por cliente, en orden de visita:
  cliente, k (1..n), politica (1 = P1, 0 = P2), alpha, beta, desde, c
  salidaPrevia, T, D, F, q, servicio = F - T
  ops[]          pasos de la Tabla 3 presentes: {clave, paso, param, etiqueta,
                 unidades, tasa, inicio, fin, duracion, pilaAntes, pilaDespues, bloques}
  tasa           {ua, la, ub, lb} valores unitarios en ese cliente
  tiempoParam    {ua, la, ub, lb} tiempo incurrido en ese cliente
  unidadesParam  {ua, la, ub, lb} unidades movidas
  llegada/salida {carga: {w, y, z, total}, pila: [{tipo, cliente, unidades}]}
  espera         {total = D, viaje, ua, la, ub, lb} composición acumulada de D_i
sim.arcos[k]     n + 1 tramos: desde, hasta, c, inicio, fin, carga, pila, regreso
sim.objetivo, sim.viaje, sim.regreso, sim.manipulacionAdicional, sim.Q,
sim.cargaInicial, sim.cargaMaxima, sim.politicas, sim.verificacion, sim.avisos
salida.instancia: n, Q, alpha[], beta[], c[][], coords[][], ua[], la[], ub[], lb[]
```

`pila` ordena los bloques desde el frente (F) hasta la puerta (R). En los
bloques `y` el cliente es el destino de la entrega; en `w` y `z`, el cliente
donde se recogió.
