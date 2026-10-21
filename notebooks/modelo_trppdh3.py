"""Modelo TRPPD-H3 en Gurobi: ecuaciones (1)-(19) de la formulación.

Opcionalmente se agregan las restricciones de explicitación (20)-(23) y la
desigualdad válida de latencia (24)-(29); ninguna modifica el óptimo.
"""

import gurobipy as gp
from gurobipy import GRB

TOL = 1e-6


def construir_modelo(inst, explicitacion=False, latencia=False, env=None):
    """Devuelve (modelo, variables) para la instancia dada."""
    V, Vc, A = list(inst.V), list(inst.Vc), inst.A
    c, alpha, beta, Q = inst.c, inst.alpha, inst.beta, inst.Q
    ua, lb, ub, ha = inst.ua, inst.lb, inst.ub, inst.ha
    suma_alpha, suma_beta = inst.suma_alpha, inst.suma_beta
    M = inst.M

    m = gp.Model(inst.nombre, env=env)

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

    if explicitacion:
        # (20)-(21) Carga al salir del depósito y al regresar
        m.addConstrs((y[0, j] == suma_alpha * x[0, j] for j in Vc), name="y0j")
        m.addConstrs((w[0, j] == 0 for j in Vc), name="w0j")
        m.addConstrs((z[0, j] == 0 for j in Vc), name="z0j")
        m.addConstrs((y[i, 0] == 0 for i in Vc), name="yi0")
        m.addConstrs((w[i, 0] + z[i, 0] == suma_beta * x[i, 0] for i in Vc), name="wzi0")
        # (22)-(23) Transiciones de cada política
        m.addConstrs((w.sum(i, "*") - w.sum("*", i) >= 0 for i in Vc), name="fondo")
        m.addConstrs((z.sum(i, "*") <= s[i] * suma_beta for i in Vc), name="puerta")

    if latencia:
        n = inst.n
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


def extraer_ruta(inst, x):
    """Secuencia de clientes a partir de los valores de x."""
    sucesor = {i: j for i, j in inst.A if x[i, j].X > 0.5}
    ruta, actual = [], sucesor[0]
    while actual != 0 and len(ruta) <= inst.n:
        ruta.append(actual)
        actual = sucesor[actual]
    return ruta


def _redondear(v):
    v = round(v, 6)
    return 0.0 if abs(v) < TOL else v


def extraer_solucion(inst, m, var):
    """Diccionario con la ruta, las políticas, los tiempos y las cargas."""
    estado = {GRB.OPTIMAL: "OPTIMAL", GRB.TIME_LIMIT: "TIME_LIMIT",
              GRB.INFEASIBLE: "INFEASIBLE", GRB.INTERRUPTED: "INTERRUPTED"}
    sol = {
        "instancia": inst.nombre,
        "n": inst.n,
        "id": inst.id_,
        "h": inst.h,
        "ua": inst.ua, "la": inst.la, "ub": inst.ub, "lb": inst.lb,
        "Q": inst.Q,
        "alpha": inst.alpha,
        "beta": inst.beta,
        "estado": estado.get(m.Status, str(m.Status)),
        "segundos": m.Runtime,
        "nodos": m.NodeCount,
    }
    if m.SolCount == 0:
        return sol

    x, s, w, y, z = var["x"], var["s"], var["w"], var["y"], var["z"]
    ruta = extraer_ruta(inst, x)
    arcos = list(zip([0] + ruta, ruta + [0]))
    viaje = sum(inst.c[i][j] for i, j in arcos)
    # Término de manipulación adicional del objetivo (31) de Battarra et al.
    manipulacion = (sum(inst.hb * z[i, j].X for i, j in arcos if j != 0 and inst.alpha[j] > 0)
                    + sum(var["q"][i].X for i in inst.Vc))
    ultimo = ruta[-1]
    sol.update({
        "objetivo": m.ObjVal,
        "cota": m.ObjBound,
        "gap": m.MIPGap,
        "ruta": [0] + ruta + [0],
        "politica": {i: int(round(s[i].X)) for i in ruta},
        "T": {i: _redondear(var["T"][i].X) for i in ruta},
        "D": {i: _redondear(var["D"][i].X) for i in ruta},
        "F": {i: _redondear(var["F"][i].X) for i in ruta},
        "q": {i: _redondear(var["q"][i].X) for i in ruta},
        "cargas": [{"arco": [i, j], "w": _redondear(w[i, j].X),
                    "y": _redondear(y[i, j].X), "z": _redondear(z[i, j].X)}
                   for i, j in arcos],
        "viaje": viaje,
        "manipulacion_adicional": _redondear(manipulacion),
        "regreso": _redondear(var["F"][ultimo].X + inst.c[ultimo][0]),
    })
    return sol


def resolver(inst, limite_tiempo=None, gap=None, hilos=None, verbose=True,
             explicitacion=False, latencia=False):
    """Construye y resuelve el modelo; devuelve el diccionario de solución."""
    with gp.Env(empty=True) as env:
        env.setParam("OutputFlag", 1 if verbose else 0)
        env.start()
        m, var = construir_modelo(inst, explicitacion, latencia, env=env)
        if limite_tiempo is not None:
            m.Params.TimeLimit = limite_tiempo
        if gap is not None:
            m.Params.MIPGap = gap
        if hilos is not None:
            m.Params.Threads = hilos
        m.optimize()
        sol = extraer_solucion(inst, m, var)
        sol["explicitacion"] = explicitacion
        sol["latencia"] = latencia
        m.dispose()
    return sol
