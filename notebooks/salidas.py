"""Salidas estandarizadas para el visualizador web (carpeta Outputs).

Cada solución, venga del modelo de Gurobi o de un algoritmo futuro, se guarda
como un JSON con formato ``trppdh3-salida/1`` en

    Outputs/<algoritmo>/<instancia>.json

con tres bloques: ``algoritmo`` (quién la generó), ``instancia`` (datos de la
Tabla 1, la matriz c y coordenadas para dibujar el mapa) y ``solucion`` (ruta,
políticas, instantes T, D, F y cargas por arco). Un algoritmo nuevo solo debe
entregar la ruta y el vector s; el resto se completa evaluando la secuencia de
operaciones de la Tabla 3 con ``enumeracion.evaluar``.

Las instancias de e_vigo traen solo la matriz de costos. Como son euclidianas,
las coordenadas se recuperan con escalamiento multidimensional clásico sobre
la matriz de 50 clientes, de modo que el mapa de una misma id es igual para
cualquier n (el error medio en las distancias es de 0,2 unidades, por el
redondeo de los costos).
"""

import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import numpy as np

from enumeracion import evaluar
from instancias_vigo import N_BASE, leer_costos_originales

CARPETA_OUTPUTS = Path(__file__).resolve().parent.parent / "Outputs"
FORMATO = "trppdh3-salida/1"
TOL = 1e-4

CLAVES_SOLUCION = ("estado", "objetivo", "cota", "gap", "segundos", "nodos", "ruta",
                   "politica", "T", "D", "F", "q", "cargas", "viaje",
                   "manipulacion_adicional", "regreso")


def _num(v):
    """Entero si el valor no tiene parte decimal; así el JSON queda más corto."""
    v = float(v)
    return int(v) if v.is_integer() else round(v, 6)


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
    return x


@lru_cache(maxsize=None)
def _coordenadas_vigo(id_):
    return coordenadas_mds(leer_costos_originales(N_BASE, id_))


def coordenadas(inst):
    if inst.id_ is not None:
        x = _coordenadas_vigo(inst.id_)[:inst.n + 1]
    else:
        x = coordenadas_mds(inst.c)
    return [[round(float(a), 2), round(float(b), 2)] for a, b in x]


def datos_instancia(inst):
    return {
        "nombre": inst.nombre,
        "origen": "e_vigo (Gendreau, Laporte y Vigo, 1999) con la regla (79) de "
                  "Battarra et al. (2010)",
        "n": inst.n,
        "id": inst.id_,
        "h": inst.h,
        "Q": _num(inst.Q),
        "ua": inst.ua, "la": inst.la, "ub": inst.ub, "lb": inst.lb,
        "alpha": list(inst.alpha),
        "beta": list(inst.beta),
        "c": [[_num(v) for v in fila] for fila in inst.c],
        "coords": coordenadas(inst),
    }


def construir_salida(inst, sol, clave, nombre=None, parametros=None):
    """Arma el diccionario ``trppdh3-salida/1``.

    sol debe tener al menos ``ruta`` (con o sin el depósito en los extremos) y
    ``politica`` ({cliente: 1 si Política 1, 0 si Política 2}). Los instantes,
    el objetivo y los términos de costo que falten se calculan con
    ``evaluar``; si sol ya los trae, se comprueba que coincidan.
    """
    solucion = {k: sol[k] for k in CLAVES_SOLUCION if k in sol}
    if "ruta" in solucion:
        clientes = [i for i in solucion["ruta"] if i != 0]
        politica = {int(i): int(v) for i, v in solucion["politica"].items()}
        ev = evaluar(inst, clientes, politica)
        if ev is None:
            raise ValueError(f"{inst.nombre}: la carga supera Q en algún arco")
        solucion["ruta"] = [0] + clientes + [0]
        solucion["politica"] = {i: politica[i] for i in clientes}
        solucion.setdefault("objetivo", ev["trp"])
        for k in ("T", "D", "F"):
            solucion.setdefault(k, {i: round(ev[k][i], 6) for i in clientes})
        for k in ("viaje", "manipulacion_adicional", "regreso"):
            solucion.setdefault(k, round(ev[k], 6))
        if abs(ev["trp"] - solucion["objetivo"]) > TOL:
            print(f"AVISO {inst.nombre}: objetivo reportado {solucion['objetivo']} "
                  f"y evaluado {ev['trp']} no coinciden")
    return {
        "formato": FORMATO,
        "generado": datetime.now().isoformat(timespec="seconds"),
        "algoritmo": {"clave": clave, "nombre": nombre or clave,
                      "parametros": parametros or {}},
        "instancia": datos_instancia(inst),
        "solucion": solucion,
    }


def guardar_salida(salida, carpeta=CARPETA_OUTPUTS):
    """Escribe Outputs/<algoritmo>/<instancia>.json y devuelve la ruta."""
    destino = Path(carpeta) / salida["algoritmo"]["clave"]
    destino.mkdir(parents=True, exist_ok=True)
    archivo = destino / f"{salida['instancia']['nombre']}.json"
    archivo.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
    return archivo
