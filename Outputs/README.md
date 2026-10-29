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
  enumeracion/      enumeración exhaustiva, n = 5 (generada con un script anterior)
  <algoritmo>/      cualquier algoritmo futuro
  resumenes/        CSV de corridas anteriores
```

Cada archivo se llama `<carpeta>/<instancia>.json`, por ejemplo
`gurobi/base/vigo_n5_id1_h0.5.json`.

## Contenido actual

Las 30 instancias con n = 5 del banco de Battarra et al. (2010): ids 1 a 10 y
h ∈ {0,1; 0,5; 1}, con u_a = ℓ_a = u_b = ℓ_b = h/2, resueltas con Gurobi en las
cuatro variantes del modelo. Las restricciones (20)–(29) no cambian el óptimo:
en las 30 instancias las cuatro variantes y la enumeración obtienen el mismo
Σ D_i. Lo que cambia es el tiempo de ejecución, que la página compara en la
sección Rendimiento.

```bash
cd notebooks
python instancias_trppdh3.py   # crea Instancias/ (una vez)
python modelo_trppdh3.py       # resuelve la instancia N, ID, H del inicio del archivo
```

En `modelo_trppdh3.py`, `RESTRICCIONES_20_23` y `RESTRICCIONES_24_29` aceptan
`True`, `False` o `[False, True]` (resuelve con y sin ellas), y `N`, `ID` y `H`
aceptan listas para resolver varias instancias seguidas.

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
