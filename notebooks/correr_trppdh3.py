"""Resuelve instancias TRPPD-H3 generadas desde e_vigo con el modelo (1)-(19).

Ejemplos (desde la carpeta notebooks):

    python correr_trppdh3.py --n 5 --ids 1 --h 0.1
    python correr_trppdh3.py --n 5 10 --h 0.1 0.5 1 --tiempo 600
    python correr_trppdh3.py --banco-battarra --tiempo 7200
    python correr_trppdh3.py --n 10 --ids 3 --h 0.5 --ua 0.1 --la 0.4

Cada instancia deja un JSON con formato trppdh3-salida/1 (ver salidas.py) en
Outputs/gurobi/, que lee el visualizador web, y una fila en
Outputs/resumenes/resumen_gurobi_<fecha>.csv.
"""

import argparse
import csv
from datetime import datetime
from pathlib import Path

from instancias_vigo import IDS, TAMANOS, VALORES_H, generar_instancia
from modelo_trppdh3 import resolver
from salidas import CARPETA_OUTPUTS, construir_salida, guardar_salida

CLAVE_ALGORITMO = "gurobi"
NOMBRE_ALGORITMO = "Gurobi · modelo (1)-(19)"
COLUMNAS = ["instancia", "n", "id", "h", "ua", "la", "ub", "lb", "Q", "estado",
            "objetivo", "cota", "gap", "segundos", "nodos", "viaje",
            "manipulacion_adicional", "regreso", "ruta", "politica"]


def banco_battarra():
    """Combinaciones (n, h) que Battarra et al. (2010) resolvieron: excluyen
    h = 0.5 con n = 25 y h = 1 con n >= 20."""
    return [(n, h) for h in VALORES_H for n in TAMANOS
            if not (h == 0.5 and n == 25) and not (h == 1.0 and n >= 20)]


def parsear_argumentos(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, nargs="+", default=[5],
                    help="número de clientes (primeros n de la instancia de 50)")
    ap.add_argument("--ids", type=int, nargs="+", default=list(IDS), help="ids 1..10")
    ap.add_argument("--h", type=float, nargs="+", default=list(VALORES_H),
                    help="tiempo de una operación adicional, h_a = h_b = h")
    ap.add_argument("--banco-battarra", action="store_true",
                    help="usa las combinaciones (n, h) del artículo; ignora --n y --h")
    ap.add_argument("--ua", type=float, help="tiempo de descarga de a (por defecto h/2)")
    ap.add_argument("--la", type=float, help="tiempo de carga de a (por defecto h/2)")
    ap.add_argument("--ub", type=float, help="tiempo de descarga de b (por defecto h/2)")
    ap.add_argument("--lb", type=float, help="tiempo de carga de b (por defecto h/2)")
    ap.add_argument("--tiempo", type=float, default=None, help="límite de tiempo (s)")
    ap.add_argument("--gap", type=float, default=None, help="MIPGap de Gurobi")
    ap.add_argument("--hilos", type=int, default=None, help="Threads de Gurobi")
    ap.add_argument("--explicitacion", action="store_true",
                    help="agrega las restricciones opcionales (20)-(23)")
    ap.add_argument("--latencia", action="store_true",
                    help="agrega la desigualdad válida de latencia (24)-(29)")
    ap.add_argument("--silencioso", action="store_true", help="oculta el log de Gurobi")
    ap.add_argument("--salida", type=Path, default=CARPETA_OUTPUTS)
    return ap.parse_args(argv)


def main(argv=None):
    args = parsear_argumentos(argv)
    combinaciones = (banco_battarra() if args.banco_battarra
                     else [(n, h) for h in args.h for n in args.n])

    carpeta_resumen = args.salida / "resumenes"
    carpeta_resumen.mkdir(parents=True, exist_ok=True)
    ruta_csv = carpeta_resumen / f"resumen_{CLAVE_ALGORITMO}_{datetime.now():%Y%m%d_%H%M%S}.csv"

    with open(ruta_csv, "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS, extrasaction="ignore")
        escritor.writeheader()
        for n, h in combinaciones:
            for id_ in args.ids:
                inst = generar_instancia(n, id_, h, args.ua, args.la, args.ub, args.lb)
                print(f"\n=== {inst.resumen()}")
                sol = resolver(inst, args.tiempo, args.gap, args.hilos,
                               verbose=not args.silencioso,
                               explicitacion=args.explicitacion,
                               latencia=args.latencia)
                parametros = {"explicitacion": args.explicitacion, "latencia": args.latencia,
                              "limite_tiempo": args.tiempo, "gap": args.gap}
                guardar_salida(construir_salida(inst, sol, CLAVE_ALGORITMO,
                                                NOMBRE_ALGORITMO, parametros),
                               args.salida)
                fila = dict(sol)
                fila["ruta"] = "-".join(map(str, sol.get("ruta", [])))
                fila["politica"] = "".join(str(v) for v in sol.get("politica", {}).values())
                escritor.writerow(fila)
                archivo.flush()
                print(f"--> {sol['estado']}  obj={sol.get('objetivo')}  "
                      f"ruta={fila['ruta']}  s={fila['politica']}  "
                      f"{sol['segundos']:.2f}s")
    print(f"\nResumen guardado en {ruta_csv}")


if __name__ == "__main__":
    main()
