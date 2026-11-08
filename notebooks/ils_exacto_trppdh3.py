"""ILS exacto para el TRPPD-H3 (Algoritmo 4.2 de Erdoğan et al., 2012, adaptado a Σ D_i).

    python ils_exacto_trppdh3.py 10                 # todas las instancias con n = 10
    python ils_exacto_trppdh3.py 30 --banco E --id 1-3
    python ils_exacto_trppdh3.py vigo_n15_id2_h0.5  # una instancia

Búsqueda local iterada (Iterated Local Search):

    1. Soluciones iniciales: las dos de la heurística de 2 fases (sentido del TSP e inverso).
       Desde cada una se hace una corrida independiente y se informa la mejor.
    2. N_iter = 200 veces:
         a. perturbar la mejor ruta con N_rand = round(0,1·n) movimientos relocate o 2-opt
            al azar (solo factibles);
         b. búsqueda local con mejor mejora en relocate ∪ 2-opt hasta un óptimo local;
         c. si mejora la mejor ruta, reemplazarla.

Evaluación exacta: cada vecino se evalúa con el Algoritmo 2.1 + DP (evaluar_exacto), que da
las políticas óptimas de la ruta y su Σ D_i en O(n²). Es la diferencia con
ils_heuristico_trppdh3.py, que usa la regla del umbral en O(n).

Complejidad: el vecindario tiene ~1,5·n² rutas; la búsqueda local hace ~O(n) pasadas después
de cada perturbación (medido; no tiene cota polinomial en teoría). Total
O(N_iter · n² · n · n²) = O(N_iter · n⁵); en las corridas de JavaScript, t ∝ n^5,0.

La perturbación usa un generador con semilla (FNV-1a de "<instancia>|ils_exacto"), así que
cada corrida se puede repetir. Base común en heuristicas_trppdh3.py.
"""

from dos_fases_trppdh3 import dos_fases
from heuristicas_trppdh3 import EPS, ITERACIONES, busqueda_local, ejecutar, perturbar
from heuristicas_trppdh3 import resolver as resolver_comun

CLAVE = "ils_exacto"
NOMBRE = "ILS exacto · Erdoğan et al. (2012)"
EVALUACION = "exacta"


def ils(B, inicial, iteraciones, aleatorios):
    """Algoritmo 4.2 (ILS): perturbación de la mejor ruta y búsqueda local, N_iter veces."""
    mejor_ruta, mejor_costo = inicial, B.exacto(inicial)
    traza = []
    for _ in range(iteraciones):
        ruta = perturbar(B, mejor_ruta, aleatorios)
        ruta, costo = busqueda_local(B, ruta, B.exacto(ruta))
        if costo < mejor_costo - EPS:
            mejor_ruta, mejor_costo = ruta, costo
        traza.append(mejor_costo)
    return {"ruta": mejor_ruta, "costo": mejor_costo, "traza": traza}


def resolver(instancia, iteraciones=ITERACIONES, semilla=None):
    return resolver_comun(instancia, CLAVE, EVALUACION, dos_fases, metodo="ils", buscar=ils,
                          iteraciones=iteraciones, semilla=semilla)


if __name__ == "__main__":
    ejecutar(CLAVE, NOMBRE, resolver)
