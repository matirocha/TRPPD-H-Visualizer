"""ITS heurístico para el TRPPD-H3 (Algoritmo 4.3 de Erdoğan et al., 2012, adaptado a Σ D_i).

    python its_heuristico_trppdh3.py 10                 # todas las instancias con n = 10
    python its_heuristico_trppdh3.py 30 --banco E --id 1-3
    python its_heuristico_trppdh3.py vigo_n15_id2_h0.5  # una instancia

Búsqueda tabú iterada (Iterated Tabu Search), igual que its_exacto_trppdh3.py salvo la
evaluación de los vecinos. Con N_iter = 200, N*_iter = ⌊√200⌋ = 14:

    1. Soluciones iniciales: las dos de la heurística de 2 fases (sentido del TSP e inverso).
       Desde cada una se hace una corrida independiente y se informa la mejor.
    2. N*_iter veces:
         a. perturbar la mejor ruta con N_rand = round(0,1·n) movimientos relocate o 2-opt
            al azar (solo factibles);
         b. búsqueda tabú de N*_iter iteraciones: en cada una se aplica el mejor relocate o
            2-opt no tabú aunque empeore (un movimiento tabú se acepta si mejora la mejor
            solución); la lista tabú guarda el cliente reubicado o el par de posiciones del
            2-opt durante ⌊0,5·n⌋ iteraciones;
         c. si la mejor ruta de la búsqueda tabú mejora la mejor ruta, reemplazarla.

Evaluación heurística: cada vecino se evalúa en O(n) con la regla del umbral de la
Sección 2.2 de Erdoğan (evaluar_heuristico). El movimiento elegido en cada iteración tabú se
vuelve a evaluar con el DP exacto, así que los costos que se comparan son siempre exactos.

Complejidad: 2 · 14 · 14 = 392 exploraciones de ~1,5·n² vecinos de O(n): O(N_iter · n³); en
las corridas de JavaScript, t ∝ n^3,1. Es la más rápida de las metaheurísticas.

La perturbación usa un generador con semilla (FNV-1a de "<instancia>|its_heuristico"), así
que cada corrida se puede repetir. Base común en heuristicas_trppdh3.py.
"""

import math

from dos_fases_trppdh3 import dos_fases
from heuristicas_trppdh3 import EPS, ITERACIONES, ejecutar, perturbar, tabu
from heuristicas_trppdh3 import resolver as resolver_comun

CLAVE = "its_heuristico"
NOMBRE = "ITS heurístico · Erdoğan et al. (2012)"
EVALUACION = "heuristica"


def its(B, inicial, iteraciones, aleatorios):
    """Algoritmo 4.3 (ITS): como ILS, con TS de N*_iter = ⌊√N_iter⌋ iteraciones en vez de la
    búsqueda local, repetido N*_iter veces."""
    internas = int(math.sqrt(iteraciones))
    mejor_ruta, mejor_costo = inicial, B.exacto(inicial)
    traza = []
    for _ in range(internas):
        ruta = perturbar(B, mejor_ruta, aleatorios)
        ruta, costo = tabu(B, ruta, B.exacto(ruta), internas)
        if costo < mejor_costo - EPS:
            mejor_ruta, mejor_costo = ruta, costo
        traza.append(mejor_costo)
    return {"ruta": mejor_ruta, "costo": mejor_costo, "traza": traza}


def resolver(instancia, iteraciones=ITERACIONES, semilla=None):
    return resolver_comun(instancia, CLAVE, EVALUACION, dos_fases, metodo="its", buscar=its,
                          iteraciones=iteraciones, semilla=semilla)


if __name__ == "__main__":
    ejecutar(CLAVE, NOMBRE, resolver)
