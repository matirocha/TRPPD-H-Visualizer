"""Corridas por lote del modelo TRPPD-H3: las cuatro variantes sobre un banco.

    python lote_trppdh3.py

pregunta qué resolver: el banco de Battarra, el de Erdogan, ambos, o los N que
se escriban (valores sueltos o rangos, p. ej. 10, 20-30). En cada instancia
resuelve las variantes (1)-(19), (1)-(19) + (20)-(23), (1)-(19) + (24)-(29) y
(1)-(29) del modelo de trppdh3_formulacion.pdf. Después de cada modelo, en la
misma carpeta de este script,

  - guarda la solución en gurobi/<variante>/<instancia>.json, el formato
    trppdh3-salida/1 que lee la Página Web 1 (copiando la carpeta gurobi a
    Outputs/), y
  - reescribe gurobi_<banco>.xlsx con el costo, las cotas, los GAP, el tiempo
    y los nodos de las corridas hechas.

El script es autónomo: solo necesita la carpeta Instancias/ (junto al script
o una carpeta más arriba), gurobipy con licencia y openpyxl.

Con REANUDAR = True las corridas que ya están en el Excel no se repiten, así
que basta volver a ejecutar el script para seguir después de cortarlo. Las
instancias que comparten los dos bancos (n = 10 a 25) se copian del Excel del
otro banco si ya se resolvieron ahí.
"""

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

import gurobipy as gp
from gurobipy import GRB
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ============================ Corridas ============================
ID = range(1, 11)    # instancias de e_vigo: 1 a 10
H = [0.1, 0.5, 1]    # tiempo de manipulación h = h_a = h_b

LIMITE_TIEMPO = 3600   # segundos por modelo (1 hora); None = sin límite
HILOS = 1              # hilos de Gurobi (None = los que Gurobi decida)
MOSTRAR_LOG = False    # log de Gurobi en pantalla
REANUDAR = True        # no repite las corridas que ya están en el Excel
# ==================================================================

# Tamaños de cada banco y sufijo del archivo en Instancias/. Con n = 10 a 25
# los dos bancos usan las mismas instancias.
BANCOS = {
    "Battarra": [(10, ""), (15, ""), (20, ""), (25, ""), (30, ""), (40, ""), (50, ""),
                 (60, "Battarra")],
    "Erdogan": [(10, ""), (15, ""), (20, ""), (25, ""), (30, "Erdogan"), (40, "Erdogan"),
                (50, "Erdogan"), (60, "Erdogan")],
}
N_PERMITIDOS = sorted({n for tamanos in BANCOS.values() for n, _ in tamanos})

CARPETA_SCRIPT = Path(__file__).resolve().parent
# Instancias/ junto al script o una carpeta más arriba (estructura del repositorio)
CARPETA_INSTANCIAS = next((c / "Instancias" for c in (CARPETA_SCRIPT, CARPETA_SCRIPT.parent)
                           if (c / "Instancias").is_dir()), CARPETA_SCRIPT / "Instancias")
CARPETA_SALIDA = CARPETA_SCRIPT   # JSON y Excel, junto a este script
FORMATO = "trppdh3-salida/1"
TOL = 1e-6

# (20)-(23), (24)-(29) -> carpeta de los JSON y nombre en el visualizador
VARIANTES = {
    (False, False): ("base", "(1)-(19)"),
    (True, False): ("explicitacion", "(1)-(19) + (20)-(23)"),
    (False, True): ("latencia", "(1)-(19) + (24)-(29)"),
    (True, True): ("completo", "(1)-(29)"),
}

NUM = "#,##0.00"
PCT = "0.00%"
ENTERO = "#,##0"

# Hoja Detalle, una fila por corrida: (clave, encabezado, formato, ancho)
COLUMNAS = [
    ("instancia", "Instancia", None, 26),
    ("n", "N", None, 6),
    ("id", "ID", None, 6),
    ("h", "h", None, 6),
    ("variante", "Variante", None, 14),
    ("restricciones", "Restricciones", None, 21),
    ("estado", "Estado", None, 12),
    ("costo", "Costo", NUM, 12),
    ("cota_inferior", "Cota inferior", NUM, 12),
    ("cota_superior", "Cota superior", NUM, 12),
    ("gap", "GAP", PCT, 9),
    ("gap_entera", "GAP sol. entera", PCT, 10),
    ("relajacion", "Relajación lineal", NUM, 12),
    ("segundos", "Tiempo (s)", NUM, 11),
    ("segundos_total", "Tiempo total (s)", NUM, 11),
    ("nodos", "Nodos", ENTERO, 11),
    ("iteraciones", "Iteraciones", ENTERO, 12),
    ("variables", "Variables", ENTERO, 10),
    ("binarias", "Binarias", ENTERO, 10),
    ("num_restricciones", "N° restricciones", ENTERO, 12),
    ("fecha", "Fecha", "yyyy-mm-dd hh:mm", 17),
]
CLAVES = [c[0] for c in COLUMNAS]
# Columnas de cada variante en la hoja Resultados
POR_VARIANTE = ["costo", "cota_inferior", "cota_superior", "gap", "gap_entera", "segundos", "nodos"]

DEFINICIONES = [
    ("Costo", "Σ Dᵢ de la mejor solución entera encontrada (ObjVal de Gurobi)."),
    ("Cota inferior", "Mejor cota del branch and cut al terminar (ObjBound)."),
    ("Cota superior", "Valor de la mejor solución entera (ObjVal); coincide con el costo."),
    ("GAP", "(Cota superior − Cota inferior) / Cota superior, el MIPGap de Gurobi. "
            "0 % indica óptimo probado."),
    ("GAP sol. entera", "(Costo − Relajación lineal) / Costo: distancia entre la solución "
                        "entera y la relajación lineal del modelo. Mide la fuerza de la "
                        "formulación; las restricciones (20)-(29) buscan reducirlo."),
    ("Relajación lineal", "Óptimo del modelo con x y s continuas en [0, 1] (hoja Detalle)."),
    ("Tiempo (s)", "Tiempo de resolución de Gurobi (Runtime), sin contar la construcción "
                   "del modelo."),
    ("Tiempo total (s)", "Construcción del modelo + resolución + lectura de la solución "
                         "(hoja Detalle)."),
    ("Nodos", "Nodos explorados por el branch and cut (NodeCount)."),
    ("Estado", "OPTIMAL: óptimo probado. TIME_LIMIT: se alcanzó el límite de tiempo."),
]

FUENTE = Font(name="Arial", size=10)
NEGRITA = Font(name="Arial", size=10, bold=True)
TITULO = Font(name="Arial", size=12, bold=True)
BLANCA = Font(name="Arial", size=10, bold=True, color="FFFFFF")
AZUL = PatternFill("solid", fgColor="1F3864")
CELESTE = PatternFill("solid", fgColor="D9E1F2")
AMARILLO = PatternFill("solid", fgColor="FFF2CC")
CENTRO = Alignment(horizontal="center", vertical="center", wrap_text=True)
ARRIBA = Alignment(vertical="top", wrap_text=True)
SEPARADOR = Border(left=Side(style="medium", color="1F3864"))


# ------------------------------ Modelo ------------------------------

def leer_instancia(n, id_, h, banco=""):
    nombre = f"vigo_n{n}_id{id_}_h{h:g}" + (f"_{banco}" if banco else "")
    archivo = CARPETA_INSTANCIAS / f"{nombre}.json"
    if not archivo.exists():
        raise FileNotFoundError(f"No existe {archivo}; la carpeta Instancias debe estar "
                                f"junto al script o una carpeta más arriba")
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


def guardar_salida(inst, sol, r20_23, r24_29):
    """Escribe gurobi/<variante>/<instancia>.json y devuelve la ruta."""
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
    carpeta = CARPETA_SALIDA / "gurobi" / variante
    carpeta.mkdir(parents=True, exist_ok=True)
    archivo = carpeta / f"{inst['nombre']}.json"
    archivo.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
    return archivo


# ---------------------------- Resolución ----------------------------

def resolver(inst, r20_23, r24_29, env):
    """Resuelve una variante y su relajación lineal.

    Devuelve la solución de extraer_solucion, con la cota aunque no haya
    solución entera y con el valor de la relajación lineal.
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
    if m.Status == GRB.INTERRUPTED:
        raise KeyboardInterrupt
    sol = extraer_solucion(inst, m, var)
    sol["segundos_construccion"] = round(construccion, 4)
    sol["segundos_total"] = round(time.perf_counter() - inicio, 4)
    if "cota" not in sol:
        try:
            sol["cota"] = round(m.ObjBound, 6)
        except (gp.GurobiError, AttributeError):
            pass

    relajado = m.relax()
    relajado.optimize()
    if relajado.Status == GRB.INTERRUPTED:
        raise KeyboardInterrupt
    sol["relajacion_lineal"] = round(relajado.ObjVal, 6) if relajado.Status == GRB.OPTIMAL else None
    relajado.dispose()
    m.dispose()
    return sol


def fila_excel(inst, variante, etiqueta, sol):
    costo, lp = sol.get("objetivo"), sol.get("relajacion_lineal")
    return {
        "instancia": inst["nombre"], "n": inst["n"], "id": inst["id"], "h": inst["h"],
        "variante": variante, "restricciones": etiqueta, "estado": sol["estado"],
        "costo": costo, "cota_inferior": sol.get("cota"), "cota_superior": costo,
        "gap": sol.get("gap"),
        "gap_entera": (costo - lp) / costo if costo and lp is not None else None,
        "relajacion": lp,
        "segundos": sol["segundos"], "segundos_total": sol["segundos_total"],
        "nodos": sol["nodos"], "iteraciones": sol["iteraciones"],
        "variables": sol["variables"], "binarias": sol["binarias"],
        "num_restricciones": sol["restricciones"],
        "fecha": datetime.now().replace(microsecond=0),
    }


# ------------------------------ Excel ------------------------------

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
    variantes = [v for v, _ in VARIANTES.values()]
    return f["n"], f["h"], f["id"], variantes.index(f["variante"])


def hoja_resultados(ws, filas):
    """Una fila por instancia y un bloque de columnas por variante."""
    ws.title = "Resultados"
    columnas = {clave: (encabezado, formato, ancho) for clave, encabezado, formato, ancho in COLUMNAS}
    fijas = ["instancia", "n", "id", "h"]
    bloques = [("Instancia", fijas)] + [(etiqueta, POR_VARIANTE)
                                        for _, etiqueta in VARIANTES.values()]
    col = 1
    inicios = []
    for nombre, claves in bloques:
        inicios.append(col)
        ws.merge_cells(start_row=1, start_column=col, end_row=1, end_column=col + len(claves) - 1)
        _celda(ws, 1, col, nombre, BLANCA, relleno=AZUL, alineacion=CENTRO)
        for k, clave in enumerate(claves):
            encabezado, _, ancho = columnas[clave]
            _celda(ws, 2, col + k, encabezado, NEGRITA, relleno=CELESTE, alineacion=CENTRO)
            ws.column_dimensions[get_column_letter(col + k)].width = ancho
        col += len(claves)
    ws.row_dimensions[2].height = 27

    instancias = {}
    for f in sorted(filas.values(), key=_orden):
        instancias.setdefault(f["instancia"], f)
    for r, f in enumerate(instancias.values(), 3):
        for k, clave in enumerate(fijas, 1):
            _celda(ws, r, k, f[clave])
        for inicio, (variante, _) in zip(inicios[1:], VARIANTES.values()):
            corrida = filas.get((f["instancia"], variante))
            if corrida is None:
                continue
            relleno = None if corrida["estado"] == "OPTIMAL" else AMARILLO
            for k, clave in enumerate(POR_VARIANTE):
                _celda(ws, r, inicio + k, corrida[clave], formato=columnas[clave][1], relleno=relleno)
    for inicio in inicios[1:]:
        for r in range(1, len(instancias) + 3):
            ws.cell(r, inicio).border = SEPARADOR
    ws.freeze_panes = "E3"


def hoja_detalle(ws, filas):
    """Una fila por corrida, con todos los datos; el script la relee al reanudar."""
    for col, (_, encabezado, _, ancho) in enumerate(COLUMNAS, 1):
        _celda(ws, 1, col, encabezado, BLANCA, relleno=AZUL, alineacion=CENTRO)
        ws.column_dimensions[get_column_letter(col)].width = ancho
    ws.row_dimensions[1].height = 27
    for r, f in enumerate(sorted(filas.values(), key=_orden), 2):
        relleno = None if f["estado"] == "OPTIMAL" else AMARILLO
        for col, (clave, _, formato, _) in enumerate(COLUMNAS, 1):
            _celda(ws, r, col, f[clave], formato=formato, relleno=relleno)
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNAS))}{max(len(filas) + 1, 2)}"


def hoja_definiciones(ws, banco, filas):
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 90
    _celda(ws, 1, 1, "TRPPD-H3 · corridas por lote con Gurobi", TITULO)
    parametros = [
        ("Banco", banco),
        ("N", ", ".join(map(str, sorted({f["n"] for f in filas.values()})))),
        ("ID", ", ".join(map(str, ID))),
        ("h", ", ".join(f"{h:g}" for h in H)),
        ("Límite de tiempo", f"{LIMITE_TIEMPO} s por modelo" if LIMITE_TIEMPO else "sin límite"),
        ("Hilos", HILOS or "los que Gurobi decida"),
        ("Gurobi", ".".join(map(str, gp.gurobi.version()))),
        ("Actualizado", datetime.now().replace(microsecond=0)),
    ]
    r = 3
    for nombre, valor in parametros:
        _celda(ws, r, 1, nombre, NEGRITA)
        _celda(ws, r, 2, valor, formato="yyyy-mm-dd hh:mm" if isinstance(valor, datetime) else None,
               alineacion=Alignment(horizontal="left"))
        r += 1

    r += 1
    _celda(ws, r, 1, "Variante", BLANCA, relleno=AZUL)
    _celda(ws, r, 2, "Restricciones · carpeta del JSON", BLANCA, relleno=AZUL)
    for variante, etiqueta in VARIANTES.values():
        r += 1
        _celda(ws, r, 1, variante)
        _celda(ws, r, 2, f"{etiqueta} · gurobi/{variante}/")

    r += 2
    _celda(ws, r, 1, "Columna", BLANCA, relleno=AZUL)
    _celda(ws, r, 2, "Definición", BLANCA, relleno=AZUL)
    for nombre, texto in DEFINICIONES:
        r += 1
        _celda(ws, r, 1, nombre, NEGRITA, alineacion=ARRIBA)
        _celda(ws, r, 2, texto, alineacion=ARRIBA)
    r += 2
    _celda(ws, r, 1, None, relleno=AMARILLO)
    _celda(ws, r, 2, "Corrida que no terminó en el óptimo: sus cotas y GAP son los del "
                     "momento en que se detuvo. Sin costo = no encontró solución entera.",
           alineacion=ARRIBA)


def guardar_excel(filas, archivo, banco):
    """Reescribe el Excel. Si está abierto en Excel, deja los datos en <nombre>_tmp.xlsx."""
    wb = Workbook()
    hoja_resultados(wb.active, filas)
    hoja_detalle(wb.create_sheet("Detalle"), filas)
    hoja_definiciones(wb.create_sheet("Definiciones"), banco, filas)
    archivo.parent.mkdir(parents=True, exist_ok=True)
    temporal = archivo.with_name(f"{archivo.stem}_tmp.xlsx")
    try:
        wb.save(temporal)
        os.replace(temporal, archivo)
    except PermissionError:
        print(f"  ! No se pudo escribir {archivo.name} (¿abierto en Excel?); "
              f"se reintenta al terminar el siguiente modelo")


def leer_excel(archivo):
    """Corridas de la hoja Detalle de un Excel anterior, por (instancia, variante)."""
    if not archivo.exists():
        return {}
    wb = load_workbook(archivo, read_only=True)
    try:
        filas_hoja = wb["Detalle"].iter_rows(values_only=True)
        if list(next(filas_hoja)) != [c[1] for c in COLUMNAS]:
            raise SystemExit(f"{archivo} tiene otras columnas; renómbralo o bórralo para empezar")
        filas = [dict(zip(CLAVES, valores)) for valores in filas_hoja]
    finally:
        wb.close()
    return {(f["instancia"], f["variante"]): f for f in filas if f["instancia"]}


# ------------------------------ Lote ------------------------------

def _resumen(sol):
    if "objetivo" not in sol:
        return f"{sol['estado']:<10} sin solución entera, no se guarda el JSON"
    return (f"{sol['estado']:<10} obj = {sol['objetivo']:<10g} gap = {sol['gap']:7.2%}  "
            f"Gurobi {sol['segundos']:8.2f} s  nodos {sol['nodos']}")


def archivo_excel(banco):
    return CARPETA_SALIDA / f"gurobi_{banco.lower()}.xlsx"


def correr(banco, tamanos=None):
    """Resuelve las cuatro variantes en cada instancia; False si se detuvo con Ctrl+C."""
    tamanos = BANCOS[banco] if tamanos is None else tamanos
    excel = archivo_excel(banco)
    instancias = [leer_instancia(n, id_, h, sufijo)
                  for n, sufijo in tamanos for h in H for id_ in ID]
    filas, copiadas = {}, 0
    if REANUDAR:
        filas = leer_excel(excel)
        # Instancias compartidas ya resueltas en el Excel del otro banco
        nombres = {inst["nombre"] for inst in instancias}
        for otro in BANCOS:
            if otro == banco:
                continue
            for clave, fila in leer_excel(archivo_excel(otro)).items():
                if clave[0] in nombres and clave not in filas:
                    filas[clave] = fila
                    copiadas += 1
        if copiadas:
            guardar_excel(filas, excel, banco)

    limite = f"{LIMITE_TIEMPO} s por modelo" if LIMITE_TIEMPO else "sin límite de tiempo"
    print(f"\nBanco {banco}, N = {', '.join(str(n) for n, _ in tamanos)}: "
          f"{len(instancias)} instancias x 4 variantes, {limite}")
    hechas = f"{len(filas)} corridas ya hechas" + (
        f", {copiadas} copiadas del Excel del otro banco" if copiadas else "")
    print(f"Excel: {excel}" + (f"  ({hechas})" if filas else ""))

    with gp.Env(empty=True) as env:
        env.setParam("OutputFlag", 1 if MOSTRAR_LOG else 0)
        env.start()
        try:
            for k, inst in enumerate(instancias, 1):
                print(f"\n=== [{k}/{len(instancias)}] Banco {banco} | N = {inst['n']} | "
                      f"h = {inst['h']:g} | ID = {inst['id']}   ({inst['nombre']})")
                for (r20_23, r24_29), (variante, etiqueta) in VARIANTES.items():
                    if (inst["nombre"], variante) in filas:
                        print(f"         {etiqueta:<22} ya está en el Excel")
                        continue
                    # Hora de inicio y variante quedan en pantalla mientras Gurobi resuelve
                    print(f"  {datetime.now():%H:%M}  {etiqueta:<22} ",
                          end="\n" if MOSTRAR_LOG else "", flush=True)
                    sol = resolver(inst, r20_23, r24_29, env)
                    print(_resumen(sol))
                    if "ruta" in sol:
                        guardar_salida(inst, sol, r20_23, r24_29)
                    filas[inst["nombre"], variante] = fila_excel(inst, variante, etiqueta, sol)
                    guardar_excel(filas, excel, banco)
        except KeyboardInterrupt:
            print("\nDetenido. El Excel tiene las corridas terminadas; "
                  "vuelve a ejecutar el script para seguir.")
            return False
    print(f"\nListo: {excel}")
    return True


# ------------------------------ Menú ------------------------------

def _texto_n(valores):
    return ", ".join(map(str, valores))


def _preguntar(opciones):
    """Muestra las opciones numeradas y repite hasta recibir una válida."""
    for k, (opcion, detalle) in enumerate(opciones, 1):
        print(f"  {k}) {opcion:<14} {detalle}")
    while True:
        respuesta = input("Opción: ").strip()
        if respuesta.isdigit() and 1 <= int(respuesta) <= len(opciones):
            return opciones[int(respuesta) - 1][0]
        print(f"  Escribe un número del 1 al {len(opciones)}.")


def leer_n(texto):
    """N elegidos a partir de valores sueltos y rangos, p. ej. "10, 20-30"."""
    elegidos = set()
    for parte in re.sub(r"\s*-\s*", "-", texto).replace(",", " ").split():
        desde, _, hasta = parte.partition("-")
        if not desde.isdigit() or not (hasta or desde).isdigit():
            raise ValueError(f"'{parte}' no es un valor ni un rango (ejemplo: 20-30)")
        desde, hasta = sorted((int(desde), int(hasta or desde)))
        for n in (desde, hasta):
            if n not in N_PERMITIDOS:
                raise ValueError(f"N = {n} no está permitido; usa {_texto_n(N_PERMITIDOS)}")
        elegidos.update(n for n in N_PERMITIDOS if desde <= n <= hasta)
    if not elegidos:
        raise ValueError("Escribe al menos un valor de N")
    return sorted(elegidos)


def elegir():
    """Pregunta qué resolver y devuelve [(banco, tamaños)]."""
    print("¿Qué instancias quieres resolver?")
    opcion = _preguntar([(b, f"N = {_texto_n(n for n, _ in t)}") for b, t in BANCOS.items()]
                        + [("Ambas", "Battarra y después Erdogan"),
                           ("Valores de N", "valores sueltos o un rango de N")])
    if opcion in BANCOS:
        return [(opcion, BANCOS[opcion])]
    if opcion == "Ambas":
        return list(BANCOS.items())

    print(f"N permitidos: {_texto_n(N_PERMITIDOS)}")
    print("Escribe valores sueltos y/o rangos, por ejemplo: 10, 20-30")
    while True:
        try:
            elegidos = leer_n(input("N: "))
            break
        except ValueError as error:
            print(f"  {error}")
    # Los N que están en los dos bancos piden elegir banco; el resto solo existe en uno
    compartidos = [n for n in elegidos if all(n in dict(t) for t in BANCOS.values())]
    bancos = list(BANCOS)
    if compartidos:
        verbo = "está" if len(compartidos) == 1 else "están"
        print(f"N = {_texto_n(compartidos)} {verbo} en los dos bancos. ¿Cuál resolver?")
        opcion = _preguntar([(b, "") for b in BANCOS] + [("Ambas", "")])
        bancos = list(BANCOS) if opcion == "Ambas" else [opcion]
    plan = []
    for banco, tamanos in BANCOS.items():
        elegidos_banco = [(n, sufijo) for n, sufijo in tamanos
                          if n in elegidos and (n not in compartidos or banco in bancos)]
        if elegidos_banco:
            plan.append((banco, elegidos_banco))
    return plan


def main():
    try:
        plan = elegir()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("\nCancelado.")
    for banco, tamanos in plan:
        if not correr(banco, tamanos):
            break


if __name__ == "__main__":
    main()
