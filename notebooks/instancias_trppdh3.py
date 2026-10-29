"""Instancias del TRPPD-H3 a partir del banco e_vigo de Battarra et al. (2010).

Los archivos de e_vigo son las instancias euclidianas de Gendreau, Laporte y
Vigo (1999) para el SVPDP. Cada bloque de ``edati.dat`` tiene la cabecera
``beta n id suma_d`` seguida de dos filas de n valores: entregas d_i y
recogidas p_i. ``ecosti.dat`` tiene la matriz (n+1)x(n+1) de costos, con el
depósito en la posición 0 y 10^7 en la diagonal.

Battarra et al. (2010, Sección 5) toman las 10 instancias de 50 clientes, se
quedan con los primeros |Vc| en {5, 10, 15, 20, 25} clientes y generan las
demandas a partir de las recogidas p_i con la regla (79):

    p'_i = max{1, p_i mod 20},  beta_i = floor(p'_i (i mod 5) / 5),
    alpha_i = p'_i - beta_i,    Q = max{sum alpha, sum beta},  h_a = h_b = h.

Para el TRPPD-H3 se conserva todo lo anterior y se divide h en los tiempos de
descarga y carga, u = l = h/2, de modo que h_a = u_a + l_a = h.

Las instancias de e_vigo traen solo la matriz de costos. Como son euclidianas,
las coordenadas del mapa se recuperan con escalamiento multidimensional
clásico sobre la matriz de 50 clientes, de modo que el mapa de una misma id es
igual para cualquier n (el error medio en las distancias es de 0,2 unidades,
por el redondeo de los costos).

Cada instancia se guarda en Instancias/vigo_n<n>_id<id>_h<h>.json con los
datos de la Tabla 1 de la formulación; modelo_trppdh3.py las lee de ahí.

    python instancias_trppdh3.py
"""

import json
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_E_VIGO = RAIZ / "e_vigo"
CARPETA_INSTANCIAS = RAIZ / "Instancias"
SEPARADOR = "---------------------"

# Configuración del banco de pruebas de Battarra et al. (2010)
N_BASE = 50
TAMANOS = (5, 10, 15, 20, 25)
IDS = tuple(range(1, 11))
VALORES_H = (0.1, 0.5, 1.0)


# --- Lectura de e_vigo -------------------------------------------------------

def _leer_bloques(ruta):
    texto = Path(ruta).read_text()
    return [b.split() for b in texto.split(SEPARADOR) if b.strip()]


def leer_recogidas(id_, n_base=N_BASE):
    """Recogidas p_i (i = 1..n_base) de edati.dat.

    Las recogidas son iguales en las clases beta 0, 0.05, 0.1 y 0.2; con
    beta = 0 las filas de entregas y recogidas coinciden.
    """
    for b in _leer_bloques(CARPETA_E_VIGO / "edati.dat"):
        if b[0] == "0." and int(b[1]) == n_base and int(b[2]) == id_:
            valores = [int(float(v)) for v in b[4:]]
            return valores[n_base:2 * n_base]
    raise ValueError(f"No existe la instancia n={n_base} id={id_} en edati.dat")


def leer_costos(id_, n_base=N_BASE):
    """Matriz (n_base+1)x(n_base+1) de ecosti.dat; la diagonal queda en 0."""
    for b in _leer_bloques(CARPETA_E_VIGO / "ecosti.dat"):
        if int(b[1]) == n_base and int(b[2]) == id_:
            m = n_base + 1
            valores = [float(v) for v in b[4:]]
            if len(valores) != m * m:
                raise ValueError(f"Matriz incompleta para n={n_base} id={id_}")
            return [[0.0 if i == j else valores[i * m + j] for j in range(m)]
                    for i in range(m)]
    raise ValueError(f"No existe la matriz n={n_base} id={id_} en ecosti.dat")


# --- Adaptación al TRPPD-H3 ---------------------------------------------------

def regla_79(p):
    """Demandas (alpha, beta) de los clientes 1..n; el índice 0 es el depósito."""
    alpha, beta = [0], [0]
    for i, p_i in enumerate(p, start=1):
        p_esc = max(1, p_i % 20)
        b = (p_esc * (i % 5)) // 5
        alpha.append(p_esc - b)
        beta.append(b)
    return alpha, beta


def coordenadas_mds(c):
    """Coordenadas 2D cuyas distancias aproximan la matriz simétrica c."""
    c = np.asarray(c, dtype=float)
    m = c.shape[0]
    centrado = np.eye(m) - 1.0 / m
    b = -0.5 * centrado @ (c ** 2) @ centrado
    valores, vectores = np.linalg.eigh(b)
    orden = np.argsort(valores)[::-1][:2]
    x = vectores[:, orden] * np.sqrt(np.maximum(valores[orden], 0.0))
    # Orientación reproducible: el punto más alejado en cada eje queda en el lado positivo
    for k in range(2):
        if x[np.argmax(np.abs(x[:, k])), k] < 0:
            x[:, k] *= -1
    return [[round(float(a), 2), round(float(b), 2)] for a, b in x]


def _num(v):
    """Entero si el valor no tiene parte decimal; así el JSON queda más corto."""
    v = float(v)
    return int(v) if v.is_integer() else round(v, 6)


def nombre_instancia(n, id_, h):
    return f"vigo_n{n}_id{id_}_h{h:g}"


def generar_instancia(n, id_, h, costos=None, coords=None):
    """Instancia TRPPD-H3 con los primeros n clientes de la instancia id_.

    Devuelve un diccionario con los datos de la Tabla 1: n, Q, alpha, beta,
    los tiempos ua = la = ub = lb = h/2 y la matriz c, más las coordenadas
    del mapa para el visualizador.
    """
    if not 1 <= n <= N_BASE:
        raise ValueError(f"n debe estar entre 1 y {N_BASE}")
    p = leer_recogidas(id_)[:n]
    costos = costos or leer_costos(id_)
    coords = coords or coordenadas_mds(costos)
    alpha, beta = regla_79(p)
    return {
        "nombre": nombre_instancia(n, id_, h),
        "origen": "e_vigo (Gendreau, Laporte y Vigo, 1999) con la regla (79) de "
                  "Battarra et al. (2010)",
        "n": n,
        "id": id_,
        "h": h,
        "Q": max(sum(alpha), sum(beta)),
        "ua": h / 2, "la": h / 2, "ub": h / 2, "lb": h / 2,
        "alpha": alpha,
        "beta": beta,
        "c": [[_num(v) for v in fila[:n + 1]] for fila in costos[:n + 1]],
        "coords": coords[:n + 1],
    }


def a_json(inst):
    """JSON legible: un dato por línea y una fila de la matriz c por línea."""
    lineas = []
    for clave, valor in inst.items():
        if clave in ("c", "coords"):
            filas = ",\n    ".join(json.dumps(fila) for fila in valor)
            texto = f"[\n    {filas}\n  ]"
        else:
            texto = json.dumps(valor, ensure_ascii=False)
        lineas.append(f'  "{clave}": {texto}')
    return "{\n" + ",\n".join(lineas) + "\n}\n"


def guardar_instancia(inst, carpeta=CARPETA_INSTANCIAS):
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    archivo = carpeta / f"{inst['nombre']}.json"
    archivo.write_text(a_json(inst), encoding="utf-8")
    return archivo


def main():
    total = 0
    for id_ in IDS:
        # La matriz y el mapa de 50 clientes se calculan una vez por id
        costos = leer_costos(id_)
        coords = coordenadas_mds(costos)
        for n in TAMANOS:
            for h in VALORES_H:
                guardar_instancia(generar_instancia(n, id_, h, costos, coords))
                total += 1
    print(f"{total} instancias guardadas en {CARPETA_INSTANCIAS}")


if __name__ == "__main__":
    main()
