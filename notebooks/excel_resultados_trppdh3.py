"""Arma Outputs/resumenes/gurobi_resultados.xlsx: Gurobi (4 variantes) + 5 heurísticas con réplicas.

    python excel_resultados_trppdh3.py              # reescribe Outputs/resumenes/gurobi_resultados.xlsx
    python excel_resultados_trppdh3.py otro.xlsx    # o lo guarda en otro archivo

Lee
    Outputs/gurobi/<variante>/<instancia>.json         las corridas de Gurobi (n = 5 a 60)
    Outputs/resumenes/heuristicas_replicas.csv         las réplicas de las heurísticas
                                                       (npm run heuristicas -- --replicas 10 ...)
y escribe cinco hojas:
    Resumen                          promedios por banco y N (fórmulas sobre Resultados y Detalle)
    Resultados                       una fila por instancia: BKS, su origen, las 4 variantes de
                                     Gurobi y las 5 heurísticas (fórmulas sobre la hoja de réplicas)
    Heurísticas y metaheurísticas    una fila por instancia × algoritmo × réplica
    Detalle                          una fila por corrida de Gurobi
    Definiciones                     parámetros y definición de cada columna

BKS (best known solution) = menor Σ Dᵢ entre las cotas superiores de las 4 variantes de Gurobi
y el mejor costo (en sus réplicas) de cada heurística. GAP sol. entera = (Cota superior − BKS)
/ BKS. Las fórmulas se recalculan al abrir el archivo en Excel (MINIFS: Excel 2019 o 365).
Si faltan réplicas, las celdas de esa heurística quedan vacías y el BKS usa lo que haya.
"""

import csv
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.properties import CalcProperties

RAIZ = Path(__file__).resolve().parent.parent
GUROBI = RAIZ / "Outputs" / "gurobi"
CSV_REPLICAS = RAIZ / "Outputs" / "resumenes" / "heuristicas_replicas.csv"
DESTINO = RAIZ / "Outputs" / "resumenes" / "gurobi_resultados.xlsx"

VARIANTES = [("base", "(1)-(19)"), ("explicitacion", "(1)-(19) + (20)-(23)"),
             ("latencia", "(1)-(19) + (24)-(29)"), ("completo", "(1)-(29)")]
# clave del CSV, nombre en la hoja de réplicas, título del bloque
ALGORITMOS = [("dos_fases", "2 fases", "Heurística 2 fases"),
              ("ils_exacto", "ILS exacto", "ILS exacto"),
              ("ils_heuristico", "ILS heurístico", "ILS heurístico"),
              ("its_exacto", "ITS exacto", "ITS exacto"),
              ("its_heuristico", "ITS heurístico", "ITS heurístico")]
HOJA_REP = "Heurísticas y metaheurísticas"
REP = f"'{HOJA_REP}'!"
TOL = "1E-6"   # tolerancia relativa para decidir si un costo alcanza el BKS

NUM, PCT, ENTERO = "#,##0.00", "0.00%", "#,##0"
SEG, SEG_IT = "#,##0.000", "0.000000"
FUENTE = Font(name="Arial", size=10)
NEGRITA = Font(name="Arial", size=10, bold=True)
TITULO = Font(name="Arial", size=12, bold=True)
BLANCA = Font(name="Arial", size=10, bold=True, color="FFFFFF")
AZUL = PatternFill("solid", fgColor="1F3864")
CELESTE = PatternFill("solid", fgColor="D9E1F2")
AMARILLO = PatternFill("solid", fgColor="FFF2CC")
VERDE = PatternFill("solid", fgColor="E2EFDA")
CENTRO = Alignment(horizontal="center", vertical="center", wrap_text=True)
ARRIBA = Alignment(vertical="top", wrap_text=True)
SEPARADOR = Border(left=Side(style="medium", color="1F3864"))

# Lectura de la hoja Resumen (Gurobi); las de las heurísticas se agregan al terminar las réplicas
LECTURA = [
    "• N = 5 se resuelve al óptimo con las 4 variantes en las 30 instancias, en menos de 0,1 s; las 5 "
    "heurísticas salvo 2 fases también llegan al óptimo en todas, y 2 fases en 14 de 30.",
    "• Solo N = 5 y N = 10 se resuelven al óptimo en 1 hora. En N = 10: las 30 instancias con (24)-(29), "
    "29 con (1)-(19) y 28 con (20)-(23). Las variantes óptimas dan exactamente el mismo Σ Dᵢ en las 30 "
    "instancias.",
    "• En N = 10 la desigualdad de latencia (24)-(29) acelera unas 25 veces: 44 s en promedio contra "
    "1 092 s de (1)-(19), con unas 45 veces menos nodos. (20)-(23) no acelera: 1 175 s.",
    "• Desde N = 15 casi todas las corridas llegan al límite de tiempo (salvo vigo_n15_id9_h0.1 con "
    "(24)-(29)). El GAP crece con N y con h: con (1)-(19) va de 58 % (N = 15) a 91 % (N = 60).",
    "• La relajación lineal de (1)-(19) es casi nula (GAP relajación lineal ≈ 99 %, hoja Detalle; sin "
    "dato en N = 5) por las big-M de (13); (20)-(23) no la cambia y (24)-(29) la sube a ≈ 48 % del óptimo en N = 10. Por "
    "eso las variantes con (24)-(29) dan la mejor cota inferior en casi todas las instancias.",
    "• En N ≥ 40, (1)-(19) y (1)-(19)+(20)-(23) encuentran mejores soluciones (cota superior) que las "
    "variantes con (24)-(29), que exploran muchos menos nodos.",
    "• Gurobi nunca da una BKS que no encuentren también las heurísticas. Desde N = 20 hay instancias "
    "en que solo las heurísticas llegan a la BKS, y desde N = 40 son todas: la mejor heurística mejora "
    "la mejor cota superior de Gurobi en 3,9 % (N = 40), 10,6 % (N = 50) y 14,7 % (N = 60) en "
    "promedio, y hasta en 29,8 %.",
    "• ILS exacto alcanza la BKS en las 270 instancias (con su mejor réplica) y su GAP promedio sobre "
    "las 10 réplicas no pasa de 0,03 % en ningún N. Es también la más lenta: 242 s por réplica en N = 60.",
    "• La evaluación heurística, O(n), hace cada iteración unas 7 veces más rápido que la exacta en "
    "N = 60 (0,09 s contra 0,61 s en ILS), pero pierde calidad al crecer N: en N = 60 ILS heurístico "
    "alcanza la BKS en 13 de 30 instancias e ITS heurístico en 5 (GAP promedio 0,4 % y 2,0 %).",
    "• ITS exacto queda entre ambos ILS: alcanza la BKS en 15 de 30 instancias de N = 60, con GAP "
    "promedio 1,2 % y 18 s por réplica. La heurística de 2 fases, punto de partida de ILS e ITS, tiene "
    "un GAP de 4,4 % (N = 5) a 19,1 % (N = 60).",
    "• Las réplicas de N = 10 a 60 se corrieron con 8 procesos en paralelo (semilla r en la réplica r): "
    "sus tiempos salen ≈ 1,4 veces más altos que con un proceso solo; los costos no cambian. Las de "
    "N = 5, con un proceso.",
    "• Las corridas de Gurobi con N = 5 son anteriores (29-10-2026) y no registran límite de tiempo, "
    "hilos ni relajación lineal; todas terminan óptimas, así que su costo no depende de eso.",
]


# ------------------------------ Datos ------------------------------

N_MIN = 5   # menor N que entra al Excel (N = 5 a 60)

def banco_de(nombre):
    return "Erdogan" if nombre.endswith("_Erdogan") else "Battarra"


def leer_gurobi():
    """{instancia: {variante: fila}} de las corridas con n ≥ N_MIN."""
    datos = {}
    for variante, etiqueta in VARIANTES:
        for archivo in sorted((GUROBI / variante).glob("*.json")):
            d = json.loads(archivo.read_text(encoding="utf-8"))
            inst, s = d["instancia"], d["solucion"]
            if inst["n"] < N_MIN:
                continue
            costo, lp = s.get("objetivo"), s.get("relajacion_lineal")
            datos.setdefault(inst["nombre"], {})[variante] = {
                "banco": banco_de(inst["nombre"]), "instancia": inst["nombre"], "n": inst["n"],
                "id": inst["id"], "h": inst["h"], "variante": variante, "restricciones": etiqueta,
                "estado": s["estado"], "costo": costo, "cota_inferior": s.get("cota"),
                "cota_superior": costo, "gap": s.get("gap"),
                "gap_relajacion": (costo - lp) / costo if costo and lp is not None else None,
                "relajacion": lp, "segundos": s.get("segundos"),
                "segundos_total": s.get("segundos_total"), "nodos": s.get("nodos"),
                "iteraciones": s.get("iteraciones"), "variables": s.get("variables"),
                "binarias": s.get("binarias"), "num_restricciones": s.get("restricciones"),
                "fecha": datetime.fromisoformat(d["generado"]) if d.get("generado") else None,
            }
    return datos


def archivos_replicas():
    """heuristicas_replicas.csv y los de cada trabajador en paralelo (heuristicas_replicas_<k>.csv)."""
    return sorted(p for p in CSV_REPLICAS.parent.glob("heuristicas_replicas*.csv")
                  if re.fullmatch(r"heuristicas_replicas(_\d+)?\.csv", p.name))


def leer_replicas(instancias):
    nombres = {clave: nombre for clave, nombre, _ in ALGORITMOS}
    orden_alg = [a[0] for a in ALGORITMOS]
    filas, vistas = [], set()
    leidas = []
    for archivo in archivos_replicas():
        with archivo.open(encoding="utf-8") as f:
            leidas.extend(csv.DictReader(f))
    for r in leidas:
        if (r["instancia"], r["algoritmo"], r["replica"]) in vistas:
            continue
        vistas.add((r["instancia"], r["algoritmo"], r["replica"]))
        if r["instancia"] not in instancias or r["algoritmo"] not in nombres:
            continue
        num = lambda k, tipo=float: tipo(r[k]) if r[k] not in ("", None) else None
        filas.append({
            "banco": r["banco"], "instancia": r["instancia"], "n": int(r["n"]), "id": int(r["id"]),
            "h": float(r["h"]), "clave": r["algoritmo"], "algoritmo": nombres[r["algoritmo"]],
            "replica": int(r["replica"]), "semilla": num("semilla", int), "costo": num("costo"),
            "segundos": num("segundos"), "segundos_inicial": num("segundos_inicial"),
            "segundos_busqueda": num("segundos_busqueda"), "iteraciones": num("iteraciones", int),
            "segundos_por_iteracion": num("segundos_por_iteracion"),
            "iteracion_mejor": num("iteracion_mejor", int), "segundos_mejor": num("segundos_mejor"),
            "evaluaciones_exactas": num("evaluaciones_exactas", int),
            "evaluaciones_heuristicas": num("evaluaciones_heuristicas", int),
            "n_iter": num("n_iter", int), "motor": r["motor"],
            "fecha": datetime.fromisoformat(r["fecha"]) if r["fecha"] else None,
            "ruta": r["ruta"], "politica": r["politica"],
        })
    filas.sort(key=lambda f: (f["n"], f["h"], f["id"], f["banco"], orden_alg.index(f["clave"]), f["replica"]))
    return filas


# ------------------------------ Excel ------------------------------

def celda(ws, fila, col, valor, fuente=FUENTE, formato=None, relleno=None, alineacion=None):
    c = ws.cell(fila, col, valor)
    c.font = fuente
    if formato:
        c.number_format = formato
    if relleno:
        c.fill = relleno
    if alineacion:
        c.alignment = alineacion
    return c


def encabezados(ws, bloques, fila_grupo, fila_col, alto=40):
    """bloques: [(título, [(encabezado, ancho), ...])]. Devuelve la columna inicial de cada bloque."""
    col, inicios = 1, []
    for titulo, columnas in bloques:
        inicios.append(col)
        if len(columnas) > 1:
            ws.merge_cells(start_row=fila_grupo, start_column=col, end_row=fila_grupo,
                           end_column=col + len(columnas) - 1)
        celda(ws, fila_grupo, col, titulo, BLANCA, relleno=AZUL, alineacion=CENTRO)
        for k, (texto, ancho) in enumerate(columnas):
            celda(ws, fila_col, col + k, texto, NEGRITA, relleno=CELESTE, alineacion=CENTRO)
            ws.column_dimensions[L(col + k)].width = ancho
        col += len(columnas)
    ws.row_dimensions[fila_col].height = alto
    return inicios


def separadores(ws, inicios, desde, hasta):
    for inicio in inicios[1:]:
        for r in range(desde, hasta + 1):
            ws.cell(r, inicio).border = SEPARADOR


POR_VARIANTE = [("Costo", 12), ("Cota inferior", 12), ("Cota superior", 12), ("GAP", 9),
                ("GAP sol. entera", 10), ("Tiempo (s)", 11), ("Nodos", 11)]
POR_HEURISTICA = [("Costo Promedio", 12), ("Mejor Costo", 12), ("GAP Promedio", 10),
                  ("GAP Mejor Costo", 10), ("Tiempo Promedio (s)", 11),
                  ("Tiempo Promedio Iteraciones (s)", 13)]


def columnas_resultados():
    """Letras de las columnas de la hoja Resultados por bloque."""
    col = 8   # A-E instancia, F BKS, G origen
    gurobi = {}
    for variante, _ in VARIANTES:
        gurobi[variante] = {k: L(col + i) for i, k in enumerate(
            ["costo", "cota_inferior", "cota_superior", "gap", "gap_entera", "segundos", "nodos"])}
        col += len(POR_VARIANTE)
    heur = {}
    for clave, _, _ in ALGORITMOS:
        heur[clave] = {k: L(col + i) for i, k in enumerate(
            ["promedio", "mejor", "gap_promedio", "gap_mejor", "tiempo", "tiempo_iteracion"])}
        col += len(POR_HEURISTICA)
    return gurobi, heur


def hoja_replicas(ws, filas, fila_de):
    """Una fila por instancia × algoritmo × réplica."""
    columnas = [("Banco", 10, None), ("Instancia", 26, None), ("N", 6, None), ("ID", 6, None),
                ("h", 6, None), ("Algoritmo", 15, None), ("Réplica", 8, None), ("Semilla", 8, None),
                ("Costo", 12, NUM), ("BKS", 12, NUM), ("GAP vs BKS", 10, PCT), ("Tiempo (s)", 11, SEG),
                ("Tiempo 2 fases (s)", 11, SEG), ("Tiempo búsqueda (s)", 11, SEG),
                ("Iteraciones", 11, ENTERO), ("Tiempo por iteración (s)", 12, SEG_IT),
                ("Iteración de la mejor", 11, ENTERO), ("Tiempo a la mejor (s)", 11, SEG),
                ("Evaluaciones exactas", 13, ENTERO), ("Evaluaciones heurísticas", 13, ENTERO),
                ("Fecha", 17, "yyyy-mm-dd hh:mm"), ("Ruta", 40, None), ("Política (s_i)", 22, None)]
    for col, (texto, ancho, _) in enumerate(columnas, 1):
        celda(ws, 1, col, texto, BLANCA, relleno=AZUL, alineacion=CENTRO)
        ws.column_dimensions[L(col)].width = ancho
    ws.row_dimensions[1].height = 40
    ultima = len(fila_de) + 2
    for r, f in enumerate(filas, 2):
        bks = f"INDEX(Resultados!$F$3:$F${ultima},MATCH($B{r},Resultados!$B$3:$B${ultima},0))"
        valores = [f["banco"], f["instancia"], f["n"], f["id"], f["h"], f["algoritmo"], f["replica"],
                   f["semilla"], f["costo"], f"={bks}", f"=IFERROR((I{r}-J{r})/J{r},\"\")", f["segundos"],
                   f["segundos_inicial"], f["segundos_busqueda"], f["iteraciones"],
                   f["segundos_por_iteracion"], f["iteracion_mejor"], f["segundos_mejor"],
                   f["evaluaciones_exactas"], f["evaluaciones_heuristicas"], f["fecha"], f["ruta"],
                   f["politica"]]
        for col, (valor, (_, _, formato)) in enumerate(zip(valores, columnas), 1):
            celda(ws, r, col, valor, formato=formato)
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{L(len(columnas))}{max(len(filas) + 1, 2)}"
    return max(len(filas) + 1, 2)


def hoja_resultados(ws, gurobi, instancias, n_rep):
    cg, ch = columnas_resultados()
    bloques = ([("Instancia", [("Banco", 10), ("Instancia", 26), ("N", 6), ("ID", 6), ("h", 6)]),
                ("Mejor solución conocida", [("BKS", 12), ("Origen BKS", 40)])]
               + [(etiqueta, POR_VARIANTE) for _, etiqueta in VARIANTES]
               + [(titulo, POR_HEURISTICA) for _, _, titulo in ALGORITMOS])
    inicios = encabezados(ws, bloques, 1, 2)
    ultima_rep = n_rep

    def rango(col):
        return f"{REP}${col}$2:${col}${ultima_rep}"

    fila_de = {}
    for r, nombre in enumerate(instancias, 3):
        fila_de[nombre] = r
        corridas = gurobi[nombre]
        base = next(iter(corridas.values()))
        for k, clave in enumerate(["banco", "instancia", "n", "id", "h"], 1):
            celda(ws, r, k, base[clave])
        # Gurobi: valores y GAP sol. entera con el BKS
        for (variante, _), inicio in zip(VARIANTES, inicios[2:6]):
            c = corridas.get(variante)
            if c is None:
                continue
            relleno = None if c["estado"] == "OPTIMAL" else AMARILLO
            col = cg[variante]
            valores = [c["costo"], c["cota_inferior"], c["cota_superior"], c["gap"],
                       f'=IF(ISNUMBER({col["cota_superior"]}{r}),({col["cota_superior"]}{r}-$F{r})/$F{r},"")',
                       c["segundos"], c["nodos"]]
            formatos = [NUM, NUM, NUM, PCT, PCT, NUM, ENTERO]
            for k, (v, fmt) in enumerate(zip(valores, formatos)):
                celda(ws, r, inicio + k, v, formato=fmt, relleno=relleno)
        # Heurísticas: fórmulas sobre la hoja de réplicas
        for (clave, nombre_alg, _), inicio in zip(ALGORITMOS, inicios[6:]):
            col = ch[clave]
            criterio = f'{rango("B")},$B{r},{rango("F")},"{nombre_alg}"'
            hay = f"COUNTIFS({criterio})>0"
            formulas = [
                f'=IF({hay},AVERAGEIFS({rango("I")},{criterio}),"")',
                f'=IF({hay},_xlfn.MINIFS({rango("I")},{criterio}),"")',
                f'=IF(ISNUMBER({col["promedio"]}{r}),({col["promedio"]}{r}-$F{r})/$F{r},"")',
                f'=IF(ISNUMBER({col["mejor"]}{r}),({col["mejor"]}{r}-$F{r})/$F{r},"")',
                f'=IF({hay},AVERAGEIFS({rango("L")},{criterio}),"")',
                (f'=IF({hay},AVERAGEIFS({rango("P")},{criterio}),"")' if clave != "dos_fases" else "—"),
            ]
            formatos = [NUM, NUM, PCT, PCT, SEG, SEG_IT]
            for k, (v, fmt) in enumerate(zip(formulas, formatos)):
                celda(ws, r, inicio + k, v, formato=fmt,
                      alineacion=Alignment(horizontal="center") if v == "—" else None)
        # BKS y su origen
        candidatos = [f"{cg[v]['cota_superior']}{r}" for v, _ in VARIANTES] + \
                     [f"{ch[c]['mejor']}{r}" for c, _, _ in ALGORITMOS]
        celda(ws, r, 6, f"=MIN({','.join(candidatos)})", NEGRITA, formato=NUM, relleno=VERDE)
        etiquetas = [f"Gurobi {e.replace(' ', '')}" for _, e in VARIANTES] + [n for _, n, _ in ALGORITMOS]
        partes = [f'IFERROR(IF(ABS({x}-$F{r})<={TOL}*$F{r},", {e}",""),"")'
                  for x, e in zip(candidatos, etiquetas)]
        celda(ws, r, 7, f"=MID({'&'.join(partes)},3,400)", relleno=VERDE)
    ultima = len(instancias) + 2
    separadores(ws, inicios, 1, ultima)
    ws.freeze_panes = "H3"
    ws.auto_filter.ref = f"A2:{L(inicios[-1] + len(POR_HEURISTICA) - 1)}{ultima}"
    return fila_de


def hoja_detalle(ws, gurobi, instancias, ultima_res):
    columnas = [("banco", "Banco", None, 10), ("instancia", "Instancia", None, 26), ("n", "N", None, 6),
                ("id", "ID", None, 6), ("h", "h", None, 6), ("variante", "Variante", None, 14),
                ("restricciones", "Restricciones", None, 21), ("estado", "Estado", None, 12),
                ("costo", "Costo", NUM, 12), ("cota_inferior", "Cota inferior", NUM, 12),
                ("cota_superior", "Cota superior", NUM, 12), ("gap", "GAP", PCT, 9),
                ("gap_entera", "GAP sol. entera", PCT, 10), ("relajacion", "Relajación lineal", NUM, 12),
                ("gap_relajacion", "GAP relajación lineal", PCT, 11),
                ("segundos", "Tiempo (s)", NUM, 11), ("segundos_total", "Tiempo total (s)", NUM, 11),
                ("nodos", "Nodos", ENTERO, 11), ("iteraciones", "Iteraciones", ENTERO, 12),
                ("variables", "Variables", ENTERO, 10), ("binarias", "Binarias", ENTERO, 10),
                ("num_restricciones", "N° restricciones", ENTERO, 12),
                ("fecha", "Fecha", "yyyy-mm-dd hh:mm", 17)]
    for col, (_, texto, _, ancho) in enumerate(columnas, 1):
        celda(ws, 1, col, texto, BLANCA, relleno=AZUL, alineacion=CENTRO)
        ws.column_dimensions[L(col)].width = ancho
    ws.row_dimensions[1].height = 27
    r = 1
    for nombre in instancias:
        for variante, _ in VARIANTES:
            f = gurobi[nombre].get(variante)
            if f is None:
                continue
            r += 1
            bks = f"INDEX(Resultados!$F$3:$F${ultima_res},MATCH($B{r},Resultados!$B$3:$B${ultima_res},0))"
            relleno = None if f["estado"] == "OPTIMAL" else AMARILLO
            for col, (clave, _, formato, _) in enumerate(columnas, 1):
                valor = f'=IF(ISNUMBER(K{r}),(K{r}-{bks})/{bks},"")' if clave == "gap_entera" else f[clave]
                celda(ws, r, col, valor, formato=formato, relleno=relleno)
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{L(len(columnas))}{r}"
    return r


def hoja_resumen(ws, grupos, n_inst, n_det, n_rep_total):
    cg, ch = columnas_resultados()
    celda(ws, 1, 1, "TRPPD-H3 · Gurobi 11.0.0, 1 hilo y 3 600 s por modelo (N = 5: corrida previa, ver "
                    f"Definiciones) · {n_inst} instancias × 4 variantes = {n_det - 1} corridas · 5 heurísticas × "
                    f"10 réplicas ({n_rep_total} corridas)", TITULO)
    celda(ws, 2, 1, "Promedios sobre las 30 instancias de cada N (ID 1 a 10 × h 0,1 / 0,5 / 1). "
                    "Fórmulas sobre las hojas Resultados y Detalle.")
    por_variante = [("Óptimos", 9, ENTERO), ("Tiempo prom. (s)", 11, NUM), ("GAP prom.", 10, PCT),
                    ("GAP sol. entera prom.", 11, PCT), ("Nodos prom.", 12, ENTERO),
                    ("Alcanza la BKS (veces)", 10, ENTERO), ("Mejor cota (veces)", 10, ENTERO)]
    por_heur = [("GAP prom.", 10, PCT), ("GAP mejor costo prom.", 11, PCT), ("Tiempo prom. (s)", 11, SEG),
                ("Tiempo prom. iteraciones (s)", 12, SEG_IT), ("Alcanza la BKS (veces)", 10, ENTERO)]
    bloques = ([("Instancias", [("Banco", 10), ("N", 6), ("Instancias", 10)])]
               + [(e, [(t, a) for t, a, _ in por_variante]) for _, e in VARIANTES]
               + [(t, [(x, a) for x, a, _ in por_heur]) for _, _, t in ALGORITMOS])
    inicios = encabezados(ws, bloques, 4, 5)

    u = n_inst + 2
    res = lambda col: f"Resultados!${col}$3:${col}${u}"
    det = lambda col: f"Detalle!${col}$2:${col}${n_det}"
    for r, (banco, n) in enumerate(grupos, 6):
        celda(ws, r, 1, banco)
        celda(ws, r, 2, n)
        filtro = f'{res("A")},$A{r},{res("C")},$B{r}'
        celda(ws, r, 3, f"=COUNTIFS({filtro})", formato=ENTERO)
        cotas = [cg[v]["cota_inferior"] for v, _ in VARIANTES]
        for (variante, _), inicio in zip(VARIANTES, inicios[1:5]):
            col = cg[variante]
            otras = "*".join(f'({res(col["cota_inferior"])}>={res(c)}-{TOL}*ABS({res(c)}))'
                             for c in cotas if c != col["cota_inferior"])
            formulas = [
                f'=COUNTIFS({det("A")},$A{r},{det("C")},$B{r},{det("F")},"{variante}",{det("H")},"OPTIMAL")',
                f'=AVERAGEIFS({res(col["segundos"])},{filtro})',
                f'=AVERAGEIFS({res(col["gap"])},{filtro})',
                f'=AVERAGEIFS({res(col["gap_entera"])},{filtro})',
                f'=AVERAGEIFS({res(col["nodos"])},{filtro})',
                f'=COUNTIFS({filtro},{res(col["gap_entera"])},"<={TOL}")',
                f'=SUMPRODUCT(({res("A")}=$A{r})*({res("C")}=$B{r})*{otras})',
            ]
            for k, (v, (_, _, fmt)) in enumerate(zip(formulas, por_variante)):
                celda(ws, r, inicio + k, v, formato=fmt)
        for (clave, _, _), inicio in zip(ALGORITMOS, inicios[5:]):
            col = ch[clave]
            formulas = [
                f'=IFERROR(AVERAGEIFS({res(col["gap_promedio"])},{filtro}),"")',
                f'=IFERROR(AVERAGEIFS({res(col["gap_mejor"])},{filtro}),"")',
                f'=IFERROR(AVERAGEIFS({res(col["tiempo"])},{filtro}),"")',
                (f'=IFERROR(AVERAGEIFS({res(col["tiempo_iteracion"])},{filtro}),"")'
                 if clave != "dos_fases" else "—"),
                f'=COUNTIFS({filtro},{res(col["gap_mejor"])},"<={TOL}")',
            ]
            for k, (v, (_, _, fmt)) in enumerate(zip(formulas, por_heur)):
                celda(ws, r, inicio + k, v, formato=fmt,
                      alineacion=Alignment(horizontal="center") if v == "—" else None)
    ultima = len(grupos) + 5
    separadores(ws, inicios, 4, ultima)
    ws.freeze_panes = "D6"

    r = ultima + 2
    celda(ws, r, 1, "Lectura", NEGRITA)
    for texto in LECTURA:
        r += 1
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=inicios[-1] + len(por_heur) - 1)
        celda(ws, r, 1, texto, alineacion=Alignment(wrap_text=True, vertical="top"))
        ws.row_dimensions[r].height = 28


def hoja_definiciones(ws, gurobi, replicas):
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 100
    celda(ws, 1, 1, "TRPPD-H3 · resultados de Gurobi y de las heurísticas", TITULO)
    fechas = sorted(f["fecha"] for c in gurobi.values() for f in c.values() if f["fecha"])
    fechas_rep = sorted(f["fecha"] for f in replicas if f["fecha"])
    motores = sorted({f["motor"] for f in replicas if f["motor"]})
    n_iter = sorted({f["n_iter"] for f in replicas if f["n_iter"]})
    n_rep = max((f["replica"] for f in replicas), default=0)
    fmt = lambda d: d.strftime("%Y-%m-%d %H:%M")
    parametros = [
        ("Corridas de Gurobi", f"{sum(len(c) for c in gurobi.values())} = {len(gurobi)} instancias × 4 variantes"),
        ("Banco Battarra", "N = 5, 10, 15, 20, 25 (instancias sin sufijo, compartidas con el banco de Erdogan)"),
        ("Banco Erdogan", "N = 30, 40, 50, 60 (instancias con sufijo _Erdogan)"),
        ("Pendiente", "Battarra N = 30, 40, 50 (sin sufijo) y 60 (_Battarra) no están en estos resultados"),
        ("ID / h", "1 a 10 / 0,1, 0,5 y 1"),
        ("Límite de tiempo", "3 600 s por modelo"),
        ("Hilos", 1),
        ("Gurobi", "11.0.0 (clúster, arreglos SLURM 18139548 a 18147117), N = 10 a 60. Las 120 corridas de "
                   "N = 5 son anteriores (29-10-2026) y sus JSON no registran límite de tiempo, hilos ni "
                   "relajación lineal; todas terminan en el óptimo"),
        ("Gurobi corrido entre", f"{fmt(fechas[0])} y {fmt(fechas[-1])}" if fechas else "—"),
        ("JSON de Gurobi", "Outputs/gurobi/<variante>/<instancia>.json"),
        ("Corridas de heurísticas", f"{len(replicas)} = instancias × 5 algoritmos × {n_rep} réplicas"),
        ("Réplicas", "Corridas independientes del mismo algoritmo sobre la misma instancia; la réplica r usa "
                     "la semilla r (r = 1 a 10) del generador de números al azar (mulberry32). La heurística "
                     "de 2 fases no usa azar: sus réplicas dan el mismo costo y solo sirven para promediar "
                     "el tiempo."),
        ("Parámetros ILS / ITS", f"N_iter = {', '.join(map(str, n_iter)) or '200'} por solución inicial "
                                 "(2 soluciones iniciales: sentido del TSP e inverso). ILS: N_iter iteraciones "
                                 "de perturbación + búsqueda local. ITS: ⌊√N_iter⌋ = 14 iteraciones de "
                                 "perturbación + búsqueda tabú de 14 pasos, tenencia ⌊0,5·n⌋. N_rand = "
                                 "round(0,1·n) movimientos al azar por perturbación."),
        ("Heurísticas corridas con", f"{', '.join(motores) or '—'} en el PC del autor: N = 10 a 60 con 8 procesos en paralelo y N = 5 con uno "
                                     "(npm run heuristicas -- --replicas 10 --sel B:5-25,E:30-60)"),
        ("Heurísticas corridas entre", f"{fmt(fechas_rep[0])} y {fmt(fechas_rep[-1])}" if fechas_rep else "—"),
        ("CSV de réplicas", "Outputs/resumenes/heuristicas_replicas.csv; la mejor réplica de cada instancia "
                            "queda en Outputs/erdogan/<algoritmo>/<instancia>.json"),
        ("Generado", datetime.now().replace(microsecond=0)),
    ]
    r = 3
    for nombre, valor in parametros:
        celda(ws, r, 1, nombre, NEGRITA, alineacion=ARRIBA)
        celda(ws, r, 2, valor, formato="yyyy-mm-dd hh:mm" if isinstance(valor, datetime) else None,
              alineacion=Alignment(horizontal="left", vertical="top", wrap_text=True))
        r += 1

    definiciones = [
        ("BKS", "Best known solution: menor Σ Dᵢ entre la cota superior de las 4 variantes de Gurobi y el "
                "mejor costo (en sus réplicas) de cada una de las 5 heurísticas."),
        ("Origen BKS", "Métodos que alcanzan el BKS (diferencia relativa ≤ 1E-6); si hay empate se listan "
                       "todos."),
        ("Costo", "Σ Dᵢ de la mejor solución entera encontrada (ObjVal de Gurobi)."),
        ("Cota inferior", "Mejor cota del branch and cut al terminar (ObjBound)."),
        ("Cota superior", "Valor de la mejor solución entera (ObjVal); coincide con el costo."),
        ("GAP", "(Cota superior − Cota inferior) / Cota superior, el MIPGap de Gurobi. 0 % indica óptimo "
                "probado."),
        ("GAP sol. entera", "(Cota superior − BKS) / BKS: cuánto queda la solución de la variante sobre la "
                            "mejor conocida. 0 % = alcanza el BKS."),
        ("Relajación lineal", "Óptimo del modelo con x y s continuas en [0, 1] (hoja Detalle)."),
        ("GAP relajación lineal", "(Costo − Relajación lineal) / Costo (hoja Detalle): distancia entre la "
                                  "solución entera y la relajación lineal; mide la fuerza de la formulación "
                                  "(antes se llamaba GAP sol. entera)."),
        ("Tiempo (s)", "Tiempo de resolución de Gurobi (Runtime), sin contar la construcción del modelo."),
        ("Tiempo total (s)", "Construcción del modelo + resolución + lectura de la solución (hoja Detalle)."),
        ("Nodos", "Nodos explorados por el branch and cut (NodeCount)."),
        ("Estado", "OPTIMAL: óptimo probado. TIME_LIMIT: se alcanzó el límite de tiempo."),
        ("Costo Promedio", "Promedio del Σ Dᵢ de las 10 réplicas de la heurística."),
        ("Mejor Costo", "Menor Σ Dᵢ de las 10 réplicas."),
        ("GAP Promedio", "(Costo Promedio − BKS) / BKS = promedio de (costo de cada réplica − BKS) / BKS."),
        ("GAP Mejor Costo", "(Mejor Costo − BKS) / BKS."),
        ("Tiempo Promedio (s)", "Tiempo total de la corrida (2 fases + búsqueda), promedio de las 10 réplicas."),
        ("Tiempo Promedio Iteraciones (s)", "Tiempo de búsqueda (sin las 2 fases) dividido por el número de "
                                            "iteraciones de la corrida, promedio de las 10 réplicas. ILS: 2 × "
                                            "200 iteraciones (perturbación + búsqueda local); ITS: 2 × 14 "
                                            "(perturbación + búsqueda tabú de 14 pasos). 2 fases no itera (—)."),
        ("Iteración de la mejor", f"Hoja {HOJA_REP}: iteración (contando las dos corridas, una tras otra) en "
                                  "que se alcanzó por primera vez el costo final; 0 = la solución de 2 fases "
                                  "no se mejoró."),
        ("Tiempo a la mejor (s)", f"Hoja {HOJA_REP}: segundos desde el inicio hasta esa iteración."),
        ("Óptimos", "Hoja Resumen: instancias con estado OPTIMAL."),
        ("Alcanza la BKS (veces)", "Hoja Resumen: instancias en que la variante (cota superior) o la heurística "
                                   "(mejor costo) alcanza el BKS; puede haber empates."),
        ("Mejor cota (veces)", "Hoja Resumen: instancias en que la variante logra la mejor cota inferior de "
                               "las 4."),
    ]
    r += 1
    celda(ws, r, 1, "Columna", BLANCA, relleno=AZUL)
    celda(ws, r, 2, "Definición", BLANCA, relleno=AZUL)
    for nombre, texto in definiciones:
        r += 1
        celda(ws, r, 1, nombre, NEGRITA, alineacion=ARRIBA)
        celda(ws, r, 2, texto, alineacion=ARRIBA)
    r += 2
    celda(ws, r, 1, None, relleno=AMARILLO)
    celda(ws, r, 2, "Corrida de Gurobi que no terminó en el óptimo (límite de tiempo): sus cotas y GAP son los "
                    "del momento en que se detuvo.", alineacion=ARRIBA)
    r += 1
    celda(ws, r, 1, None, relleno=VERDE)
    celda(ws, r, 2, "BKS y su origen (fórmulas).", alineacion=ARRIBA)


def main():
    gurobi = leer_gurobi()
    base = {n: next(iter(c.values())) for n, c in gurobi.items()}
    instancias = sorted(gurobi, key=lambda n: (base[n]["n"], base[n]["h"], base[n]["id"], base[n]["banco"]))
    replicas = leer_replicas(set(instancias))
    grupos = sorted({(base[n]["banco"], base[n]["n"]) for n in instancias}, key=lambda g: g[1])

    wb = Workbook()
    ws_resumen = wb.active
    ws_resumen.title = "Resumen"
    ws_res = wb.create_sheet("Resultados")
    ws_rep = wb.create_sheet(HOJA_REP)
    ws_det = wb.create_sheet("Detalle")
    ws_def = wb.create_sheet("Definiciones")

    fila_de = {n: i for i, n in enumerate(instancias, 3)}
    n_rep = hoja_replicas(ws_rep, replicas, fila_de)
    hoja_resultados(ws_res, gurobi, instancias, n_rep)
    n_det = hoja_detalle(ws_det, gurobi, instancias, len(instancias) + 2)
    hoja_resumen(ws_resumen, grupos, len(instancias), n_det, len(replicas))
    hoja_definiciones(ws_def, gurobi, replicas)
    wb.calculation = CalcProperties(fullCalcOnLoad=True)

    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else DESTINO
    temporal = destino.with_name(f"{destino.stem}_tmp.xlsx")
    wb.save(temporal)
    try:
        os.replace(temporal, destino)
    except PermissionError:
        sys.exit(f"No se pudo reemplazar {destino} (¿está abierto en Excel?). Quedó en {temporal}")
    hechas = {(f["instancia"], f["clave"]) for f in replicas}
    print(f"{destino}: {len(instancias)} instancias, {len(replicas)} réplicas "
          f"({len(hechas)} de {len(instancias) * len(ALGORITMOS)} pares instancia-algoritmo)")


if __name__ == "__main__":
    main()
