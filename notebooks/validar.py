"""Validación de los datos y del modelo.

1. Lectura de datos: con la enumeración exhaustiva y el objetivo (31) de
   Battarra et al. (2010) se reproducen, para |Vc| = 5, z_R de la Tabla 1
   (h = 0) y z* de la Política 3 en las Tablas 2, 3 y 4 (h = 0.1, 0.5, 1).
2. Modelo: el óptimo de Gurobi para (1)-(19) debe coincidir con la
   enumeración exhaustiva del TRPPD-H3, con y sin (20)-(29).

Uso: python validar.py [--n 5 6] [--ids 1 2 3] [--sin-battarra]
"""

import argparse

from enumeracion import enumerar, evaluar
from instancias_vigo import IDS, VALORES_H, generar_instancia
from modelo_trppdh3 import resolver

# Battarra et al. (2010), |Vc| = 5, ids 1..10
Z_R_TABLA1 = [295, 260, 279, 252, 196, 176, 233, 191, 276, 187]
Z_POLITICA3 = {
    0.1: [296.5, 261.5, 279.8, 252.7, 197.3, 178.6, 235.2, 191.6, 277.3, 189.0],
    0.5: [302.5, 267.5, 283.0, 255.5, 202.5, 189.0, 244.0, 194.0, 282.5, 196.0],
    1.0: [310, 275, 287, 259, 209, 201, 255, 197, 289, 202],
}


def validar_battarra():
    print("1) Datos vs. Battarra et al. (2010), |Vc| = 5")
    errores = 0
    for k, id_ in enumerate(IDS):
        valores = [enumerar(generar_instancia(5, id_, 0.0), "tsppd_h3")["tsppd_h3"]]
        esperados = [Z_R_TABLA1[k]]
        for h in VALORES_H:
            valores.append(enumerar(generar_instancia(5, id_, h), "tsppd_h3")["tsppd_h3"])
            esperados.append(Z_POLITICA3[h][k])
        ok = all(abs(v - e) < 0.051 for v, e in zip(valores, esperados))
        errores += not ok
        print(f"  id {id_:2d}: obtenido {[round(v, 1) for v in valores]}  "
              f"artículo {esperados}  {'OK' if ok else 'ERROR'}")
    return errores


def validar_modelo(tamanos, ids):
    print("\n2) Gurobi (1)-(19) vs. enumeración exhaustiva del TRPPD-H3")
    errores = 0
    variantes = [(False, False), (True, False), (False, True), (True, True)]
    for n in tamanos:
        for h in VALORES_H:
            for id_ in ids:
                inst = generar_instancia(n, id_, h)
                ref = enumerar(inst, "trp")
                objetivos = []
                for explicitacion, latencia in variantes:
                    sol = resolver(inst, verbose=False, explicitacion=explicitacion,
                                   latencia=latencia)
                    objetivos.append(sol["objetivo"])
                    if not explicitacion and not latencia:
                        base = sol
                # La ruta y las políticas de Gurobi, evaluadas paso a paso,
                # deben dar el mismo valor que reporta el modelo.
                rec = evaluar(inst, base["ruta"][1:-1], base["politica"])
                ok = (all(abs(o - ref["trp"]) < 1e-4 for o in objetivos)
                      and rec is not None and abs(rec["trp"] - base["objetivo"]) < 1e-4)
                errores += not ok
                print(f"  n={n} h={h:<3g} id={id_:2d}: enumeración {ref['trp']:9.2f}  "
                      f"Gurobi {objetivos[0]:9.2f} (+20-23 {objetivos[1]:.2f}, "
                      f"+24-29 {objetivos[2]:.2f}, ambas {objetivos[3]:.2f})  "
                      f"{base['segundos']:.2f}s  {'OK' if ok else 'ERROR'}")
    return errores


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, nargs="+", default=[5, 6])
    ap.add_argument("--ids", type=int, nargs="+", default=list(IDS))
    ap.add_argument("--sin-battarra", action="store_true")
    args = ap.parse_args()
    errores = 0 if args.sin_battarra else validar_battarra()
    errores += validar_modelo(args.n, args.ids)
    print(f"\n{'Todo coincide' if errores == 0 else f'{errores} casos con diferencias'}")
