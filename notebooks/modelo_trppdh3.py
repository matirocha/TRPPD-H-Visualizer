"""Modelo TRPPD-H3 en Gurobi: ecuaciones (1)-(29) de la formulación.

Lee la instancia de Instancias/ (generada con instancias_trppdh3.py), resuelve
el modelo (1)-(19) con o sin las restricciones de explicitación (20)-(23) y la
desigualdad válida de latencia (24)-(29), y guarda cada solución, con sus
tiempos de ejecución, en

    Outputs/gurobi/<variante>/<instancia>.json

que lee el visualizador web. Las restricciones (20)-(29) no cambian el óptimo;
resolver las cuatro variantes permite comparar cuánto tarda cada una.

    python modelo_trppdh3.py
"""

import json
import time
from datetime import datetime
from pathlib import Path

import gurobipy as gp
from gurobipy import GRB

# ======================== Instancia a resolver ========================
N = 5        # número de clientes: 5, 10, 15, 20 o 25
ID = 1       # instancia de e_vigo: 1 a 10
H = 0.1      # tiempo de manipulación h = h_a = h_b: 0.1, 0.5 o 1

# Restricciones opcionales: True, False o [False, True] para resolver con y
# sin ellas y comparar los tiempos de ejecución de las variantes.
RESTRICCIONES_20_23 = [False, True]   # explicitación de las cargas
RESTRICCIONES_24_29 = [False, True]   # desigualdad válida de latencia

LIMITE_TIEMPO = None   # segundos por modelo (None = sin límite)
HILOS = None           # hilos de Gurobi (None = los que Gurobi decida)
MOSTRAR_LOG = False    # log de Gurobi en pantalla

# N, ID y H también aceptan listas para resolver varias instancias seguidas,
# por ejemplo N = [5, 10], ID = range(1, 11), H = [0.1, 0.5, 1].
# ======================================================================

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_INSTANCIAS = RAIZ / "Instancias"
CARPETA_OUTPUTS = RAIZ / "Outputs"
FORMATO = "trppdh3-salida/1"
TOL = 1e-6

# (20)-(23), (24)-(29) -> carpeta en Outputs/gurobi y nombre en el visualizador
VARIANTES = {
    (False, False): ("base", "(1)-(19)"),
    (True, False): ("explicitacion", "(1)-(19) + (20)-(23)"),
    (False, True): ("latencia", "(1)-(19) + (24)-(29)"),
    (True, True): ("completo", "(1)-(29)"),
}


def leer_instancia(n, id_, h):
    archivo = CARPETA_INSTANCIAS / f"vigo_n{n}_id{id_}_h{h:g}.json"
    if not archivo.exists():
        raise FileNotFoundError(f"No existe {archivo}; ejecuta instancias_trppdh3.py")
    return json.loads(archivo.read_text(encoding="utf-8"))


def construir_modelo(inst, r20_23=False, r24_29=False, env=None):
    """Devuelve (modelo, variables) para la instancia dada."""
    # Conjuntos y parámetros (Tabla 1)
    n = inst["n"]
    V = list(range(n + 1))                       # nodos, 0 = depósito
    Vc = list(range(1, n + 1))                   # clientes
    A = [(i, j) for i in V for j in V if i != j]
    c, alpha, beta, Q = inst["c"], inst["alpha"], inst["beta"], inst["Q"]
    ua, la, ub, lb = inst["ua"], inst["la"], inst["ub"], inst["lb"]
    ha, hb = ua + la, ub + lb
    suma_alpha, suma_beta = sum(alpha), sum(beta)
    c_max = max(c[i][j] for i, j in A)
    U = n * c_max + (ua + n * ha) * suma_alpha + (lb + n * hb) * suma_beta
    M = U + c_max

    m = gp.Model(inst["nombre"], env=env)

    # Naturaleza de las variables, (15)-(19)
    x = m.addVars(A, vtype=GRB.BINARY, name="x")         # (15)
    s = m.addVars(Vc, vtype=GRB.BINARY, name="s")        # (16)
    w = m.addVars(A, lb=0.0, name="w")                   # (17)
    y = m.addVars(A, lb=0.0, name="y")
    z = m.addVars(A, lb=0.0, name="z")
    p = m.addVars(Vc, lb=0.0, name="p")                  # (18)
    q = m.addVars(Vc, lb=0.0, name="q")
    T = m.addVars(V, lb=0.0, name="T")                   # (19)
    F = m.addVars(V, lb=0.0, name="F")
    D = m.addVars(Vc, lb=0.0, name="D")

    # (1) Función objetivo
    m.setObjective(D.sum(), GRB.MINIMIZE)

    # (2)-(3) Ruteo
    m.addConstrs((x.sum(i, "*") == 1 for i in V), name="sale")
    m.addConstrs((x.sum("*", j) == 1 for j in V), name="entra")

    # (4) Conservación de entregas
    m.addConstrs((y.sum("*", i) - y.sum(i, "*") == alpha[i] for i in Vc),
                 name="entregas")

    # (5) Conservación de recogidas
    m.addConstrs((w.sum(i, "*") + z.sum(i, "*") - w.sum("*", i) - z.sum("*", i) == beta[i]
                  for i in Vc), name="recogidas")

    # (6) Selección de política
    m.addConstrs((w.sum(i, "*") - w.sum("*", i) <= (1 - s[i]) * suma_beta for i in Vc),
                 name="politica")

    # (7) Capacidad
    m.addConstrs((w[i, j] + y[i, j] + z[i, j] <= Q * x[i, j] for i, j in A),
                 name="capacidad")

    # (8)-(10) Manipulación de las entregas pendientes
    m.addConstrs((ha * y.sum(i, "*") == p[i] + q[i] for i in Vc), name="manip")
    m.addConstrs((p[i] <= ha * suma_alpha * s[i] for i in Vc), name="act_p")
    m.addConstrs((q[i] <= ha * suma_alpha * (1 - s[i]) for i in Vc), name="act_q")

    # (11) Fin de la entrega
    m.addConstrs((D[i] == T[i] + ub * z.sum("*", i) + ua * alpha[i] for i in Vc),
                 name="fin_entrega")

    # (12) Salida del cliente
    m.addConstrs((F[i] == D[i] + lb * (z.sum("*", i) + beta[i]) + q[i] for i in Vc),
                 name="salida")

    # (13) Propagación temporal
    m.addConstrs((T[j] >= F[i] + c[i][j] - M * (1 - x[i, j]) for i, j in A if j != 0),
                 name="tiempo")

    # (14) Origen temporal
    m.addConstr(T[0] == 0, name="T0")
    m.addConstr(F[0] == 0, name="F0")

    variables = {"x": x, "s": s, "w": w, "y": y, "z": z, "p": p, "q": q,
                 "T": T, "F": F, "D": D}

    if r20_23:
        # (20)-(21) Carga al salir del depósito y al regresar
        m.addConstrs((y[0, j] == suma_alpha * x[0, j] for j in Vc), name="y0j")
        m.addConstrs((w[0, j] == 0 for j in Vc), name="w0j")
        m.addConstrs((z[0, j] == 0 for j in Vc), name="z0j")
        m.addConstrs((y[i, 0] == 0 for i in Vc), name="yi0")
        m.addConstrs((w[i, 0] + z[i, 0] == suma_beta * x[i, 0] for i in Vc), name="wzi0")
        # (22)-(23) Transiciones de cada política
        m.addConstrs((w.sum(i, "*") - w.sum("*", i) >= 0 for i in Vc), name="fondo")
        m.addConstrs((z.sum(i, "*") <= s[i] * suma_beta for i in Vc), name="puerta")

    if r24_29:
        f = m.addVars(A, lb=0.0, name="f")                                   # (29)
        m.addConstrs((f[0, j] == n * x[0, j] for j in Vc), name="f0j")       # (24)
        m.addConstrs((f[i, 0] == 0 for i in Vc), name="fi0")                 # (25)
        m.addConstrs((f.sum("*", i) - f.sum(i, "*") == 1 for i in Vc),       # (26)
                     name="f_cons")
        m.addConstrs((f[i, j] >= x[i, j] for i, j in A if i != 0 and j != 0),  # (27)
                     name="f_inf")
        m.addConstrs((f[i, j] <= (n - 1) * x[i, j] for i, j in A if i != 0 and j != 0),
                     name="f_sup")
        m.addConstr(D.sum() >= gp.quicksum(c[i][j] * f[i, j] for i, j in A)  # (28)
                    + gp.quicksum(ua * alpha[i] * f.sum("*", i)
                                  + lb * beta[i] * f.sum(i, "*")
                                  + ub * z.sum("*", i) for i in Vc),
                    name="latencia")
        variables["f"] = f

    return m, variables


def _redondear(v):
    v = round(v, 6)
    return 0.0 if abs(v) < TOL else v


def extraer_solucion(inst, m, var):
    """Ruta, políticas, instantes, cargas y estadísticas de la ejecución."""
    estados = {GRB.OPTIMAL: "OPTIMAL", GRB.TIME_LIMIT: "TIME_LIMIT",
               GRB.INFEASIBLE: "INFEASIBLE", GRB.INTERRUPTED: "INTERRUPTED",
               GRB.SUBOPTIMAL: "SUBOPTIMAL"}
    sol = {
        "estado": estados.get(m.Status, str(m.Status)),
        "segundos": round(m.Runtime, 4),
        "nodos": int(m.NodeCount),
        "iteraciones": int(m.IterCount),
        "variables": m.NumVars,
        "binarias": m.NumBinVars,
        "restricciones": m.NumConstrs,
    }
    if m.SolCount == 0:
        return sol

    x, s, w, y, z = var["x"], var["s"], var["w"], var["y"], var["z"]
    sucesor = {i: j for (i, j) in x if x[i, j].X > 0.5}
    ruta, actual = [], sucesor[0]
    while actual != 0 and len(ruta) <= inst["n"]:
        ruta.append(actual)
        actual = sucesor[actual]
    arcos = list(zip([0] + ruta, ruta + [0]))
    c, alpha = inst["c"], inst["alpha"]
    hb = inst["ub"] + inst["lb"]
    # Término de manipulación adicional del objetivo (31) de Battarra et al.
    manipulacion = (sum(hb * z[i, j].X for i, j in arcos if j != 0 and alpha[j] > 0)
                    + sum(var["q"][i].X for i in ruta))
    ultimo = ruta[-1]
    sol.update({
        "objetivo": round(m.ObjVal, 6),
        "cota": round(m.ObjBound, 6),
        "gap": round(m.MIPGap, 6),
        "ruta": [0] + ruta + [0],
        "politica": {i: int(round(s[i].X)) for i in ruta},
        "T": {i: _redondear(var["T"][i].X) for i in ruta},
        "D": {i: _redondear(var["D"][i].X) for i in ruta},
        "F": {i: _redondear(var["F"][i].X) for i in ruta},
        "q": {i: _redondear(var["q"][i].X) for i in ruta},
        "cargas": [{"arco": [i, j], "w": _redondear(w[i, j].X),
                    "y": _redondear(y[i, j].X), "z": _redondear(z[i, j].X)}
                   for i, j in arcos],
        "viaje": sum(c[i][j] for i, j in arcos),
        "manipulacion_adicional": _redondear(manipulacion),
        "regreso": _redondear(var["F"][ultimo].X + c[ultimo][0]),
    })
    return sol


def resolver(inst, r20_23, r24_29, env):
    """Construye y resuelve el modelo; mide el tiempo de cada etapa.

    segundos = resolución de Gurobi (Runtime); segundos_total = construcción
    del modelo + resolución + lectura de la solución.
    """
    inicio = time.perf_counter()
    m, var = construir_modelo(inst, r20_23, r24_29, env=env)
    m.update()
    construccion = time.perf_counter() - inicio
    if LIMITE_TIEMPO is not None:
        m.Params.TimeLimit = LIMITE_TIEMPO
    if HILOS is not None:
        m.Params.Threads = HILOS
    m.optimize()
    sol = extraer_solucion(inst, m, var)
    m.dispose()
    sol["segundos_construccion"] = round(construccion, 4)
    sol["segundos_total"] = round(time.perf_counter() - inicio, 4)
    return sol


def guardar_salida(inst, sol, r20_23, r24_29):
    """Escribe Outputs/gurobi/<variante>/<instancia>.json y devuelve la ruta."""
    variante, etiqueta = VARIANTES[r20_23, r24_29]
    salida = {
        "formato": FORMATO,
        "generado": datetime.now().isoformat(timespec="seconds"),
        "algoritmo": {
            "clave": "gurobi",
            "nombre": f"Gurobi · {etiqueta}",
            "parametros": {"variante": variante, "explicitacion": r20_23,
                           "latencia": r24_29, "limite_tiempo": LIMITE_TIEMPO,
                           "hilos": HILOS},
        },
        "instancia": inst,
        "solucion": sol,
    }
    carpeta = CARPETA_OUTPUTS / "gurobi" / variante
    carpeta.mkdir(parents=True, exist_ok=True)
    archivo = carpeta / f"{inst['nombre']}.json"
    archivo.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
    return archivo


def _lista(v):
    return list(v) if isinstance(v, (list, tuple, range)) else [v]


def main():
    variantes = [(a, b) for b in _lista(RESTRICCIONES_24_29)
                 for a in _lista(RESTRICCIONES_20_23)]
    # El entorno (y la licencia) se inicia una vez, fuera de los tiempos medidos
    with gp.Env(empty=True) as env:
        env.setParam("OutputFlag", 1 if MOSTRAR_LOG else 0)
        env.start()
        for n in _lista(N):
            for id_ in _lista(ID):
                for h in _lista(H):
                    inst = leer_instancia(n, id_, h)
                    print(f"\n=== {inst['nombre']}  (N = {n}, ID = {id_}, H = {h:g})")
                    for r20_23, r24_29 in variantes:
                        sol = resolver(inst, r20_23, r24_29, env)
                        etiqueta = VARIANTES[r20_23, r24_29][1]
                        if "ruta" not in sol:
                            print(f"  {etiqueta:<22} {sol['estado']}: sin solución, no se guarda")
                            continue
                        guardar_salida(inst, sol, r20_23, r24_29)
                        print(f"  {etiqueta:<22} {sol['estado']:<10} "
                              f"obj = {sol['objetivo']:<10g} "
                              f"Gurobi {sol['segundos']:8.3f} s  "
                              f"total {sol['segundos_total']:8.3f} s  "
                              f"nodos {sol['nodos']}")


if __name__ == "__main__":
    main()
