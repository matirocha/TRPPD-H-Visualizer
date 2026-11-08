"""Heurística de 2 fases para el TRPPD-H3 (Erdoğan et al., 2012, adaptada a Σ D_i).

    python dos_fases_trppdh3.py 10                 # todas las instancias con n = 10
    python dos_fases_trppdh3.py 30 --banco E       # n = 30 del banco de Erdogan
    python dos_fases_trppdh3.py vigo_n15_id2_h0.5  # una instancia

Fase 1, ruta corta sin mirar la carga. Ciclo TSP por el depósito y los clientes con las
distancias c_ij: vecino más cercano desde cada uno de los n + 1 nodos, mejorado con 2-opt y
Or-opt (tramos de 1 a 3 nodos, en ambos sentidos) con primera mejora; se guarda el más corto.
Erdoğan et al. usan Lin-Kernighan (Concorde); esta versión sirve también con c asimétrica.

Fase 2, reubicación del depósito (Mosheiov). Sin el depósito, el ciclo es una secuencia
circular de clientes; poner el depósito entre dos clientes consecutivos equivale a elegir con
qué cliente empieza la ruta. Para cada sentido (el del TSP y el inverso) se prueban las n
rotaciones: se descartan las que superan Q (la carga solo depende de la ruta) y las demás se
evalúan con el Algoritmo 2.1 adaptado (evaluar_exacto, DP en O(n²)), que elige la política
óptima de cada cliente y da Σ D_i. Se guarda la mejor rotación de cada sentido; la mejor de
las dos es la solución de 2 fases, y las dos son las soluciones iniciales de ILS e ITS.

Complejidad: fase 1 O(n³) a O(n⁴) (vecino más cercano O(n²) desde n + 1 nodos y pasadas de
mejora O(n²)); fase 2 O(n³) (2n rotaciones × O(n²)). No hay búsqueda local: la fase 1
minimiza distancia, no latencia, y la fase 2 no cambia el orden de los clientes.

Traducción de dosFases y tsp de Paginas Web/Pagina Web 1/lib/heuristicas.js; la base común
está en heuristicas_trppdh3.py.
"""

from heuristicas_trppdh3 import EPS, INF, ITERACIONES, ejecutar, evaluar_exacto
from heuristicas_trppdh3 import resolver as resolver_comun

CLAVE = "dos_fases"
NOMBRE = "2 fases · TSP + Algoritmo 2.1 adaptado"


# ------------------------------ Fase 1: TSP ------------------------------

def costo_ciclo(c, t):
    costo = 0
    m = len(t)
    for k in range(m):
        costo += c[t[k]][t[(k + 1) % m]]
    return costo


def vecino_mas_cercano(c, inicio):
    m = len(c)
    visitado = [False] * m
    tour = [inicio]
    visitado[inicio] = True
    while len(tour) < m:
        u = tour[-1]
        mejor = -1
        for v in range(m):
            if not visitado[v] and (mejor < 0 or c[u][v] < c[u][mejor]):
                mejor = v
        tour.append(mejor)
        visitado[mejor] = True
    return tour


def mejorar_tsp(c, tour):
    """2-opt y Or-opt (tramos de 1 a 3 nodos, en ambos sentidos) con primera mejora."""
    m = len(tour)
    t = list(tour)
    mejora = True
    while mejora:
        mejora = False
        # 2-opt: invertir t[i..j]. En c asimétrica se suma el cambio de sentido de los arcos internos.
        for i in range(1, m - 1):
            invertidos = 0
            for j in range(i + 1, m):
                invertidos += c[t[j]][t[j - 1]] - c[t[j - 1]][t[j]]
                a = t[i - 1]
                b = t[(j + 1) % m]
                delta = c[a][t[j]] + c[t[i]][b] - c[a][t[i]] - c[t[j]][b] + invertidos
                if delta < -EPS:
                    t = t[:i] + t[i:j + 1][::-1] + t[j + 1:]
                    mejora = True
                    break
            if mejora:
                break
        if mejora:
            continue
        # Or-opt: mover t[i..i+L−1] entre t[p] y t[p+1], con o sin invertirlo
        for L in range(1, 4):
            i = 1
            while i + L - 1 < m and not mejora:
                tramo = t[i:i + L]
                resto = t[:i] + t[i + L:]
                base = costo_ciclo(c, resto)
                actual = costo_ciclo(c, t)
                for p in range(len(resto)):
                    if p == i - 1:
                        continue
                    sig = resto[(p + 1) % len(resto)]
                    for orden in (tramo, tramo[::-1]):
                        interno = 0
                        for k in range(L - 1):
                            interno += c[orden[k]][orden[k + 1]]
                        nuevo = base - c[resto[p]][sig] + c[resto[p]][orden[0]] + interno + c[orden[L - 1]][sig]
                        if nuevo < actual - EPS:
                            t = resto[:p + 1] + list(orden) + resto[p + 1:]
                            mejora = True
                            break
                    if mejora:
                        break
                i += 1
            if mejora:
                break
    return t


def tsp(c):
    """Ciclo TSP por todos los nodos (depósito incluido), rotado para empezar en 0."""
    mejor = None
    costo = INF
    for inicio in range(len(c)):
        t = mejorar_tsp(c, vecino_mas_cercano(c, inicio))
        k = costo_ciclo(c, t)
        if k < costo - EPS:
            costo = k
            cero = t.index(0)
            mejor = t[cero:] + t[:cero]
    return {"tour": mejor, "costo": costo}


# ------------------- Fase 2: reubicación del depósito -------------------

def dos_fases(P):
    """Para cada sentido del ciclo TSP (el del TSP y el inverso) evalúa las n rotaciones
    factibles con el Algoritmo 2.1 adaptado y guarda la mejor."""
    ciclo = tsp(P.c)
    circulo = ciclo["tour"][1:]
    direcciones = []
    for d, sec in enumerate((circulo, circulo[::-1])):
        mejor = {"ruta": None, "costo": INF, "rotacion": None}
        factibles = 0
        for r in range(len(sec)):
            ruta = sec[r:] + sec[:r]
            costo = evaluar_exacto(P, ruta)
            if costo == INF:
                continue
            factibles += 1
            if costo < mejor["costo"] - EPS:
                mejor = {"ruta": ruta, "costo": costo, "rotacion": r}
        direcciones.append({"direccion": "tsp" if d == 0 else "inversa", **mejor, "factibles": factibles})
    return {"tsp": ciclo, "direcciones": direcciones}


def resolver(instancia, iteraciones=ITERACIONES, semilla=None):
    """Solución de 2 fases de una instancia (iteraciones no se usa: no hay búsqueda)."""
    return resolver_comun(instancia, CLAVE, "exacta", dos_fases, semilla=semilla)


if __name__ == "__main__":
    ejecutar(CLAVE, NOMBRE, resolver)
