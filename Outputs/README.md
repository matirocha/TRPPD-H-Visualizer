# Outputs

Salidas de los modelos y algoritmos aplicados al TRPPD-H₃. El visualizador web
(`Paginas Web/Pagina Web 1`) lee todo JSON de esta carpeta con formato
`trppdh3-salida/1`.

```
Outputs/
  gurobi/          modelo (1)-(19) en Gurobi (notebooks/correr_trppdh3.py)
  enumeracion/     enumeración exhaustiva, n <= 7 (notebooks/correr_enumeracion.py)
  <algoritmo>/     cualquier algoritmo futuro
  resumenes/       un CSV por corrida de correr_trppdh3.py
```

Cada archivo se llama `<algoritmo>/<instancia>.json`, por ejemplo
`gurobi/vigo_n5_id1_h0.5.json`.

## Contenido actual

Las 30 instancias con n = 5 del banco de Battarra et al. (2010): ids 1 a 10 y
h ∈ {0,1; 0,5; 1}, con u_a = ℓ_a = u_b = ℓ_b = h/2. Las soluciones de Gurobi se
generaron con las restricciones de explicitación (20)–(23), para que los flujos
w, y, z guardados correspondan a la carga física. En las 30 instancias Gurobi y
la enumeración obtienen el mismo óptimo y la misma ruta.

```bash
cd notebooks
python correr_trppdh3.py --n 5 --explicitacion --silencioso
python correr_enumeracion.py --n 5
```

## Formato `trppdh3-salida/1`

```jsonc
{
  "formato": "trppdh3-salida/1",
  "generado": "2026-10-21T13:12:34",
  "algoritmo": {
    "clave": "gurobi",                      // nombre de la subcarpeta
    "nombre": "Gurobi · modelo (1)-(19)",   // texto que muestra la página
    "parametros": { "explicitacion": true } // libre
  },
  "instancia": {
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
    "estado": "OPTIMAL", "cota": 717.75, "gap": 0, "segundos": 0.05, "nodos": 134,
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

```python
from instancias_vigo import generar_instancia
from salidas import construir_salida, guardar_salida

inst = generar_instancia(5, 1, 0.5)
sol = {"ruta": [0, 2, 1, 5, 4, 3, 0], "politica": {2: 1, 1: 1, 5: 1, 4: 0, 3: 0},
       "segundos": 0.8}
guardar_salida(construir_salida(inst, sol, "mi_heuristica", "Mi heurística"))
```

`construir_salida` completa T, D, F, el objetivo y los términos de costo con
`enumeracion.evaluar`, y agrega la matriz c y las coordenadas del mapa
(escalamiento multidimensional de la matriz de 50 clientes de la misma id).
