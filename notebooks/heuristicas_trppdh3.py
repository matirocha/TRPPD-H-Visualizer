"""Heurísticas de Erdoğan, Battarra, Laporte y Vigo (2012) adaptadas al TRPPD-H3: base común.

Traducción a Python de Paginas Web/Pagina Web 1/lib/heuristicas.js. Con la misma semilla
entrega las mismas rutas, políticas y Σ D_i que la versión JavaScript (npm run heuristicas),
cuyos resultados están en Outputs/erdogan/.

Archivos de esta familia (todos en notebooks/):

    heuristicas_trppdh3.py      esta base: datos de la instancia, evaluación de una ruta
                                (exacta y heurística), vecindarios, perturbación, búsqueda
                                local, búsqueda tabú, salida JSON y línea de comandos
    dos_fases_trppdh3.py        heurística de 2 fases: TSP + reubicación del depósito
    ils_heuristico_trppdh3.py   ILS (Algoritmo 4.2) con evaluación heurística, O(n)
    ils_exacto_trppdh3.py       ILS (Algoritmo 4.2) con evaluación exacta, O(n²)
    its_heuristico_trppdh3.py   ITS (Algoritmo 4.3) con evaluación heurística, O(n)
    its_exacto_trppdh3.py       ITS (Algoritmo 4.3) con evaluación exacta, O(n²)

Cada uno de los cinco últimos se ejecuta solo, por ejemplo:

    python ils_exacto_trppdh3.py 10                 # todas las instancias con n = 10
    python ils_exacto_trppdh3.py 10-25 --banco B    # n = 10 a 25 del banco de Battarra
    python ils_exacto_trppdh3.py 30 --banco E --id 1-3 --iter 200
    python ils_exacto_trppdh3.py vigo_n15_id2_h0.5  # una instancia por nombre

y guarda cada solución en notebooks/erdogan/<algoritmo>/<instancia>.json, con el formato
trppdh3-salida/1 que lee la Página Web 1 (copiando la carpeta a Outputs/erdogan/).

Objetivo. Erdoğan et al. minimizan viaje + manipulación (TSPPD-H). Aquí el objetivo es
Σ D_i, así que cada operación pesa por el número de clientes que retrasa. En la posición k
de la ruta (k = 1..n):

    antes de completar la entrega (c_ij, u_b·z, u_a·α_i)   pesa  n − k + 1
    después (ℓ_b·(z + β_i), q_i)                           pesa  n − k

Con la ruta fija, el viaje y las operaciones obligatorias no dependen de las políticas s_i,
y la manipulación adicional solo depende de las recogidas junto a la puerta (z) desde la
última Política 2. Por eso se conserva la estructura del DP de la Sección 2.1 de Erdoğan.

Solo usa la biblioteca estándar de Python.
"""

import json
import math
import platform
import sys
import time
from datetime import datetime
from pathlib import Path

EPS = 1e-9
INF = math.inf
M32 = 0xFFFFFFFF

ITERACIONES = 200   # N_iter de Erdoğan et al. por solución inicial (ILS); ITS usa ⌊√N_iter⌋
GUARDAR = True      # escribe notebooks/erdogan/<algoritmo>/<instancia>.json

CARPETA_SCRIPT = Path(__file__).resolve().parent
# Instancias/ junto al script o una carpeta más arriba (estructura del repositorio)
CARPETA_INSTANCIAS = next((c / "Instancias" for c in (CARPETA_SCRIPT, CARPETA_SCRIPT.parent)
                           if (c / "Instancias").is_dir()), CARPETA_SCRIPT / "Instancias")
CARPETA_SALIDA = CARPETA_SCRIPT / "erdogan"
# Soluciones de Gurobi para el GAP y la desviación (la primera carpeta que exista)
CARPETAS_GUROBI = [CARPETA_SCRIPT.parent / "Outputs" / "gurobi", CARPETA_SCRIPT / "gurobi"]
FORMATO = "trppdh3-salida/1"


# ------------------------------ Instancia ------------------------------

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

def evaluar_exacto(P, ruta, con_politica=False):
    """Algoritmo 2.1 + DP adaptados a Σ D_i, en O(n²).

    f(i) es el costo mínimo de manipulación de las posiciones i+1..n si en i se aplicó la
    Política 2 (i = 0: depósito); p_ij es el costo de aplicar la Política 1 en i+1..j−1 y la
    Política 2 en j. En la posición j (peso W = n − j + 1):
        retirar y recargar las z recogidas junto a la puerta:  (u_b·W + ℓ_b·(W − 1))·z
        Política 2: retirar y recargar las entregas que siguen: h_a·y·(W − 1)
    Con j = n la Política 2 no cuesta (W − 1 = 0), así que p_in es "Política 1 hasta el final".
    Devuelve Σ D_i, o (Σ D_i, política) con con_politica.
    """
    fijo = parte_fija(P, ruta)
    if fijo == INF:
        return (INF, None) if con_politica else INF
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
    costo = fijo + f[0]
    if not con_politica:
        return costo

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


def evaluar_heuristico(P, ruta, con_politica=False):
    """Evaluación heurística en O(n), como la de Erdoğan et al. con el umbral 2 (recogidas a bordo).

    Al salir del depósito y después de cada Política 2 se calcula k*_1 con los promedios de los
    clientes que faltan, y se aplica la Política 2 en el primer cliente en que las recogidas junto
    a la puerta (las que había más las suyas) alcanzan k*_1·β̄. El costo de esas decisiones se
    mide con los pesos de latencia, igual que en evaluar_exacto.
    """
    fijo = parte_fija(P, ruta)
    if fijo == INF:
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


def semilla_de(texto):
    """Semilla FNV-1a de 32 bits de un texto; las corridas usan "<instancia>|<algoritmo>"."""
    h = 2166136261
    for ch in texto:
        h = _imul(h ^ ord(ch), 16777619)
    return h


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

    def exacto(self, ruta):
        self.cuenta["exactas"] += 1
        return evaluar_exacto(self.P, ruta)

    def _heuristico(self, ruta):
        self.cuenta["heuristicas"] += 1
        return evaluar_heuristico(self.P, ruta)


def explorar(B, ruta, visitar):
    """Recorre relocate (n(n − 1) vecinos) y 2-opt (n(n − 1)/2). visitar(tipo, i, j, valor, ruta)
    recibe cada vecino factible; la ruta es un buffer que se reutiliza."""
    n, buffer, vecino = B.n, B.buffer, B.vecino
    for i in range(n):
        for p in range(n):
            if p == i:
                continue
            valor = vecino(relocate(ruta, i, p, buffer))
            if valor < INF:
                visitar("relocate", i, p, valor, buffer)
    for i in range(n - 1):
        for j in range(i + 1, n):
            valor = vecino(dos_opt(ruta, i, j, buffer))
            if valor < INF:
                visitar("2opt", i, j, valor, buffer)


def busqueda_local(B, ruta, costo):
    """Búsqueda local con mejor mejora en relocate ∪ 2-opt ("Perform Best Move" del
    Algoritmo 4.2). Repite hasta que ningún vecino mejora. Devuelve (ruta, costo)."""
    while True:
        mejor = None
        valor_mejor = INF

        def visitar(_tipo, _i, _j, valor, r):
            nonlocal mejor, valor_mejor
            if valor < valor_mejor - EPS:
                valor_mejor = valor
                mejor = list(r)

        explorar(B, ruta, visitar)
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

        explorar(B, actual, visitar)
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


# ------------------------------ Corrida ------------------------------

def resolver(instancia, clave, evaluacion, construir, metodo=None, buscar=None,
             iteraciones=ITERACIONES, aleatorios=None, semilla=None):
    """Corre un algoritmo sobre una instancia.

    construir(P) es la heurística de 2 fases (dos soluciones iniciales: sentido del TSP e
    inverso). Como en Erdoğan et al. (versión 2dir), la metaheurística buscar(B, ruta,
    iteraciones, aleatorios) parte una vez de cada solución inicial y se informa la mejor; sin
    buscar, el resultado es la mejor solución inicial (2 fases). El tiempo incluye las 2 fases.
    """
    inicio = time.perf_counter()
    P = Problema(instancia)
    n_rand = aleatorios if aleatorios is not None else max(1, math.floor(0.1 * P.n + 0.5))
    inicial = construir(P)
    segundos_inicial = time.perf_counter() - inicio
    if semilla is None:
        semilla = semilla_de(f"{instancia['nombre']}|{clave}")
    B = Busqueda(P, evaluacion, crear_azar(semilla))

    corridas = []
    for d in inicial["direcciones"]:
        if d["ruta"] is None:
            continue
        if buscar is None:
            corridas.append({"direccion": d["direccion"], "inicial": d["costo"], "ruta": d["ruta"],
                             "costo": d["costo"], "traza": []})
        else:
            res = buscar(B, d["ruta"], iteraciones, n_rand)
            corridas.append({"direccion": d["direccion"], "inicial": d["costo"], **res})
    if not corridas:
        raise ValueError("Ninguna rotación del ciclo TSP respeta la capacidad Q")
    mejor = corridas[0]
    for otra in corridas[1:]:
        if otra["costo"] < mejor["costo"] - EPS:
            mejor = otra
    costo, politica = evaluar_exacto(P, mejor["ruta"], True)
    segundos = time.perf_counter() - inicio

    raiz = int(math.sqrt(iteraciones))
    return {
        "clave": clave,
        "ruta": [0, *map(int, mejor["ruta"]), 0],
        "politica": politica,
        "objetivo": costo,
        "segundos": segundos,
        "segundos_inicial": segundos_inicial,
        "parametros": {
            "evaluacion": evaluacion,
            "metodo": metodo,
            "direcciones": 2,
            "iteraciones": raiz if metodo == "its" else iteraciones if metodo else None,
            "iteraciones_tabu": raiz if metodo == "its" else None,
            "tenencia_tabu": max(1, math.floor(0.5 * P.n)) if metodo == "its" else None,
            "movimientos_aleatorios": n_rand if metodo else None,
            "semilla": semilla if metodo else None,
        },
        "tsp": inicial["tsp"],
        "corridas": [{"direccion": c["direccion"], "inicial": c["inicial"], "final": c["costo"],
                      "ruta": [0, *map(int, c["ruta"]), 0], "traza": c["traza"]} for c in corridas],
        "evaluaciones": dict(B.cuenta),
    }


# ------------------------------ Salida ------------------------------

def _r6(x):
    return None if x is None else round(x, 6)


def banco_de(nombre):
    return "Erdogan" if nombre.endswith("_Erdogan") else "Battarra"


def referencias(nombre):
    """Mejor cota, mayor relajación lineal y mejor Σ D de las variantes de Gurobi."""
    ref = {"cota": None, "relajacion_lineal": None, "objetivo": None, "variantes": 0}
    carpeta = next((c for c in CARPETAS_GUROBI if c.is_dir()), None)
    if carpeta is None:
        return ref
    for variante in sorted(p for p in carpeta.iterdir() if p.is_dir()):
        archivo = variante / f"{nombre}.json"
        if not archivo.exists():
            continue
        s = json.loads(archivo.read_text(encoding="utf-8")).get("solucion", {})
        ref["variantes"] += 1
        for campo, mejor in (("cota", max), ("relajacion_lineal", max), ("objetivo", min)):
            if s.get(campo) is not None:
                ref[campo] = s[campo] if ref[campo] is None else mejor(ref[campo], s[campo])
    return ref


def guardar_salida(instancia, nombre_algoritmo, res):
    """Escribe erdogan/<algoritmo>/<instancia>.json (formato trppdh3-salida/1) y devuelve la ruta."""
    z = res["objetivo"]
    ref = referencias(instancia["nombre"])
    salida = {
        "formato": FORMATO,
        "generado": datetime.now().isoformat(timespec="seconds"),
        "algoritmo": {
            "clave": res["clave"],
            "nombre": nombre_algoritmo,
            "parametros": {"familia": "erdogan", **res["parametros"],
                           "motor": f"Python {platform.python_version()}"},
        },
        "instancia": instancia,
        "solucion": {
            "ruta": res["ruta"],
            "politica": res["politica"],
            "estado": "HEURISTICA",
            "objetivo": _r6(z),
            "gap": _r6((z - ref["cota"]) / z) if ref["cota"] is not None else None,
            "gap_entera": (_r6((z - ref["relajacion_lineal"]) / z)
                           if ref["relajacion_lineal"] is not None else None),
            "desviacion_gurobi": (_r6((z - ref["objetivo"]) / ref["objetivo"])
                                  if ref["objetivo"] is not None else None),
            "referencia": {"fuente": "gurobi", **ref},
            "segundos": _r6(res["segundos"]),
            "segundos_inicial": _r6(res["segundos_inicial"]),
            "segundos_total": _r6(res["segundos"]),
            "evaluaciones": res["evaluaciones"],
            "tsp": res["tsp"],
            "corridas": [{**c, "inicial": _r6(c["inicial"]), "final": _r6(c["final"]),
                          "traza": [_r6(x) for x in c["traza"]]} for c in res["corridas"]],
        },
    }
    archivo = CARPETA_SALIDA / res["clave"] / f"{instancia['nombre']}.json"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text(json.dumps(salida, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return archivo


# -------------------------- Línea de comandos --------------------------

def _acepta(spec, valor):
    """"all", "10", "10,15" o "10-25"."""
    if spec == "all":
        return True
    for parte in spec.split(","):
        a, _, b = parte.partition("-")
        if (b and float(a) <= valor <= float(b)) or (not b and valor == float(a)):
            return True
    return False


def leer_instancias(spec, banco=None, ids="all"):
    """Instancias de Instancias/ con n en spec (o un nombre "vigo_..."), ordenadas por n, id y h."""
    if spec.startswith("vigo_"):
        archivo = CARPETA_INSTANCIAS / f"{spec.removesuffix('.json')}.json"
        return [json.loads(archivo.read_text(encoding="utf-8"))]
    instancias = []
    for archivo in sorted(CARPETA_INSTANCIAS.glob("*.json")):
        inst = json.loads(archivo.read_text(encoding="utf-8"))
        if not _acepta(spec, inst["n"]) or not _acepta(ids, inst["id"]):
            continue
        if banco and banco_de(inst["nombre"]) != banco:
            continue
        instancias.append(inst)
    instancias.sort(key=lambda i: (i["n"], i["id"], i["h"], i["nombre"]))
    return instancias


def ejecutar(clave, nombre_algoritmo, resolver_algoritmo, argumentos=None):
    """Línea de comandos común: <n | nombre> [--banco B|E] [--id 1-5] [--iter 200] [--no-guardar]."""
    args = list(sys.argv[1:] if argumentos is None else argumentos)
    spec, banco, ids, iteraciones, guardar = None, None, "all", ITERACIONES, GUARDAR
    k = 0
    while k < len(args):
        a = args[k]
        if a == "--banco":
            k += 1
            banco = {"B": "Battarra", "E": "Erdogan"}[args[k].upper()]
        elif a == "--id":
            k += 1
            ids = args[k]
        elif a == "--iter":
            k += 1
            iteraciones = int(args[k])
        elif a == "--no-guardar":
            guardar = False
        else:
            spec = a
        k += 1
    if spec is None:
        script = Path(sys.argv[0]).name
        sys.exit(f"Uso: python {script} <n | 10,15 | 10-25 | all | vigo_...> "
                 f"[--banco B|E] [--id 1-5] [--iter {ITERACIONES}] [--no-guardar]")
    instancias = leer_instancias(spec, banco, ids)
    if not instancias:
        sys.exit(f"No hay instancias con n = {spec} en {CARPETA_INSTANCIAS}")

    print(f"{nombre_algoritmo}: {len(instancias)} instancias, N_iter = {iteraciones}")
    tiempos = []
    for inst in instancias:
        res = resolver_algoritmo(inst, iteraciones=iteraciones)
        tiempos.append(res["segundos"])
        if guardar:
            guardar_salida(inst, nombre_algoritmo, res)
        print(f"{inst['nombre']:<26} Σ D = {res['objetivo']:12.2f}   {res['segundos']:9.3f} s   "
              f"ruta {'-'.join(map(str, res['ruta']))}", flush=True)
    print(f"\nTiempo promedio {sum(tiempos) / len(tiempos):.3f} s"
          + (f"; soluciones en {CARPETA_SALIDA / clave}" if guardar else ""))
