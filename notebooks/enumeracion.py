"""Evaluación directa de rutas y políticas, y enumeración exhaustiva.

Sirve para validar el modelo de Gurobi en instancias pequeñas (n <= 7). Dada
una ruta (0, pi_1, ..., pi_n, 0) y un vector s (1 = Política 1, 0 = Política 2)
se reproduce la secuencia de operaciones de la Tabla 3 de la formulación:

    1. retirar las recogidas junto a la puerta      u_b * z_in
    2. descargar las alpha_i unidades del cliente   u_a * alpha_i   -> D_i
    3. (P2) retirar las entregas que siguen a bordo u_a * y_out
    4. cargar recogidas retiradas y nuevas          l_b * (z_in + beta_i)
    5. (P2) recargar las entregas                   l_a * y_out     -> F_i

Además del objetivo del TRPPD-H3 (suma de D_i) se calcula el objetivo (31) del
TSPPD-H3 de Battarra et al. (2010), viaje + manipulación adicional, que
permite comprobar la lectura de los datos contra las Tablas 1 y 2 del artículo.
"""

from itertools import permutations, product


def evaluar(inst, ruta, s):
    """Evalúa una ruta (lista de clientes, sin el depósito) con políticas s.

    s es un diccionario {cliente: 0/1}. Devuelve None si la carga supera Q
    en algún arco.
    """
    w, y, z = 0.0, float(inst.suma_alpha), 0.0
    if w + y + z > inst.Q + 1e-9:
        return None
    t = 0.0
    anterior = 0
    T, D, F = {}, {}, {}
    viaje = 0.0
    manipulacion = 0.0  # término de manipulación del objetivo (31)
    for i in ruta:
        viaje += inst.c[anterior][i]
        T[i] = t + inst.c[anterior][i]
        D[i] = T[i] + inst.ub * z + inst.ua * inst.alpha[i]
        if inst.alpha[i] > 0:
            manipulacion += inst.hb * z
        y -= inst.alpha[i]
        nuevas = z + inst.beta[i]
        if s[i] == 1:
            q = 0.0
            z = nuevas
        else:
            q = inst.ha * y
            w += nuevas
            z = 0.0
        manipulacion += q
        F[i] = D[i] + inst.lb * nuevas + q
        if w + y + z > inst.Q + 1e-9:
            return None
        t = F[i]
        anterior = i
    viaje += inst.c[anterior][0]
    return {
        "ruta": list(ruta),
        "s": dict(s),
        "trp": sum(D.values()),
        "tsppd_h3": viaje + manipulacion,
        "viaje": viaje,
        "manipulacion_adicional": manipulacion,
        "regreso": t + inst.c[anterior][0],
        "T": T,
        "D": D,
        "F": F,
    }


def enumerar(inst, objetivo="trp"):
    """Óptimo por enumeración de todas las rutas y vectores s.

    objetivo = "trp" minimiza la suma de los D_i; "tsppd_h3" minimiza el
    objetivo (31) de Battarra et al. (2010).
    """
    clientes = list(inst.Vc)
    mejor = None
    for ruta in permutations(clientes):
        for valores in product((1, 0), repeat=len(clientes)):
            res = evaluar(inst, ruta, dict(zip(clientes, valores)))
            if res is not None and (mejor is None or res[objetivo] < mejor[objetivo] - 1e-9):
                mejor = res
    return mejor
