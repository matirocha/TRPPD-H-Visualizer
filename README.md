# TRPPD-H₃ Visualizer

**Página publicada: <https://trppd-h-visualizer.vercel.app/>**

Visualizador web y código de apoyo para el **TRPPD-H₃**: *Traveling Repairman
Problem* con recogidas y entregas y costos de manipulación bajo la Política 3
de Battarra et al. (2010). Un camión con una sola puerta sale del depósito,
entrega mercancía *a* y recoge mercancía *b* en cada cliente, y el objetivo es
minimizar la suma de los tiempos de atención Σ Dᵢ, donde cada cliente se
atiende con la Política 1 o la Política 2 (variable *sᵢ*).

El repositorio reúne todo el flujo:

1. Generar las instancias a partir del banco `e_vigo`.
2. Resolverlas con el modelo (1)–(29) en Gurobi (u otro algoritmo).
3. Ver cada solución en la página: mapa de la ruta, carga del camión en cada
   tramo y tiempos de cada cliente.

## Estructura

```
TRPPD-H Visualizer/
├── trppdh3_formulacion.pdf   formulación del modelo (Tablas 1–3, ecuaciones (1)–(29))
├── papers/                   Battarra et al. (2010)
├── e_vigo/                   banco original: edati.dat (demandas) y ecosti.dat (costos)
├── notebooks/
│   ├── instancias_trppdh3.py crea Instancias/ a partir de e_vigo
│   └── modelo_trppdh3.py     modelo en Gurobi; guarda las soluciones en Outputs/
├── Instancias/               390 instancias JSON: n ∈ {5, 10, 15, 20, 25, 30, 40, 50, 60}, id 1–10, h ∈ {0,1; 0,5; 1}
├── Outputs/                  soluciones en formato trppdh3-salida/1 (ver Outputs/README.md)
│   ├── gurobi/{base, explicitacion, latencia, completo}/
│   ├── enumeracion/
│   └── resumenes/
├── Paginas Web/
│   ├── Pagina Web 1/         visualizador principal (el que está en Vercel)
│   └── Pagina Web 2/         variante con un diseño más simple
└── Visualizaciones HTML/     páginas explicativas independientes
```

## Instancias

`notebooks/instancias_trppdh3.py` reproduce el banco de pruebas de
Battarra et al. (2010, Sección 5) sobre las instancias euclidianas de
Gendreau, Laporte y Vigo (1999):

- Se toman las 10 instancias de 50 clientes y se conservan los primeros
  n ∈ {5, 10, 15, 20, 25}, como en el paper.
- Las demandas αᵢ (entregas) y βᵢ (recogidas) y la capacidad Q se obtienen
  con la regla (79) del paper.
- El tiempo de manipulación h se divide en descarga y carga:
  uₐ = ℓₐ = u_b = ℓ_b = h/2.
- Como `e_vigo` solo trae la matriz de costos, las coordenadas del mapa se
  recuperan con escalamiento multidimensional clásico.

El banco se amplía a n ∈ {30, 40, 50, 60} de dos maneras, siempre con
h ∈ {0,1; 0,5; 1}:

| Sufijo del archivo | n              | Instancia base de e_vigo | Referencia                         |
|--------------------|----------------|--------------------------|------------------------------------|
| (sin sufijo)       | 30, 40, 50     | 50 clientes              | Battarra et al. (2010)             |
| `_Battarra`        | 60             | 75 clientes              | Battarra et al. (2010)             |
| `_Erdogan`         | 30, 40, 50, 60 | 200 clientes             | Erdoğan et al. (2012, Sección 5)   |

Las instancias de distinto tamaño de e_vigo no comparten clientes, así que el
mapa de una id cambia con la instancia base. Erdoğan et al. usan h = 20/n;
aquí se mantienen los tres valores de h de Battarra.

Cada instancia queda en `Instancias/vigo_n<n>_id<id>_h<h>[_<sufijo>].json`.
En `notebooks/modelo_trppdh3.py`, `BANCO` elige el sufijo.

## Modelo en Gurobi

`notebooks/modelo_trppdh3.py` resuelve el modelo (1)–(19) y, de forma
opcional, las restricciones de explicitación de las cargas (20)–(23) y la
desigualdad válida de latencia (24)–(29). Las cuatro combinaciones se guardan
en carpetas distintas:

| Carpeta en `Outputs/gurobi/` | Restricciones |
|---|---|
| `base` | (1)–(19) |
| `explicitacion` | (1)–(19) + (20)–(23) |
| `latencia` | (1)–(19) + (24)–(29) |
| `completo` | (1)–(29) |

Las restricciones (20)–(29) no cambian el óptimo, solo el tiempo de
ejecución, que la página compara en la sección Rendimiento.

La instancia y las variantes se eligen al inicio del archivo (`N`, `ID`, `H`,
`RESTRICCIONES_20_23`, `RESTRICCIONES_24_29`, `LIMITE_TIEMPO`, `HILOS`); `N`,
`ID` y `H` aceptan listas para resolver varias instancias seguidas.

Requiere Python 3 con `numpy` y `gurobipy` (con una licencia de Gurobi válida):

```bash
cd notebooks
python instancias_trppdh3.py   # crea Instancias/ (una sola vez)
python modelo_trppdh3.py       # resuelve y guarda en Outputs/gurobi/
```

Hoy `Outputs/` contiene las 30 instancias con n = 5 resueltas en las cuatro
variantes y por enumeración exhaustiva; en todas se obtiene el mismo Σ Dᵢ.

## Visualizador web

La **Página Web 1** es la versión publicada en
<https://trppd-h-visualizer.vercel.app/>. Lee todas las soluciones de
`Outputs/` y para cada una muestra:

- el mapa con la ruta y la política de cada cliente,
- la carga del camión tramo a tramo (bloques *w*, *y*, *z*) y lo que entra o
  sale por la puerta,
- un reloj con el tiempo de atención de cada cliente y de qué está hecho,
- la comparación de tiempos de ejecución entre algoritmos y variantes.

La página vuelve a recorrer la ruta con la secuencia de la Tabla 3 de la
formulación y compara su resultado con lo que informa el archivo.

Para abrir una solución concreta se usa el parámetro `s`, por ejemplo
<https://trppd-h-visualizer.vercel.app/?s=gurobi/base/vigo_n5_id3_h1.json>.

### Correrla en local

Requiere Node.js 20 o superior.

```bash
cd "Paginas Web/Pagina Web 1"
npm install
npm start
```

Se abre en <http://localhost:3000>. Después de correr un algoritmo basta con
recargar la página para ver las nuevas soluciones.

| Comando | Qué hace |
|---|---|
| `npm start` | servidor en el puerto 3000 (`PORT` para cambiarlo, `OUTPUTS_DIR` para leer otra carpeta) |
| `npm run dev` | igual, reiniciando el servidor al editar `server.js` |
| `npm run verificar` | compara la simulación de la página con cada solución de `Outputs/` |
| `npm run exportar` | genera la versión estática en `dist/` |

La **Página Web 2** tiene la misma funcionalidad con un diseño más simple y
corre en el puerto 3001 (mismos comandos dentro de `Paginas Web/Pagina Web 2`).
Los detalles de cada una están en su propio README y, para la Página 1, en
[DISENO.md](Paginas%20Web/Pagina%20Web%201/DISENO.md).

### Despliegue en Vercel

El proyecto de Vercel usa `Paginas Web/Pagina Web 1` como directorio raíz.
Su `vercel.json` instala con `npm ci`, ejecuta `npm run exportar` y publica
`dist/`, que incluye las soluciones de `Outputs/`. Por eso cualquier solución
nueva aparece en la página publicada al hacer commit y push a `main`.

## Agregar un algoritmo

Cualquier algoritmo puede mostrarse en la página: basta con guardar un JSON
en `Outputs/<algoritmo>/<instancia>.json` con la instancia, la ruta y la
política de cada cliente. La página calcula T, D, F y el objetivo por sí
misma. El formato completo `trppdh3-salida/1` y un ejemplo en Python están en
[Outputs/README.md](Outputs/README.md).

## Visualizaciones HTML

Páginas autocontenidas (se abren directamente en el navegador) que explican
el problema:

- [`presentacion_evigo_trppdh3.html`](Visualizaciones%20HTML/presentacion_evigo_trppdh3.html): de `e_vigo` al TRPPD-H₃.
- [`trppdh3_adaptacion.html`](Visualizaciones%20HTML/trppdh3_adaptacion.html): del TSPPD-H3 al TRPPD-H3.
- [`trppdh3_modelo.html`](Visualizaciones%20HTML/trppdh3_modelo.html): el modelo TRPPD-H3, pieza por pieza.

## Referencias

- Battarra, M., Erdoğan, G., Laporte, G. y Vigo, D. (2010). The Traveling
  Salesman Problem with Pickups, Deliveries, and Handling Costs.
  *Transportation Science*, 44(3), 383–399.
- Gendreau, M., Laporte, G. y Vigo, D. (1999). Heuristics for the traveling
  salesman problem with pickup and delivery. *Computers & Operations
  Research*, 26(7), 699–714.
