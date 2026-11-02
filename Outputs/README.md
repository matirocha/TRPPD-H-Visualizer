# Outputs

Salidas de los modelos y algoritmos aplicados al TRPPD-H₃. El visualizador web
(`Paginas Web/Pagina Web 1`) lee todo JSON de esta carpeta con formato
`trppdh3-salida/1`.

```
Outputs/
  gurobi/
    base/           modelo (1)-(19)
    explicitacion/  (1)-(19) + (20)-(23)
    latencia/       (1)-(19) + (24)-(29)
    completo/       (1)-(29)
  erdogan/          heurísticas de Erdoğan et al. (2012) adaptadas (npm run heuristicas)
    dos_fases/      TSP + Algoritmo 2.1
    ils_heuristico/ ils_exacto/ its_heuristico/ its_exacto/
  enumeracion/      enumeración exhaustiva, n = 5 (generada con un script anterior)
  <algoritmo>/      cualquier algoritmo futuro
  resumenes/        gurobi_resultados.xlsx (corridas por lote), heuristicas_erdogan.csv
                    y CSV de corridas anteriores
```

Cada archivo se llama `<carpeta>/<instancia>.json`, por ejemplo
`gurobi/base/vigo_n5_id1_h0.5.json`.

## Contenido actual

Todas con ids 1 a 10, h ∈ {0,1; 0,5; 1} y u_a = ℓ_a = u_b = ℓ_b = h/2, en las
cuatro variantes del modelo:

| n | Banco | Corridas | Cómo |
|---|---|---|---|
| 5 | Battarra et al. (2010) | 30 instancias × 4 variantes, más la enumeración | `modelo_trppdh3.py`, sin límite de tiempo |
| 10, 15, 20, 25 | Battarra et al. (2010) | 120 instancias × 4 variantes | `lote_trppdh3.py B`, Gurobi 11.0.0, 1 hilo y 3 600 s por modelo |
| 30, 40, 50, 60 | Erdoğan et al. (2012), sufijo `_Erdogan` | 120 instancias × 4 variantes | `lote_trppdh3.py E`, igual que arriba |

Faltan las de Battarra con n = 30, 40, 50 y 60.

Las heurísticas de `erdogan/` (2 fases, ILS e ITS, con evaluación heurística o
exacta) están corridas, con Node.js en un solo hilo por proceso
(`npm run heuristicas` desde `Paginas Web/Pagina Web 1`), para:

| n | Banco | Instancias | Cómo |
|---|---|---|---|
| 10, 15, 20 | Battarra | 30 cada una | un proceso a la vez |
| 25 | Battarra | 30 | 8 procesos en paralelo |
| 30, 40, 50 | Battarra y Erdogan | 30 por banco | 8 procesos en paralelo |
| 60 | Battarra y Erdogan | 15 por banco (ID 1, 2, 5, 6 y 9) | 8 procesos en paralelo, detenido a la mitad |

Con 8 procesos a la vez el procesador baja su frecuencia: los tiempos de n ≥ 25
salen ~1,4 veces más altos que con un proceso solo (Σ D_i no cambia, la semilla
es fija). En n = 60 hay además 5 instancias con solo 2 fases e ILS heurístico
(ID 3 y 7 con h = 0,1 en los dos bancos, ID 10 con h = 0,1 en Battarra). Sus
JSON traen además, en `solucion`:

| Campo | Qué es |
|---|---|
| `estado` | `HEURISTICA` |
| `gap` | (Σ D_i − mejor cota inferior de las variantes de Gurobi) / Σ D_i |
| `gap_entera` | (Σ D_i − mayor relajación lineal de las variantes de Gurobi) / Σ D_i |
| `desviacion_gurobi` | (Σ D_i − mejor Σ D_i de Gurobi) / mejor Σ D_i de Gurobi |
| `referencia` | los valores de Gurobi usados en esas tres medidas |
| `segundos`, `segundos_inicial` | tiempo total del algoritmo y de su heurística de dos fases |
| `evaluaciones` | vecinos evaluados con el DP exacto y con la heurística lineal |
| `tsp`, `corridas` | ciclo TSP inicial y, por sentido, la solución inicial, la final y la mejor Σ D_i por iteración |

`resumenes/heuristicas_erdogan.csv` se reescribe con todas las corridas de
`erdogan/` cada vez que se ejecuta el script.

Con n = 5 y n = 10 todas las variantes llegan al mismo óptimo Σ D_i; con n = 5
también la enumeración. Desde n = 15 casi todas las corridas terminan por el
límite de tiempo (estado `TIME_LIMIT`), así que su Σ D_i es la mejor solución
encontrada y no un óptimo probado; la página lo indica y compara las variantes
por el GAP en la sección Rendimiento. `resumenes/gurobi_resultados.xlsx` reúne
las 960 corridas por lote: un resumen por banco y n, una fila por instancia, el
detalle de cada corrida y las definiciones de cada columna.

```bash
cd notebooks
python instancias_trppdh3.py   # crea Instancias/ (una vez)
python lote_trppdh3.py B all   # las 4 variantes en el banco de Battarra (E = Erdogan)
python modelo_trppdh3.py       # una instancia suelta: N, ID, H del inicio del archivo
```

En `modelo_trppdh3.py`, `RESTRICCIONES_20_23` y `RESTRICCIONES_24_29` aceptan
`True`, `False` o `[False, True]` (resuelve con y sin ellas), y `N`, `ID` y `H`
aceptan listas para resolver varias instancias seguidas. `lote_trppdh3.py`
guarda los JSON y su Excel junto al script; para verlos en la página se copia
su carpeta `gurobi` aquí.

## Formato `trppdh3-salida/1`

```jsonc
{
  "formato": "trppdh3-salida/1",
  "generado": "2026-10-29T14:16:51",
  "algoritmo": {
    "clave": "gurobi",                          // algoritmo (fila "Algoritmo" del selector)
    "nombre": "Gurobi · (1)-(19) + (24)-(29)",  // texto que muestra la página
    "parametros": {                             // libre; explicitacion y latencia
      "variante": "latencia",                   // mueven los interruptores de la página
      "explicitacion": false, "latencia": true,
      "limite_tiempo": null, "hilos": null
    }
  },
  "instancia": {                                // copia de Instancias/<instancia>.json
    "nombre": "vigo_n5_id1_h0.5",
    "n": 5, "id": 1, "h": 0.5,
    "Q": 32,
    "ua": 0.25, "la": 0.25, "ub": 0.25, "lb": 0.25,  // escalares o una lista por nodo
    "alpha": [0, 15, 4, 3, 3, 7],                    // índice 0 = depósito
    "beta":  [0, 3, 2, 3, 8, 0],
    "c": [[0, 67, ...], ...],                        // matriz (n+1)×(n+1)
    "coords": [[21.26, 35.48], ...]                  // opcional: si falta, la página las calcula
  },
  "solucion": {
    "ruta": [0, 2, 1, 5, 4, 3, 0],                   // obligatoria
    "politica": { "2": 1, "1": 1, "5": 1, "4": 0, "3": 0 },  // obligatoria: 1 = P1, 0 = P2
    "objetivo": 717.75,                              // Σ D_i
    "estado": "OPTIMAL", "cota": 717.75, "gap": 0,
    "segundos": 0.017,                 // resolución en Gurobi (Runtime)
    "segundos_construccion": 0.0042,   // armar el modelo
    "segundos_total": 0.0218,          // construcción + resolución + lectura
    "nodos": 1, "iteraciones": 167,
    "variables": 182, "binarias": 35, "restricciones": 165,
    "T": { "2": 35, ... }, "D": { ... }, "F": { ... }, "q": { ... },
    "cargas": [{ "arco": [0, 2], "w": 0, "y": 32, "z": 0 }, ...],
    "viaje": 336, "manipulacion_adicional": 7.5, "regreso": 355.5
  }
}
```

Solo `instancia` (sin `coords`), `solucion.ruta` y `solucion.politica` son
obligatorios. La página recorre la ruta con la secuencia de la Tabla 3 de la
formulación y compara su resultado con todo lo que el archivo informe.

## Agregar un algoritmo

Basta con copiar la instancia de `Instancias/` y entregar la ruta y el vector
*s*; la página calcula T, D, F y el objetivo con la Tabla 3.

```python
import json
from pathlib import Path

inst = json.loads(Path("Instancias/vigo_n5_id1_h0.5.json").read_text(encoding="utf-8"))
salida = {
    "formato": "trppdh3-salida/1",
    "algoritmo": {"clave": "mi_heuristica", "nombre": "Mi heurística"},
    "instancia": inst,
    "solucion": {"ruta": [0, 2, 1, 5, 4, 3, 0],
                 "politica": {2: 1, 1: 1, 5: 1, 4: 0, 3: 0},
                 "segundos": 0.8},
}
destino = Path("Outputs/mi_heuristica") / f"{inst['nombre']}.json"
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
```
