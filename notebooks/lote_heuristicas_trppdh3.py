"""Corridas por lote de las 5 heurísticas de Erdoğan et al. (2012) adaptadas al TRPPD-H3.

    python lote_heuristicas_trppdh3.py all        # N = 80, 100, ..., 200 (banco de Erdogan)
    python lote_heuristicas_trppdh3.py 80         # solo N = 80 (también 80,100 o 80-120)
    python lote_heuristicas_trppdh3.py 200 --alg ils_exacto --replicas 3-4 --id 1

Algoritmos (Sección 4 del paper, con el objetivo Σ D_i en vez de viaje + manipulación):

    dos_fases        TSP (vecino más cercano + 2-opt + Or-opt) y reubicación del depósito
    ils_heuristico   ILS (Algoritmo 4.2) con evaluación heurística de los vecinos, O(n)
    ils_exacto       ILS con evaluación exacta (Algoritmo 2.1 + DP), O(n²)
    its_heuristico   ITS (Algoritmo 4.3) con evaluación heurística
    its_exacto       ITS con evaluación exacta

Parámetros de Erdoğan et al.: N_iter = 200 por solución inicial (ITS: ⌊√200⌋ = 14 iteraciones
externas y 14 de tabú), N_rand = round(0,1·n), tenencia tabú ⌊0,5·n⌋, dos soluciones iniciales
(sentido del TSP e inverso). Cada algoritmo se corre REPLICAS veces por instancia; la réplica r
usa la semilla r, y con la misma semilla da las mismas rutas que la versión JavaScript de la
Página Web 1 (npm run heuristicas). 2 fases no usa azar: se repite solo para promediar el tiempo.

Después de cada réplica, en la misma carpeta de este script,

  - reescribe heuristicas_erdogan.xlsx con todas las réplicas hechas: una fila por instancia
    (BKS, costo promedio y mejor de cada algoritmo, GAP y tiempos), una por réplica y las
    definiciones de cada columna, y
  - guarda la mejor réplica de cada algoritmo en erdogan/<algoritmo>/<instancia>.json, el
    formato trppdh3-salida/1 que lee la Página Web 1 (copiando la carpeta a Outputs/erdogan/).

Con REANUDAR = True las réplicas que ya están en el Excel no se repiten, así que basta volver a
ejecutar el script para seguir después de cortarlo. Varios procesos pueden correr a la vez
(p. ej. uno por algoritmo, N o réplica, cada uno en un núcleo) y escriben el mismo Excel sin
borrarse filas entre sí.

El script es autónomo: solo necesita la carpeta Instancias/ (junto al script o una carpeta más
arriba) y openpyxl. Si NumPy está instalado, la evaluación exacta usa una versión vectorizada
del DP que da exactamente los mismos números y es mucho más rápida con n grande.
"""

import json
import math
import os
import platform
import re
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

try:
    import numpy as np
except ImportError:   # sin NumPy se usa el DP en Python puro (mismos resultados, más lento)
    np = None

# ============================ Corridas ============================
REPLICAS = range(1, 11)   # réplicas por instancia y algoritmo; la réplica r usa la semilla r
ITERACIONES = 200         # N_iter de Erdoğan et al. por solución inicial (ITS usa ⌊√N_iter⌋)
MOSTRAR_ITERACIONES = False   # imprime el avance de ILS e ITS en cada iteración
REANUDAR = True           # no repite las réplicas que ya están en el Excel
LIMITE_TIEMPO = 3600      # segundos por réplica (2 fases + búsqueda); None = sin límite
# ==================================================================

# Instancias grandes de Erdoğan et al. (2012): N = 80 a 200, ID 1 a 10, h = 20/N, archivos
# Instancias/vigo_n<N>_id<ID>_h<h>_Erdogan.json
BANCO = "Erdogan"
TAMANOS = [80, 100, 120, 140, 160, 180, 200]
IDS = range(1, 11)

# Del más barato al más caro: así el Excel tiene pronto los resultados de los rápidos
ALGORITMOS = {
    "dos_fases": {"nombre": "2 fases · TSP + Algoritmo 2.1 adaptado", "corto": "2 fases",
                  "titulo": "Heurística 2 fases", "evaluacion": "exacta", "metodo": None},
    "its_heuristico": {"nombre": "ITS heurístico · Erdoğan et al. (2012)", "corto": "ITS heurístico",
                       "titulo": "ITS heurístico", "evaluacion": "heuristica", "metodo": "its"},
    "ils_heuristico": {"nombre": "ILS heurístico · Erdoğan et al. (2012)", "corto": "ILS heurístico",
                       "titulo": "ILS heurístico", "evaluacion": "heuristica", "metodo": "ils"},
    "its_exacto": {"nombre": "ITS exacto · Erdoğan et al. (2012)", "corto": "ITS exacto",
                   "titulo": "ITS exacto", "evaluacion": "exacta", "metodo": "its"},
    "ils_exacto": {"nombre": "ILS exacto · Erdoğan et al. (2012)", "corto": "ILS exacto",
                   "titulo": "ILS exacto", "evaluacion": "exacta", "metodo": "ils"},
}

CARPETA_SCRIPT = Path(__file__).resolve().parent
# Instancias/ junto al script o una carpeta más arriba (estructura del repositorio)
CARPETA_INSTANCIAS = next((c / "Instancias" for c in (CARPETA_SCRIPT, CARPETA_SCRIPT.parent)
                           if (c / "Instancias").is_dir()), CARPETA_SCRIPT / "Instancias")
CARPETA_SALIDA = CARPETA_SCRIPT   # JSON y Excel, junto a este script
FORMATO = "trppdh3-salida/1"
MOTOR = f"Python {platform.python_version()}" + (f" + NumPy {np.__version__}" if np else "")

EPS = 1e-9
INF = math.inf
M32 = 0xFFFFFFFF
# Desde este n el DP vectorizado es más rápido que el de Python puro (dan lo mismo)
N_NUMPY = 25


# ------------------------------ Instancia ------------------------------

def leer_instancia(n, id_, h, sufijo=""):
    nombre = f"vigo_n{n}_id{id_}_h{h:g}" + (f"_{sufijo}" if sufijo else "")
    archivo = CARPETA_INSTANCIAS / f"{nombre}.json"
    if not archivo.exists():
        raise FileNotFoundError(f"No existe {archivo}; la carpeta Instancias debe estar "
                                f"junto al script o una carpeta más arriba")
    return json.loads(archivo.read_text(encoding="utf-8"))


def instancias_de(n, sufijo):
    """Instancias de Instancias/ con ese n y sufijo, por id y h (cada n tiene sus valores de h)."""
    patron = re.compile(rf"vigo_n{n}_id(\d+)_h([\d.]+){'_' + sufijo if sufijo else ''}\.json$")
    encontradas = []
    for archivo in CARPETA_INSTANCIAS.glob(f"vigo_n{n}_id*.json"):
        m = patron.match(archivo.name)
        if m:
            encontradas.append((int(m.group(1)), float(m.group(2)), archivo))
    return [json.loads(a.read_text(encoding="utf-8")) for _, _, a in sorted(encontradas)]


class Problema:
    """Datos de la instancia por nodo (índice 0 = depósito) y memoria de trabajo."""

    def __init__(self, instancia):
        n = int(instancia["n"])
        nodos = n + 1

        def vector(v):
            return [float(x) for x in v] if isinstance(v, list) else [float(v)] * nodos

        self.n = n
        self.c = [[float(x) for x in fila] for fila in instancia["c"]]
        self.alpha = vector(instancia["alpha"])
        self.beta = vector(instancia["beta"])
        self.alpha[0] = 0.0
        self.beta[0] = 0.0
        self.ua, self.la, self.ub, self.lb = (vector(instancia[p]) for p in ("ua", "la", "ub", "lb"))
        self.ha = [u + l for u, l in zip(self.ua, self.la)]
        self.hb = [u + l for u, l in zip(self.ub, self.lb)]
        self.suma_alpha = sum(self.alpha)
        q = instancia.get("Q")
        self.Q = float(q) if q is not None else max(self.suma_alpha, sum(self.beta))
        # Memoria de trabajo de las evaluaciones, para no reservarla en cada vecino
        self.f = [0.0] * nodos
        self.sig = [0] * nodos
        self.suf_a = [0.0] * nodos
        self.suf_b = [0.0] * nodos
        self.suf_ha = [0.0] * nodos
        self.suf_hb = [0.0] * nodos
        self.vectorizado = np is not None and n >= N_NUMPY
        if self.vectorizado:
            self.np_alpha, self.np_beta = np.array(self.alpha), np.array(self.beta)
            self.np_ub, self.np_lb, self.np_ha = np.array(self.ub), np.array(self.lb), np.array(self.ha)
            self.np_W = np.arange(n, 0, -1, dtype=float)   # peso de la posición k: n − k
            self.np_triu = np.triu(np.ones((n, n), dtype=bool))


def factible(P, ruta):
    """La carga a bordo (y + w + z) no depende de las políticas: solo de la ruta."""
    carga = P.suma_alpha
    if carga > P.Q + EPS:
        return False
    alpha, beta, tope = P.alpha, P.beta, P.Q + EPS
    for i in ruta:
        carga += beta[i] - alpha[i]
        if carga > tope:
            return False
    return True


def parte_fija(P, ruta):
    """Viaje y operaciones obligatorias con sus pesos; INF si la ruta supera Q."""
    if not factible(P, ruta):
        return INF
    n, c, alpha, beta, ua, lb = P.n, P.c, P.alpha, P.beta, P.ua, P.lb
    fijo = 0.0
    previo = 0
    for k in range(n):
        i = ruta[k]
        fijo += (n - k) * (c[previo][i] + ua[i] * alpha[i]) + (n - k - 1) * lb[i] * beta[i]
        previo = i
    return fijo


def politica_de(ruta, con_p2):
    """Política de cada cliente {cliente: s}: s = 0 es la Política 2 y s = 1 la Política 1."""
    return {int(i): (0 if con_p2[k] else 1) for k, i in enumerate(ruta)}


# --------------------- Evaluación de una ruta fija ---------------------

def _dp_python(P, ruta):
    """DP de evaluar_exacto en Python puro: llena P.f y P.sig y devuelve f(0)."""
    n, alpha, beta, ub, lb, ha = P.n, P.alpha, P.beta, P.ub, P.lb, P.ha
    f, sig, suf_a = P.f, P.sig, P.suf_a
    suf_a[n] = 0.0
    for k in range(n - 1, -1, -1):
        suf_a[k] = suf_a[k + 1] + alpha[ruta[k]]
    f[n] = 0.0
    for i in range(n - 1, -1, -1):
        z = 0.0
        theta = 0.0
        mejor = INF
        arg = n
        for j in range(i + 1, n + 1):
            cl = ruta[j - 1]
            W = n - j + 1
            base = (ub[cl] * W + lb[cl] * (W - 1)) * z
            # Sin recogidas que mover, la Política 2 equivale a la 1 (Erdoğan: p_ij = θ)
            p = theta + base + (ha[cl] * suf_a[j] * (W - 1) if z + beta[cl] > 0 else 0)
            if p + f[j] < mejor:
                mejor = p + f[j]
                arg = j
            theta += base
            z += beta[cl]
        f[i] = mejor
        sig[i] = arg
    return f[0]


def _dp_numpy(P, ruta):
    """El mismo DP con la matriz p_ij armada de una vez (fila i = última Política 2, columna
    k = posición j − 1). Las sumas se hacen en el mismo orden que _dp_python, así que los
    resultados son idénticos: z es una suma de enteros y θ una suma acumulada por fila."""
    n = P.n
    r = np.fromiter(ruta, dtype=np.intp, count=n)
    W = P.np_W
    beta = P.np_beta[r]
    A = P.np_ub[r] * W + P.np_lb[r] * (W - 1)
    suf_a = np.zeros(n + 1)
    suf_a[:n] = np.cumsum(P.np_alpha[r][::-1])[::-1]
    H = P.np_ha[r] * suf_a[1:] * (W - 1)
    bc = np.zeros(n + 1)
    bc[1:] = np.cumsum(beta)
    Z = bc[None, :n] - bc[:n, None]                    # recogidas a bordo antes de la posición k
    base = np.where(P.np_triu, A[None, :] * Z, 0.0)
    theta = np.zeros((n, n))
    theta[:, 1:] = np.cumsum(base, axis=1)[:, :-1]    # suma de base antes de k (ceros antes de i)
    p = theta + base + np.where(Z + beta[None, :] > 0, H[None, :], 0.0)
    f = np.zeros(n + 1)
    sig = P.sig
    for i in range(n - 1, -1, -1):
        v = p[i, i:] + f[i + 1:]
        k = int(v.argmin())                             # primer mínimo, como "<" en _dp_python
        f[i] = v[k]
        sig[i] = i + 1 + k
    return float(f[0])


def evaluar_exacto(P, ruta, con_politica=False, cota=INF):
    """Algoritmo 2.1 + DP adaptados a Σ D_i, en O(n²).

    f(i) es el costo mínimo de manipulación de las posiciones i+1..n si en i se aplicó la
    Política 2 (i = 0: depósito); p_ij es el costo de aplicar la Política 1 en i+1..j−1 y la
    Política 2 en j. En la posición j (peso W = n − j + 1):
        retirar y recargar las z recogidas junto a la puerta:  (u_b·W + ℓ_b·(W − 1))·z
        Política 2: retirar y recargar las entregas que siguen: h_a·y·(W − 1)
    Con j = n la Política 2 no cuesta (W − 1 = 0), así que p_in es "Política 1 hasta el final".
    Devuelve Σ D_i, o (Σ D_i, política) con con_politica.

    Poda: Σ D_i = parte fija + f(0) con f(0) ≥ 0. Si la parte fija ya alcanza la cota (el valor
    que el vecino tendría que superar para ser elegido), el vecino no puede ganar y se devuelve
    INF sin hacer el DP; la búsqueda elige los mismos vecinos que sin poda.
    """
    fijo = parte_fija(P, ruta)
    if fijo == INF or fijo >= cota:
        return (INF, None) if con_politica else INF
    costo = fijo + (_dp_numpy(P, ruta) if P.vectorizado else _dp_python(P, ruta))
    if not con_politica:
        return costo

    n, beta, sig = P.n, P.beta, P.sig
    con_p2 = [False] * n
    i = 0
    while i < n:
        j = sig[i]
        z = 0.0
        for k in range(i, j - 1):
            z += beta[ruta[k]]
        if j < n and z + beta[ruta[j - 1]] > 0:
            con_p2[j - 1] = True
        i = j
    return costo, politica_de(ruta, con_p2)


def primer_tramo(N, gamma):
    """Largo del primer tramo con Política 1, k*_1, del caso especial de la Sección 2.2
    (N clientes con ᾱ entregas y β̄ recogidas), fórmulas (13) y (14) con r = h_b·β̄ / (h_a·ᾱ):
        p* = ⌊(1 − 2r + √((2r − 1)² + 8·N·r)) / 2⌋        k*_1 = ((p* − 1)/2) / r + N / p*
    Si p* < 2 no conviene la Política 2 (INF)."""
    if N < 2:
        return INF
    if gamma < 1e-12:
        return 1
    r = 1 / gamma
    p = math.floor((1 - 2 * r + math.sqrt((2 * r - 1) ** 2 + 8 * N * r)) / 2)
    if p < 2:
        return INF
    return max(1, (gamma * (p - 1)) / 2 + N / p)


def evaluar_heuristico(P, ruta, con_politica=False, cota=INF):
    """Evaluación heurística en O(n), como la de Erdoğan et al. con el umbral 2 (recogidas a bordo).

    Al salir del depósito y después de cada Política 2 se calcula k*_1 con los promedios de los
    clientes que faltan, y se aplica la Política 2 en el primer cliente en que las recogidas junto
    a la puerta (las que había más las suyas) alcanzan k*_1·β̄. El costo de esas decisiones se
    mide con los pesos de latencia, igual que en evaluar_exacto, y tiene la misma poda.
    """
    fijo = parte_fija(P, ruta)
    if fijo == INF or fijo >= cota:
        return (INF, None) if con_politica else INF
    n, alpha, beta, ub, lb, ha, hb = P.n, P.alpha, P.beta, P.ub, P.lb, P.ha, P.hb
    suf_a, suf_b, suf_ha, suf_hb = P.suf_a, P.suf_b, P.suf_ha, P.suf_hb
    suf_a[n] = suf_b[n] = suf_ha[n] = suf_hb[n] = 0.0
    for k in range(n - 1, -1, -1):
        i = ruta[k]
        suf_a[k] = suf_a[k + 1] + alpha[i]
        suf_b[k] = suf_b[k + 1] + beta[i]
        suf_ha[k] = suf_ha[k + 1] + ha[i]
        suf_hb[k] = suf_hb[k + 1] + hb[i]

    def umbral(i):
        """Umbral para los clientes de las posiciones i+1..n (i = última Política 2)."""
        N = n - i
        if suf_b[i] <= 0 or suf_hb[i] <= 0:
            return INF
        return primer_tramo(N, (suf_ha[i] * suf_a[i]) / (suf_hb[i] * suf_b[i])) * (suf_b[i] / N)

    con_p2 = [False] * n if con_politica else None
    costo = 0.0
    z = 0.0
    tope = umbral(0)
    for j in range(1, n + 1):
        cl = ruta[j - 1]
        W = n - j + 1
        costo += (ub[cl] * W + lb[cl] * (W - 1)) * z
        if j < n and z + beta[cl] > 0 and z + beta[cl] >= tope - EPS:
            costo += ha[cl] * suf_a[j] * (W - 1)
            if con_politica:
                con_p2[j - 1] = True
            z = 0.0
            tope = umbral(j)
        else:
            z += beta[cl]
    if con_politica:
        return fijo + costo, politica_de(ruta, con_p2)
    return fijo + costo


# ------------------------- Números al azar -------------------------

def _imul(a, b):
    """Producto de enteros de 32 bits (Math.imul de JavaScript), como entero sin signo."""
    return (a * b) & M32


def crear_azar(semilla):
    """Generador en [0, 1) con semilla (mulberry32), igual al de la versión JavaScript."""
    estado = semilla & M32

    def azar():
        nonlocal estado
        estado = (estado + 0x6D2B79F5) & M32
        t = _imul(estado ^ (estado >> 15), 1 | estado)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return azar


# ----------------------- Vecindarios y búsqueda -----------------------

def relocate(ruta, i, p, destino):
    """Relocate: el cliente de la posición i pasa a la posición p."""
    x = ruta[i]
    k = 0
    for m in range(len(ruta)):
        if m == i:
            continue
        if k == p:
            destino[k] = x
            k += 1
        destino[k] = ruta[m]
        k += 1
    if k == p:
        destino[k] = x
    return destino


def dos_opt(ruta, i, j, destino):
    """2-opt: invierte las posiciones i..j (i < j); quita los arcos que entran a i y salen de j."""
    for m in range(len(ruta)):
        destino[m] = ruta[m] if m < i or m > j else ruta[i + j - m]
    return destino


class TiempoAgotado(Exception):
    """Se acabó el tiempo de la corrida (LIMITE_TIEMPO)."""


class Busqueda:
    """Contexto de una corrida: la evaluación de los vecinos (exacta o heurística) y el conteo
    de evaluaciones. Con la heurística, el mejor vecino se vuelve a evaluar con el DP exacto
    (Sección 4 de Erdoğan, tercer aspecto común), así que los costos que se comparan son
    siempre exactos."""

    def __init__(self, P, evaluacion, azar):
        self.P = P
        self.n = P.n
        self.evaluacion = evaluacion
        self.azar = azar
        self.cuenta = {"exactas": 0, "heuristicas": 0}
        self.buffer = [0] * P.n
        self.vecino = self.exacto if evaluacion == "exacta" else self._heuristico
        self.plazo = None       # time.perf_counter() en que se acaba el tiempo de esta corrida
        self.agotado = False

    def revisar(self):
        """Corta la búsqueda (TiempoAgotado) si se pasó el plazo."""
        if self.plazo is not None and time.perf_counter() > self.plazo:
            self.agotado = True
            raise TiempoAgotado

    # Las evaluaciones se cuentan aunque la poda evite el DP: son los vecinos revisados
    def exacto(self, ruta, cota=INF):
        self.cuenta["exactas"] += 1
        return evaluar_exacto(self.P, ruta, cota=cota)

    def _heuristico(self, ruta, cota=INF):
        self.cuenta["heuristicas"] += 1
        return evaluar_heuristico(self.P, ruta, cota=cota)


def explorar(B, ruta, visitar, cota):
    """Recorre relocate (n(n − 1) vecinos) y 2-opt (n(n − 1)/2). visitar(tipo, i, j, valor, ruta)
    recibe cada vecino factible que pueda ser elegido; la ruta es un buffer que se reutiliza.
    cota() es el valor que un vecino tiene que superar para ser elegido (poda)."""
    n, buffer, vecino = B.n, B.buffer, B.vecino
    for i in range(n):
        B.revisar()
        for p in range(n):
            if p == i:
                continue
            valor = vecino(relocate(ruta, i, p, buffer), cota())
            if valor < INF:
                visitar("relocate", i, p, valor, buffer)
    for i in range(n - 1):
        B.revisar()
        for j in range(i + 1, n):
            valor = vecino(dos_opt(ruta, i, j, buffer), cota())
            if valor < INF:
                visitar("2opt", i, j, valor, buffer)


def busqueda_local(B, ruta, costo):
    """Búsqueda local con mejor mejora en relocate ∪ 2-opt ("Perform Best Move" del
    Algoritmo 4.2). Repite hasta que ningún vecino mejora. Devuelve (ruta, costo); si se acaba
    el tiempo, la ruta a la que había llegado."""
    while True:
        mejor = None
        valor_mejor = INF

        def visitar(_tipo, _i, _j, valor, r):
            nonlocal mejor, valor_mejor
            if valor < valor_mejor - EPS:
                valor_mejor = valor
                mejor = list(r)

        # Un vecino se elige solo si baja de valor_mejor − EPS
        try:
            explorar(B, ruta, visitar, lambda: valor_mejor - EPS)
        except TiempoAgotado:
            return ruta, costo
        if mejor is None:
            return ruta, costo
        exacto = valor_mejor if B.evaluacion == "exacta" else B.exacto(mejor)
        if exacto >= costo - EPS:
            return ruta, costo
        ruta, costo = mejor, exacto


def tabu(B, ruta, costo, iteraciones):
    """Algoritmo 4.1 (TS). En cada iteración se aplica el mejor relocate o 2-opt no tabú, aunque
    empeore; un movimiento tabú se acepta si mejora la mejor solución (aspiración). La lista tabú
    guarda el cliente reubicado (relocate) o el par de posiciones (2-opt) durante ⌊0,5·n⌋
    iteraciones. Devuelve la mejor (ruta, costo) visitada."""
    tenencia = max(1, math.floor(0.5 * B.n))
    lista = []
    es_tabu = set()
    actual = ruta
    mejor_ruta, mejor_costo = ruta, costo
    for _ in range(iteraciones):
        elegido = None
        valor_elegido = INF

        def visitar(tipo, i, j, valor, r):
            nonlocal elegido, valor_elegido
            clave = ("r", actual[i]) if tipo == "relocate" else ("o", i, j)
            if clave in es_tabu and not (valor < mejor_costo - EPS):
                return
            if valor < valor_elegido - EPS:
                valor_elegido = valor
                elegido = (clave, list(r))

        # Tabú o no, un vecino se elige solo si baja de valor_elegido − EPS
        try:
            explorar(B, actual, visitar, lambda: valor_elegido - EPS)
        except TiempoAgotado:
            break
        if elegido is None:
            break
        clave, actual = elegido
        costo_actual = valor_elegido if B.evaluacion == "exacta" else B.exacto(actual)
        lista.append(clave)
        es_tabu.add(clave)
        if len(lista) > tenencia:
            es_tabu.discard(lista.pop(0))
        if costo_actual < mejor_costo - EPS:
            mejor_ruta, mejor_costo = actual, costo_actual
    return mejor_ruta, mejor_costo


def perturbar(B, ruta, veces):
    """N_rand movimientos al azar (Algoritmo 4.2): relocate si i = j, 2-opt si no. Solo
    factibles: hasta 100 intentos por movimiento."""
    n, azar, P = B.n, B.azar, B.P

    def entero(k):
        return math.floor(azar() * k)

    actual = ruta
    for _ in range(veces):
        for _intento in range(100):
            i = entero(n)
            j = entero(n)
            if i == j:
                p = entero(n - 1)
                if p >= i:
                    p += 1
                candidata = relocate(actual, i, p, [0] * n)
            else:
                candidata = dos_opt(actual, min(i, j), max(i, j), [0] * n)
            if factible(P, candidata):
                actual = candidata
                break
    return actual


# ------------------------- Heurística de 2 fases -------------------------

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


def dos_fases(P):
    """Fase 1: ciclo TSP. Fase 2 (Mosheiov): para cada sentido del ciclo (el del TSP y el
    inverso) se evalúan las n rotaciones factibles con el Algoritmo 2.1 adaptado y se guarda la
    mejor. Las dos son las soluciones iniciales de ILS e ITS."""
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


# ------------------------------ ILS e ITS ------------------------------

def _avance(metodo, it, total, costo):
    if MOSTRAR_ITERACIONES:
        print(f"      {metodo} iteración {it}/{total}  Σ D = {costo:.2f}", flush=True)


def _sin_tiempo(B):
    """True si ya se cortó la búsqueda o se pasó el plazo (no empieza otra iteración)."""
    if not B.agotado and B.plazo is not None and time.perf_counter() > B.plazo:
        B.agotado = True
    return B.agotado


def ils(B, inicial, iteraciones, aleatorios):
    """Algoritmo 4.2 (ILS): perturbación de la mejor ruta y búsqueda local, N_iter veces."""
    mejor_ruta, mejor_costo = inicial, B.exacto(inicial)
    traza, marcas = [], []
    for it in range(iteraciones):
        if _sin_tiempo(B):
            break
        ruta = perturbar(B, mejor_ruta, aleatorios)
        ruta, costo = busqueda_local(B, ruta, B.exacto(ruta))
        if costo < mejor_costo - EPS:
            mejor_ruta, mejor_costo = ruta, costo
        traza.append(mejor_costo)
        marcas.append(time.perf_counter())
        _avance("ILS", it + 1, iteraciones, mejor_costo)
    return {"ruta": mejor_ruta, "costo": mejor_costo, "traza": traza, "marcas": marcas}


def its(B, inicial, iteraciones, aleatorios):
    """Algoritmo 4.3 (ITS): como ILS, con TS de N*_iter = ⌊√N_iter⌋ iteraciones en vez de la
    búsqueda local, repetido N*_iter veces."""
    internas = int(math.sqrt(iteraciones))
    mejor_ruta, mejor_costo = inicial, B.exacto(inicial)
    traza, marcas = [], []
    for it in range(internas):
        if _sin_tiempo(B):
            break
        ruta = perturbar(B, mejor_ruta, aleatorios)
        ruta, costo = tabu(B, ruta, B.exacto(ruta), internas)
        if costo < mejor_costo - EPS:
            mejor_ruta, mejor_costo = ruta, costo
        traza.append(mejor_costo)
        marcas.append(time.perf_counter())
        _avance("ITS", it + 1, internas, mejor_costo)
    return {"ruta": mejor_ruta, "costo": mejor_costo, "traza": traza, "marcas": marcas}


def resolver(instancia, clave, semilla, iteraciones=ITERACIONES):
    """Corre un algoritmo sobre una instancia con una semilla.

    La metaheurística parte una vez de cada solución inicial de 2 fases (versión 2dir de Erdoğan)
    y se informa la mejor; 2 fases devuelve la mejor solución inicial. El tiempo incluye las
    2 fases. Mide también la convergencia: iteraciones de las dos corridas y el momento en que se
    alcanzó por primera vez la mejor Σ D informada (iteración 0 si ya era una solución inicial).

    Límite de tiempo: la réplica completa (2 fases + búsqueda) dura a lo más LIMITE_TIEMPO. El
    tiempo que queda después de las 2 fases se reparte por igual entre las dos corridas (sentido
    del TSP e inverso): si la primera termina antes, la segunda usa lo que sobró. Al acabarse, la
    corrida deja de iterar y se queda con la mejor ruta que tenía. Con el corte, el resultado ya
    no depende solo de la semilla, sino también de la velocidad del computador.
    """
    alg = ALGORITMOS[clave]
    metodo = alg["metodo"]
    inicio = time.perf_counter()
    P = Problema(instancia)
    n_rand = max(1, math.floor(0.1 * P.n + 0.5))
    inicial = dos_fases(P)
    segundos_inicial = time.perf_counter() - inicio
    B = Busqueda(P, alg["evaluacion"], crear_azar(semilla))

    corridas = []
    validas = [d for d in inicial["direcciones"] if d["ruta"] is not None]
    agotado = False
    for k, d in enumerate(validas):
        if metodo is None:
            res = {"ruta": d["ruta"], "costo": d["costo"], "traza": [], "marcas": []}
        else:
            if LIMITE_TIEMPO is not None:
                ahora = time.perf_counter()
                B.plazo = ahora + (inicio + LIMITE_TIEMPO - ahora) / (len(validas) - k)
                B.agotado = False
            res = (ils if metodo == "ils" else its)(B, d["ruta"], iteraciones, n_rand)
            agotado = agotado or B.agotado
        corridas.append({"direccion": d["direccion"], "inicial": d["costo"], **res})
    if not corridas:
        raise ValueError("Ninguna rotación del ciclo TSP respeta la capacidad Q")
    mejor = corridas[0]
    for otra in corridas[1:]:
        if otra["costo"] < mejor["costo"] - EPS:
            mejor = otra
    costo, politica = evaluar_exacto(P, mejor["ruta"], True)
    segundos = time.perf_counter() - inicio

    iteraciones_totales = sum(len(c["traza"]) for c in corridas)
    iteracion_mejor, segundos_mejor, previas = 0, segundos_inicial, 0
    for c in corridas:
        if c is mejor:
            if c["inicial"] > c["costo"] + EPS:
                k = next(k for k, x in enumerate(c["traza"]) if x <= c["costo"] + EPS)
                iteracion_mejor = previas + k + 1
                segundos_mejor = c["marcas"][k] - inicio
            break
        previas += len(c["traza"])
    segundos_busqueda = segundos - segundos_inicial
    raiz = int(math.sqrt(iteraciones))
    return {
        "clave": clave,
        "ruta": [0, *map(int, mejor["ruta"]), 0],
        "politica": politica,
        "objetivo": costo,
        "segundos": segundos,
        "segundos_inicial": segundos_inicial,
        "segundos_busqueda": segundos_busqueda,
        "iteraciones": iteraciones_totales,
        # Tiempo de búsqueda (sin las 2 fases) dividido por las iteraciones de las dos corridas
        "segundos_por_iteracion": segundos_busqueda / iteraciones_totales if iteraciones_totales else None,
        "iteracion_mejor": iteracion_mejor,
        "segundos_mejor": segundos_mejor,
        "tiempo_agotado": agotado,
        "parametros": {
            "evaluacion": alg["evaluacion"],
            "metodo": metodo,
            "direcciones": 2,
            "iteraciones": raiz if metodo == "its" else iteraciones if metodo else None,
            "iteraciones_tabu": raiz if metodo == "its" else None,
            "tenencia_tabu": max(1, math.floor(0.5 * P.n)) if metodo == "its" else None,
            "movimientos_aleatorios": n_rand if metodo else None,
            "semilla": semilla if metodo else None,
            "limite_tiempo": LIMITE_TIEMPO,
        },
        "tsp": inicial["tsp"],
        "corridas": [{"direccion": c["direccion"], "inicial": c["inicial"], "final": c["costo"],
                      "ruta": [0, *map(int, c["ruta"]), 0], "traza": c["traza"],
                      # segundos desde el inicio de la corrida al cerrar cada iteración
                      "tiempos": [m - inicio for m in c["marcas"]]} for c in corridas],
        "evaluaciones": dict(B.cuenta),
    }


# ------------------------------ JSON ------------------------------

def _r6(x):
    return None if x is None else round(x, 6)


def banco_de(nombre):
    return "Erdogan" if nombre.endswith("_Erdogan") else "Battarra"


def archivo_json(clave, nombre):
    return CARPETA_SALIDA / "erdogan" / clave / f"{nombre}.json"


def guardar_si_mejora(instancia, res):
    """Escribe erdogan/<algoritmo>/<instancia>.json si esta réplica mejora la guardada."""
    archivo = archivo_json(res["clave"], instancia["nombre"])
    if archivo.exists():
        guardada = json.loads(archivo.read_text(encoding="utf-8"))["solucion"]["objetivo"]
        if res["objetivo"] >= guardada - EPS:
            return False
    z = res["objetivo"]
    salida = {
        "formato": FORMATO,
        "generado": datetime.now().isoformat(timespec="seconds"),
        "algoritmo": {
            "clave": res["clave"],
            "nombre": ALGORITMOS[res["clave"]]["nombre"],
            "parametros": {"familia": "erdogan", **res["parametros"], "motor": MOTOR},
        },
        "instancia": instancia,
        "solucion": {
            "ruta": res["ruta"],
            "politica": res["politica"],
            "estado": "HEURISTICA",
            "objetivo": _r6(z),
            "segundos": _r6(res["segundos"]),
            "segundos_inicial": _r6(res["segundos_inicial"]),
            "segundos_total": _r6(res["segundos"]),
            "segundos_busqueda": _r6(res["segundos_busqueda"]),
            "iteraciones": res["iteraciones"],
            "segundos_por_iteracion": _r6(res["segundos_por_iteracion"]),
            "iteracion_mejor": res["iteracion_mejor"],
            "segundos_mejor": _r6(res["segundos_mejor"]),
            "tiempo_agotado": res["tiempo_agotado"],
            "evaluaciones": res["evaluaciones"],
            "tsp": res["tsp"],
            "corridas": [{**c, "inicial": _r6(c["inicial"]), "final": _r6(c["final"]),
                          "traza": [_r6(x) for x in c["traza"]],
                          "tiempos": [_r6(x) for x in c["tiempos"]]} for c in res["corridas"]],
        },
    }
    archivo.parent.mkdir(parents=True, exist_ok=True)
    temporal = archivo.with_suffix(".tmp")
    temporal.write_text(json.dumps(salida, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporal, archivo)
    return True


# ------------------------------ Excel ------------------------------

NUM = "#,##0.00"
PCT = "0.00%"
ENTERO = "#,##0"
SEG = "#,##0.000"

# Hoja de réplicas, una fila por instancia × algoritmo × réplica: (clave, encabezado, formato,
# ancho). Las claves son las columnas de Outputs/resumenes/heuristicas_replicas.csv.
COLUMNAS = [
    ("banco", "Banco", None, 10),
    ("instancia", "Instancia", None, 30),
    ("n", "N", None, 6),
    ("id", "ID", None, 6),
    ("h", "h", None, 9),
    ("algoritmo", "Algoritmo", None, 15),
    ("replica", "Réplica", None, 8),
    ("semilla", "Semilla", None, 8),
    ("costo", "Costo", NUM, 12),
    ("segundos", "Tiempo (s)", SEG, 11),
    ("segundos_inicial", "Tiempo 2 fases (s)", SEG, 11),
    ("segundos_busqueda", "Tiempo búsqueda (s)", SEG, 11),
    ("iteraciones", "Iteraciones", ENTERO, 11),
    ("segundos_por_iteracion", "Tiempo por iteración (s)", SEG, 12),
    ("iteracion_mejor", "Iteración del mejor", ENTERO, 11),
    ("segundos_mejor", "Tiempo al mejor (s)", SEG, 11),
    ("evaluaciones_exactas", "Evaluaciones exactas", ENTERO, 13),
    ("evaluaciones_heuristicas", "Evaluaciones heurísticas", ENTERO, 13),
    ("n_iter", "N_iter", None, 7),
    ("tiempo_agotado", "Cortada por tiempo", None, 10),
    ("motor", "Motor", None, 24),
    ("fecha", "Fecha", "yyyy-mm-dd hh:mm", 17),
    ("ruta", "Ruta", None, 40),
    ("politica", "Política (1 = P1, 0 = P2)", None, 30),
]
CLAVES = [c[0] for c in COLUMNAS]
HOJA_REPLICAS = "Heurísticas y metaheurísticas"
POR_ALGORITMO = [("costo_prom", "Costo Promedio", NUM, 12), ("costo_mejor", "Mejor Costo", NUM, 12),
                 ("gap_prom", "GAP Promedio", PCT, 10), ("gap_mejor", "GAP Mejor Costo", PCT, 10),
                 ("t_prom", "Tiempo Promedio (s)", SEG, 11),
                 ("t_iter", "Tiempo Promedio Iteraciones (s)", SEG, 13),
                 ("replicas", "Réplicas", ENTERO, 9), ("cortadas", "Cortadas por tiempo", ENTERO, 9)]

DEFINICIONES = [
    ("BKS", "Best known solution: menor Σ Dᵢ entre el mejor costo (en sus réplicas) de cada "
            "heurística (solo metaheurísticas: Gurobi no entra)."),
    ("Origen BKS", "Métodos que alcanzan el BKS (diferencia relativa ≤ 1E-6)."),
    ("Costo Promedio", "Σ Dᵢ promedio de las réplicas hechas."),
    ("Mejor Costo", "Menor Σ Dᵢ entre las réplicas hechas; su ruta es la del JSON."),
    ("GAP Promedio", "(Costo Promedio − BKS) / BKS."),
    ("GAP Mejor Costo", "(Mejor Costo − BKS) / BKS. 0 % = el algoritmo alcanza el BKS."),
    ("Tiempo Promedio (s)", "Tiempo total de la corrida (2 fases + búsqueda), promedio de las réplicas."),
    ("Tiempo Promedio Iteraciones (s)", "Tiempo de búsqueda (sin las 2 fases) dividido por el número de "
                                        "iteraciones de las dos corridas, promedio de las réplicas."),
    ("Réplicas", "Réplicas hechas de las previstas (semillas 1 a 10)."),
    ("Cortadas por tiempo", "Réplicas que llegaron al límite de tiempo antes de completar sus "
                            "iteraciones: informan la mejor ruta encontrada hasta ese momento."),
    ("Iteraciones", "Hoja de réplicas: iteraciones de ILS o ITS sumando las dos soluciones iniciales "
                    "(ILS: 2 × 200; ITS: 2 × 14)."),
    ("Iteración del mejor", "Iteración en que se alcanzó por primera vez el costo informado (0 = ya era "
                            "una solución inicial de 2 fases)."),
    ("Evaluaciones", "Rutas evaluadas con el DP exacto (O(n²)) y con la regla heurística (O(n))."),
]

FUENTE = Font(name="Arial", size=10)
NEGRITA = Font(name="Arial", size=10, bold=True)
TITULO = Font(name="Arial", size=12, bold=True)
BLANCA = Font(name="Arial", size=10, bold=True, color="FFFFFF")
AZUL = PatternFill("solid", fgColor="1F3864")
CELESTE = PatternFill("solid", fgColor="D9E1F2")
VERDE = PatternFill("solid", fgColor="E2EFDA")
CENTRO = Alignment(horizontal="center", vertical="center", wrap_text=True)
ARRIBA = Alignment(vertical="top", wrap_text=True)
SEPARADOR = Border(left=Side(style="medium", color="1F3864"))


def _celda(ws, fila, col, valor, fuente=FUENTE, formato=None, relleno=None, alineacion=None):
    c = ws.cell(fila, col, valor)
    c.font = fuente
    if formato:
        c.number_format = formato
    if relleno:
        c.fill = relleno
    if alineacion:
        c.alignment = alineacion
    return c


def _orden(f):
    return f["n"], f["id"], f["h"], list(ALGORITMOS).index(f["algoritmo"]), f["replica"]


def fila_excel(instancia, clave, replica, res):
    ruta = res["ruta"]
    return {
        "banco": banco_de(instancia["nombre"]), "instancia": instancia["nombre"], "n": instancia["n"],
        "id": instancia["id"], "h": instancia["h"], "algoritmo": clave, "replica": replica,
        "semilla": replica if ALGORITMOS[clave]["metodo"] else None, "costo": _r6(res["objetivo"]),
        "segundos": _r6(res["segundos"]), "segundos_inicial": _r6(res["segundos_inicial"]),
        "segundos_busqueda": _r6(res["segundos_busqueda"]), "iteraciones": res["iteraciones"],
        "segundos_por_iteracion": _r6(res["segundos_por_iteracion"]),
        "iteracion_mejor": res["iteracion_mejor"], "segundos_mejor": _r6(res["segundos_mejor"]),
        "evaluaciones_exactas": res["evaluaciones"]["exactas"],
        "evaluaciones_heuristicas": res["evaluaciones"]["heuristicas"], "n_iter": ITERACIONES,
        "tiempo_agotado": "Sí" if res["tiempo_agotado"] else "No",
        "motor": MOTOR, "fecha": datetime.now().replace(microsecond=0),
        "ruta": "-".join(map(str, ruta)),
        "politica": "".join(str(res["politica"][c]) for c in ruta[1:-1]),
    }


def resumen_instancias(filas):
    """Por instancia: BKS, su origen y las medidas de cada algoritmo sobre sus réplicas."""
    grupos = {}
    for f in sorted(filas.values(), key=_orden):
        grupos.setdefault(f["instancia"], {"fila": f, "algoritmos": {}})["algoritmos"] \
            .setdefault(f["algoritmo"], []).append(f)
    resumen = []
    for nombre, g in grupos.items():
        mejores = {clave: min(r["costo"] for r in reps) for clave, reps in g["algoritmos"].items()}
        bks = min(mejores.values())
        origen = [ALGORITMOS[c]["corto"] for c, v in mejores.items()
                  if abs(v - bks) <= 1e-6 * max(1.0, abs(bks))]
        medidas = {}
        for clave, reps in g["algoritmos"].items():
            costos = [r["costo"] for r in reps]
            por_iter = [r["segundos_por_iteracion"] for r in reps if r["segundos_por_iteracion"] is not None]
            prom = sum(costos) / len(costos)
            medidas[clave] = {
                "costo_prom": prom, "costo_mejor": mejores[clave],
                "gap_prom": (prom - bks) / bks, "gap_mejor": (mejores[clave] - bks) / bks,
                "t_prom": sum(r["segundos"] for r in reps) / len(reps),
                "t_iter": sum(por_iter) / len(por_iter) if por_iter else None,
                "replicas": len(reps),
                "cortadas": sum(r.get("tiempo_agotado") == "Sí" for r in reps),
            }
        resumen.append({"fila": g["fila"], "bks": bks, "origen": ", ".join(origen), "medidas": medidas})
    return resumen


def hoja_resultados(ws, filas):
    ws.title = "Resultados"
    fijas = [("banco", "Banco", None, 10), ("instancia", "Instancia", None, 30), ("n", "N", None, 6),
             ("id", "ID", None, 6), ("h", "h", None, 9)]
    bloques = ([("Instancia", fijas), ("Mejor solución conocida", [("bks", "BKS", NUM, 12),
                                                                    ("origen", "Origen BKS", None, 30)])]
               + [(alg["titulo"], POR_ALGORITMO) for alg in ALGORITMOS.values()])
    col, inicios = 1, []
    for titulo, columnas in bloques:
        inicios.append(col)
        ws.merge_cells(start_row=1, start_column=col, end_row=1, end_column=col + len(columnas) - 1)
        _celda(ws, 1, col, titulo, BLANCA, relleno=AZUL, alineacion=CENTRO)
        for k, (_, texto, _, ancho) in enumerate(columnas):
            _celda(ws, 2, col + k, texto, NEGRITA, relleno=CELESTE, alineacion=CENTRO)
            ws.column_dimensions[get_column_letter(col + k)].width = ancho
        col += len(columnas)
    ws.row_dimensions[2].height = 40

    resumen = resumen_instancias(filas)
    for r, inst in enumerate(resumen, 3):
        for k, (clave, _, _, _) in enumerate(fijas, 1):
            _celda(ws, r, k, inst["fila"][clave])
        _celda(ws, r, inicios[1], inst["bks"], formato=NUM)
        _celda(ws, r, inicios[1] + 1, inst["origen"])
        for inicio, clave in zip(inicios[2:], ALGORITMOS):
            m = inst["medidas"].get(clave)
            if m is None:
                continue
            # En verde, los algoritmos que alcanzan el BKS con su mejor réplica
            relleno = VERDE if m["gap_mejor"] <= 1e-6 else None
            for k, (campo, _, formato, _) in enumerate(POR_ALGORITMO):
                _celda(ws, r, inicio + k, m[campo], formato=formato, relleno=relleno)
    for inicio in inicios[1:]:
        for r in range(1, len(resumen) + 3):
            ws.cell(r, inicio).border = SEPARADOR
    ws.freeze_panes = "F3"
    ws.auto_filter.ref = f"A2:{get_column_letter(col - 1)}{max(len(resumen) + 2, 3)}"


def hoja_replicas(ws, filas):
    """Una fila por réplica, con todos los datos; el script la relee al reanudar."""
    for col, (_, encabezado, _, ancho) in enumerate(COLUMNAS, 1):
        _celda(ws, 1, col, encabezado, BLANCA, relleno=AZUL, alineacion=CENTRO)
        ws.column_dimensions[get_column_letter(col)].width = ancho
    ws.row_dimensions[1].height = 40
    for r, f in enumerate(sorted(filas.values(), key=_orden), 2):
        for col, (clave, _, formato, _) in enumerate(COLUMNAS, 1):
            _celda(ws, r, col, f[clave], formato=formato)
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNAS))}{max(len(filas) + 1, 2)}"


def hoja_definiciones(ws, banco, filas):
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 100
    _celda(ws, 1, 1, "TRPPD-H3 · heurísticas de Erdoğan et al. (2012) adaptadas a Σ Dᵢ", TITULO)
    ns = sorted({f["n"] for f in filas.values()})
    motores = sorted({f["motor"] for f in filas.values()})
    parametros = [
        ("Banco", banco),
        ("N", ", ".join(map(str, ns))),
        ("Réplicas", f"semillas {REPLICAS.start} a {REPLICAS.stop - 1}; 2 fases no usa azar (se repite "
                     "para promediar el tiempo)"),
        ("Límite de tiempo", f"{LIMITE_TIEMPO} s por réplica (2 fases + búsqueda); lo que queda después "
                             "de las 2 fases se reparte entre las dos soluciones iniciales" if LIMITE_TIEMPO
                             else "sin límite"),
        ("N_iter", f"{ITERACIONES} por solución inicial en ILS; ITS: ⌊√{ITERACIONES}⌋ = "
                   f"{int(math.sqrt(ITERACIONES))} externas y {int(math.sqrt(ITERACIONES))} de tabú"),
        ("N_rand / tenencia tabú", "round(0,1·n) movimientos al azar / ⌊0,5·n⌋ iteraciones"),
        ("Soluciones iniciales", "las 2 de la heurística de 2 fases (sentido del TSP e inverso); se "
                                 "informa la mejor corrida"),
        ("Motor", ", ".join(motores) or MOTOR),
        ("JSON", "erdogan/<algoritmo>/<instancia>.json: la mejor réplica de cada algoritmo"),
        ("Actualizado", datetime.now().replace(microsecond=0)),
    ]
    r = 3
    for nombre, valor in parametros:
        _celda(ws, r, 1, nombre, NEGRITA)
        _celda(ws, r, 2, valor, formato="yyyy-mm-dd hh:mm" if isinstance(valor, datetime) else None,
               alineacion=Alignment(horizontal="left"))
        r += 1
    r += 1
    _celda(ws, r, 1, "Algoritmo", BLANCA, relleno=AZUL)
    _celda(ws, r, 2, "Descripción", BLANCA, relleno=AZUL)
    for clave, alg in ALGORITMOS.items():
        r += 1
        _celda(ws, r, 1, clave)
        _celda(ws, r, 2, alg["nombre"] + (f" · evaluación {alg['evaluacion']} de los vecinos"
                                          if alg["metodo"] else ""))
    r += 2
    _celda(ws, r, 1, "Columna", BLANCA, relleno=AZUL)
    _celda(ws, r, 2, "Definición", BLANCA, relleno=AZUL)
    for nombre, texto in DEFINICIONES:
        r += 1
        _celda(ws, r, 1, nombre, NEGRITA, alineacion=ARRIBA)
        _celda(ws, r, 2, texto, alineacion=ARRIBA)
    r += 2
    _celda(ws, r, 1, None, relleno=VERDE)
    _celda(ws, r, 2, "Hoja Resultados: el algoritmo alcanza el BKS con su mejor réplica.", alineacion=ARRIBA)


@contextmanager
def candado(archivo, abandono=60):
    """Turno exclusivo para leer y reescribir el Excel entre procesos en paralelo."""
    bloqueo = archivo.with_name(f"{archivo.name}.lock")
    while True:
        try:
            fd = os.open(bloqueo, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            # Candado de un proceso que se cortó mientras escribía
            try:
                if time.time() - bloqueo.stat().st_mtime > abandono:
                    bloqueo.unlink()
            except FileNotFoundError:
                pass
            time.sleep(0.2)
    try:
        yield
    finally:
        os.close(fd)
        bloqueo.unlink(missing_ok=True)


def leer_excel(archivo):
    """Réplicas de un Excel anterior, por (instancia, algoritmo, réplica)."""
    if not archivo.exists():
        return {}
    wb = load_workbook(archivo, read_only=True)
    try:
        filas_hoja = wb[HOJA_REPLICAS].iter_rows(values_only=True)
        if list(next(filas_hoja)) != [c[1] for c in COLUMNAS]:
            raise SystemExit(f"{archivo} tiene otras columnas; renómbralo o bórralo para empezar")
        filas = [dict(zip(CLAVES, valores)) for valores in filas_hoja]
    finally:
        wb.close()
    return {(f["instancia"], f["algoritmo"], f["replica"]): f for f in filas if f["instancia"]}


def guardar_excel(filas, archivo, banco):
    """Reescribe el Excel con estas réplicas y las que otros procesos ya guardaron.

    Devuelve todas las réplicas. Si el Excel está abierto en Excel, avisa y se reintenta al
    terminar la siguiente réplica.
    """
    archivo.parent.mkdir(parents=True, exist_ok=True)
    with candado(archivo):
        filas = {**leer_excel(archivo), **filas}
        wb = Workbook()
        hoja_resultados(wb.active, filas)
        hoja_replicas(wb.create_sheet(HOJA_REPLICAS), filas)
        hoja_definiciones(wb.create_sheet("Definiciones"), banco, filas)
        temporal = archivo.with_name(f"{archivo.stem}_tmp.xlsx")
        try:
            wb.save(temporal)
            os.replace(temporal, archivo)
        except PermissionError:
            print(f"  ! No se pudo escribir {archivo.name} (¿abierto en Excel?); "
                  f"se reintenta al terminar la siguiente réplica")
    return filas


# ------------------------------ Lote ------------------------------

def archivo_excel():
    return CARPETA_SALIDA / f"heuristicas_{BANCO.lower()}.xlsx"


def correr(tamanos, algoritmos, replicas, ids):
    """Corre los algoritmos (del más barato al más caro) sobre las instancias; False si se cortó."""
    banco = BANCO
    excel = archivo_excel()
    instancias = [inst for n in tamanos for inst in instancias_de(n, BANCO) if inst["id"] in ids]
    if not instancias:
        raise FileNotFoundError(f"No hay instancias con N = {_texto_n(tamanos)} en {CARPETA_INSTANCIAS}")
    filas = leer_excel(excel) if REANUDAR else {}
    total = len(instancias) * len(algoritmos) * len(replicas)
    hechas = sum((inst["nombre"], a, r) in filas for inst in instancias for a in algoritmos for r in replicas)
    print(f"Banco {banco}, N = {_texto_n(tamanos)}: {len(instancias)} instancias × "
          f"{len(algoritmos)} algoritmos × {len(replicas)} réplicas, N_iter = {ITERACIONES}, {MOTOR}")
    print(f"Excel: {excel}" + (f"  ({hechas} de {total} réplicas ya hechas)" if hechas else ""))

    k = hechas
    try:
        for clave in algoritmos:
            for inst in instancias:
                pendientes = [r for r in replicas if (inst["nombre"], clave, r) not in filas]
                if not pendientes:
                    continue
                print(f"\n=== {ALGORITMOS[clave]['corto']} | Banco {banco} | N = {inst['n']} | "
                      f"h = {inst['h']:g} | ID = {inst['id']}   ({inst['nombre']})")
                for r in pendientes:
                    k += 1
                    print(f"  {datetime.now():%H:%M}  [{k}/{total}] réplica {r:<3} ",
                          end="\n" if MOSTRAR_ITERACIONES else "", flush=True)
                    res = resolver(inst, clave, semilla=r)
                    print(f"Σ D = {res['objetivo']:<12.2f} {res['segundos']:10.2f} s  "
                          f"{res['iteraciones']} iteraciones")
                    archivo_json(clave, inst["nombre"]).parent.mkdir(parents=True, exist_ok=True)
                    with candado(archivo_json(clave, inst["nombre"])):
                        guardar_si_mejora(inst, res)
                    filas[inst["nombre"], clave, r] = fila_excel(inst, clave, r, res)
                    filas = guardar_excel(filas, excel, banco)
    except KeyboardInterrupt:
        print("\nDetenido. El Excel tiene las réplicas terminadas; vuelve a ejecutar el script "
              "para seguir.")
        return False
    print(f"\nListo: {excel}")
    return True


# --------------------------- Argumentos ---------------------------

USO = f"""Uso: python lote_heuristicas_trppdh3.py <N> [--alg a,b] [--replicas 1-10] [--id 1-10]

  <N>          all = N 80, 100, 120, 140, 160, 180 y 200 (banco de Erdogan),
               o un valor (80), varios (80,100) o un rango (80-120)
  --alg        algoritmos, separados por comas: {', '.join(ALGORITMOS)} (por defecto, todos)
  --replicas   réplicas (la réplica r usa la semilla r): 3, 1,5 o 1-10 (por defecto, 1-10)
  --id         instancias de e_vigo: 3, 1,4 o 1-10 (por defecto, 1-10)

Ejemplos:
  python lote_heuristicas_trppdh3.py all
  python lote_heuristicas_trppdh3.py 80
  python lote_heuristicas_trppdh3.py 200 --alg ils_exacto --replicas 3-4 --id 1"""


def _texto_n(valores):
    return ", ".join(map(str, valores))


def leer_lista(texto, permitidos=None, nombre="N"):
    """Valores sueltos y rangos, p. ej. "80,100" o "80-120"; con permitidos, solo esos."""
    elegidos = set()
    for parte in re.sub(r"\s*-\s*", "-", texto).replace(",", " ").split():
        desde, _, hasta = parte.partition("-")
        if not desde.isdigit() or not (hasta or desde).isdigit():
            raise ValueError(f"'{parte}' no es un valor ni un rango de {nombre} (ejemplo: 80-120)")
        desde, hasta = sorted((int(desde), int(hasta or desde)))
        if permitidos is None:
            elegidos.update(range(desde, hasta + 1))
            continue
        for v in (desde, hasta):
            if v not in permitidos:
                raise ValueError(f"{nombre} = {v} no es válido; usa {_texto_n(permitidos)}")
        elegidos.update(v for v in permitidos if desde <= v <= hasta)
    if not elegidos:
        raise ValueError(f"falta {nombre}")
    return sorted(elegidos)


def leer_argumentos(argumentos):
    """(tamaños, algoritmos, réplicas, ids) a partir de los argumentos."""
    posicionales, opciones = [], {}
    k = 0
    while k < len(argumentos):
        a = argumentos[k]
        if a.startswith("--"):
            if k + 1 >= len(argumentos):
                raise ValueError(f"falta el valor de {a}")
            opciones[a] = argumentos[k + 1]
            k += 2
        else:
            posicionales.append(a)
            k += 1
    desconocidas = set(opciones) - {"--alg", "--replicas", "--id"}
    if desconocidas:
        raise ValueError(f"opción desconocida: {', '.join(sorted(desconocidas))}")
    if not posicionales:
        raise ValueError("falta N")
    texto = " ".join(posicionales)
    tamanos = TAMANOS if texto.lower() == "all" else leer_lista(texto, TAMANOS)
    algoritmos = list(ALGORITMOS)
    if "--alg" in opciones:
        pedidos = [a.strip() for a in opciones["--alg"].split(",") if a.strip()]
        malos = [a for a in pedidos if a not in ALGORITMOS]
        if malos:
            raise ValueError(f"algoritmos desconocidos: {', '.join(malos)}")
        algoritmos = [a for a in ALGORITMOS if a in pedidos]
    replicas = (leer_lista(opciones["--replicas"], list(REPLICAS), "réplica")
                if "--replicas" in opciones else list(REPLICAS))
    ids = set(leer_lista(opciones["--id"], list(IDS), "ID") if "--id" in opciones else IDS)
    return tamanos, algoritmos, replicas, ids


def main():
    sys.stdout.reconfigure(line_buffering=True)   # avance visible aunque se redirija a un archivo
    try:
        tamanos, algoritmos, replicas, ids = leer_argumentos(sys.argv[1:])
    except ValueError as error:
        raise SystemExit(f"Error: {error}\n\n{USO}")
    try:
        completo = correr(tamanos, algoritmos, replicas, ids)
    except FileNotFoundError as error:
        raise SystemExit(f"Error: {error}")
    raise SystemExit(0 if completo else 1)


if __name__ == "__main__":
    main()
