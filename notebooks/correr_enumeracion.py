"""Resuelve instancias TRPPD-H3 pequeñas (n <= 7) por enumeración exhaustiva.

Sirve además como plantilla para conectar un algoritmo nuevo al visualizador:
basta con producir la ruta y el vector s y pasarlos a construir_salida, que
completa los instantes con la secuencia de la Tabla 3 y escribe
Outputs/<clave>/<instancia>.json.

    python correr_enumeracion.py --n 5 --ids 1 2 3 --h 0.1 0.5 1
"""

import argparse
import time

from enumeracion import enumerar
from instancias_vigo import IDS, VALORES_H, generar_instancia
from salidas import CARPETA_OUTPUTS, construir_salida, guardar_salida

CLAVE_ALGORITMO = "enumeracion"
NOMBRE_ALGORITMO = "Enumeración exhaustiva"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, nargs="+", default=[5])
    ap.add_argument("--ids", type=int, nargs="+", default=list(IDS))
    ap.add_argument("--h", type=float, nargs="+", default=list(VALORES_H))
    ap.add_argument("--salida", default=CARPETA_OUTPUTS)
    args = ap.parse_args(argv)

    for n in args.n:
        if n > 7:
            raise SystemExit("La enumeración exhaustiva solo es razonable para n <= 7")
        for h in args.h:
            for id_ in args.ids:
                inst = generar_instancia(n, id_, h)
                inicio = time.perf_counter()
                mejor = enumerar(inst, "trp")
                sol = {"estado": "OPTIMAL", "ruta": mejor["ruta"], "politica": mejor["s"],
                       "segundos": round(time.perf_counter() - inicio, 4)}
                archivo = guardar_salida(
                    construir_salida(inst, sol, CLAVE_ALGORITMO, NOMBRE_ALGORITMO),
                    args.salida)
                print(f"{inst.nombre}: obj={mejor['trp']:.2f} ruta={mejor['ruta']} "
                      f"s={list(mejor['s'].values())} -> {archivo.name}")


if __name__ == "__main__":
    main()
