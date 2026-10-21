"""Lectura de las instancias de e_vigo y adaptación al TRPPD-H3.

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
"""

from dataclasses import dataclass, field
from pathlib import Path

CARPETA_DATOS = Path(__file__).resolve().parent.parent / "e_vigo"
SEPARADOR = "---------------------"

# Configuración del banco de pruebas de Battarra et al. (2010)
N_BASE = 50
TAMANOS = (5, 10, 15, 20, 25)
IDS = tuple(range(1, 11))
VALORES_H = (0.1, 0.5, 1.0)


def _leer_bloques(ruta):
    texto = Path(ruta).read_text()
    return [b.split() for b in texto.split(SEPARADOR) if b.strip()]


def leer_demandas_originales(n_base=N_BASE, id_=1, clase_beta="0."):
    """Entregas d_i y recogidas p_i (i = 1..n_base) de edati.dat.

    Las recogidas son iguales en las clases beta 0, 0.05, 0.1 y 0.2; con
    beta = 0 las dos filas coinciden.
    """
    for b in _leer_bloques(CARPETA_DATOS / "edati.dat"):
        if b[0] == clase_beta and int(b[1]) == n_base and int(b[2]) == id_:
            valores = [int(float(v)) for v in b[4:]]
            return valores[:n_base], valores[n_base:2 * n_base]
    raise ValueError(f"No existe la instancia beta={clase_beta} n={n_base} id={id_}")


def leer_costos_originales(n_base=N_BASE, id_=1):
    """Matriz (n_base+1)x(n_base+1) de ecosti.dat; la diagonal queda en 0."""
    for b in _leer_bloques(CARPETA_DATOS / "ecosti.dat"):
        if int(b[1]) == n_base and int(b[2]) == id_:
            m = n_base + 1
            valores = [float(v) for v in b[4:]]
            if len(valores) != m * m:
                raise ValueError(f"Matriz incompleta para n={n_base} id={id_}")
            return [[0.0 if i == j else valores[i * m + j] for j in range(m)]
                    for i in range(m)]
    raise ValueError(f"No existe la matriz n={n_base} id={id_}")


@dataclass
class Instancia:
    """Datos de la Tabla 1 de la formulación. Los índices van de 0 a n,
    con 0 el depósito (alpha[0] = beta[0] = 0)."""

    nombre: str
    n: int
    c: list
    alpha: list
    beta: list
    Q: float
    ua: float
    la: float
    ub: float
    lb: float
    h: float = None
    id_: int = None
    p_original: list = field(default=None, repr=False)

    @property
    def V(self):
        return range(self.n + 1)

    @property
    def Vc(self):
        return range(1, self.n + 1)

    @property
    def A(self):
        return [(i, j) for i in self.V for j in self.V if i != j]

    @property
    def ha(self):
        return self.ua + self.la

    @property
    def hb(self):
        return self.ub + self.lb

    @property
    def suma_alpha(self):
        return sum(self.alpha)

    @property
    def suma_beta(self):
        return sum(self.beta)

    @property
    def c_max(self):
        return max(self.c[i][j] for i, j in self.A)

    @property
    def U(self):
        """Cota superior de los instantes de servicio (Tabla 1)."""
        return (self.n * self.c_max
                + (self.ua + self.n * self.ha) * self.suma_alpha
                + (self.lb + self.n * self.hb) * self.suma_beta)

    @property
    def M(self):
        return self.U + self.c_max

    def resumen(self):
        return (f"{self.nombre}: n={self.n}, Q={self.Q:g}, "
                f"sum alpha={self.suma_alpha}, sum beta={self.suma_beta}, "
                f"ua={self.ua:g}, la={self.la:g}, ub={self.ub:g}, lb={self.lb:g}, "
                f"U={self.U:g}, M={self.M:g}")


def regla_79(p):
    """Demandas (alpha, beta) de los clientes 1..n según la regla (79)."""
    alpha, beta = [0], [0]
    for i, p_i in enumerate(p, start=1):
        p_esc = max(1, p_i % 20)
        b = (p_esc * (i % 5)) // 5
        alpha.append(p_esc - b)
        beta.append(b)
    return alpha, beta


def generar_instancia(n, id_, h, ua=None, la=None, ub=None, lb=None, n_base=N_BASE):
    """Instancia TRPPD-H3 con los primeros n clientes de la instancia id_.

    Por defecto ua = la = ub = lb = h/2, que recupera h_a = h_b = h de
    Battarra et al. (2010). Cualquiera de los cuatro tiempos puede fijarse
    por separado para probar tiempos de carga y descarga distintos.
    """
    if not 1 <= n <= n_base:
        raise ValueError(f"n debe estar entre 1 y {n_base}")
    _, p = leer_demandas_originales(n_base, id_)
    p = p[:n]
    costos = leer_costos_originales(n_base, id_)
    c = [fila[:n + 1] for fila in costos[:n + 1]]
    alpha, beta = regla_79(p)
    mitad = h / 2
    tiempos = [mitad if t is None else t for t in (ua, la, ub, lb)]
    return Instancia(
        nombre=f"vigo_n{n}_id{id_}_h{h:g}",
        n=n,
        c=c,
        alpha=alpha,
        beta=beta,
        Q=max(sum(alpha), sum(beta)),
        ua=tiempos[0], la=tiempos[1], ub=tiempos[2], lb=tiempos[3],
        h=h,
        id_=id_,
        p_original=p,
    )


if __name__ == "__main__":
    for n in TAMANOS:
        inst = generar_instancia(n, 1, 0.1)
        print(inst.resumen())
        print("  alpha:", inst.alpha[1:])
        print("  beta: ", inst.beta[1:])
