// Heurísticas de Erdoğan, Battarra, Laporte y Vigo (2012) adaptadas al TRPPD-H3.
//
// Erdoğan et al. minimizan viaje + manipulación (TSPPD-H). Aquí el objetivo es Σ D_i,
// así que cada operación pesa por el número de clientes que retrasa. En la posición k
// de la ruta (k = 1..n):
//   antes de completar la entrega (c_ij, u_b·z, u_a·α_i)   pesa  n − k + 1
//   después (ℓ_b·(z + β_i), q_i)                           pesa  n − k
// Con la ruta fija, el viaje y las operaciones obligatorias no dependen de s, y la
// manipulación adicional solo depende de las recogidas junto a la puerta (z) desde la
// última Política 2. Por eso se conserva la estructura del DP de la Sección 2.1:
//
//   evaluarExacto      Algoritmo 2.1 + DP (1)-(2) con los pesos de latencia, O(n²)
//   evaluarHeuristico  umbral de recogidas a bordo de la Sección 2.2 (umbral 2), O(n)
//   dosFases           TSP + reubicación del depósito evaluada con el Algoritmo 2.1
//   ils, its           Algoritmos 4.2 y 4.3 con vecindarios relocate y 2-opt (Sección 3)
//
// Las rutas son arreglos con los n clientes en orden de visita, sin el depósito.

const EPS = 1e-9;

/** Arreglos por nodo (índice 0 = depósito) a partir de una instancia de Instancias/. */
export function preparar(instancia) {
  const n = Number(instancia.n);
  const nodos = n + 1;
  const vector = (v) => Float64Array.from(Array.isArray(v) ? v : new Array(nodos).fill(v), Number);
  const alpha = vector(instancia.alpha);
  const beta = vector(instancia.beta);
  alpha[0] = 0;
  beta[0] = 0;
  const [ua, la, ub, lb] = ['ua', 'la', 'ub', 'lb'].map((p) => vector(instancia[p]));
  const suma = (v) => v.reduce((s, x) => s + x, 0);
  return {
    n,
    c: instancia.c.map((fila) => Float64Array.from(fila, Number)),
    alpha, beta, ua, la, ub, lb,
    ha: ua.map((u, i) => u + la[i]),
    hb: ub.map((u, i) => u + lb[i]),
    Q: Number(instancia.Q ?? Math.max(suma(alpha), suma(beta))),
    sumaAlpha: suma(alpha),
    // Memoria de trabajo de las evaluaciones, para no reservarla en cada vecino
    f: new Float64Array(nodos), sig: new Int32Array(nodos), sufA: new Float64Array(nodos),
    sufB: new Float64Array(nodos), sufHa: new Float64Array(nodos), sufHb: new Float64Array(nodos),
  };
}

/** La carga a bordo (y + w + z) no depende de las políticas: solo de la ruta. */
export function factible(P, ruta) {
  let carga = P.sumaAlpha;
  if (carga > P.Q + EPS) return false;
  for (const i of ruta) {
    carga += P.beta[i] - P.alpha[i];
    if (carga > P.Q + EPS) return false;
  }
  return true;
}

/** Viaje y operaciones obligatorias con sus pesos; Infinity si la ruta supera Q. */
function parteFija(P, ruta) {
  if (!factible(P, ruta)) return Infinity;
  const { n, c, alpha, beta, ua, lb } = P;
  let fijo = 0;
  let previo = 0;
  for (let k = 0; k < n; k++) {
    const i = ruta[k];
    fijo += (n - k) * (c[previo][i] + ua[i] * alpha[i]) + (n - k - 1) * lb[i] * beta[i];
    previo = i;
  }
  return fijo;
}

/** Política de cada cliente ({cliente: s}) a partir de las posiciones con Política 2. */
function politicaDe(ruta, conP2) {
  return Object.fromEntries(Array.from(ruta, (i, k) => [i, conP2[k] ? 0 : 1]));
}

/**
 * Algoritmo 2.1 + DP adaptados a Σ D_i. f(i) es el costo mínimo de manipulación de las
 * posiciones i+1..n si en i se aplicó la Política 2 (i = 0: depósito); p_ij es el costo de
 * aplicar la Política 1 en i+1..j−1 y la Política 2 en j. En la posición j (peso W = n − j + 1):
 *   retirar y recargar las z recogidas junto a la puerta:  (u_b·W + ℓ_b·(W − 1))·z   con P1 o P2
 *   Política 2: retirar y recargar las entregas que siguen: h_a·y·(W − 1)
 * Con j = n la Política 2 no cuesta (W − 1 = 0), así que p_in es "Política 1 hasta el final".
 * Devuelve Σ D_i, o {costo, politica} con conPolitica.
 */
export function evaluarExacto(P, ruta, conPolitica = false) {
  const fijo = parteFija(P, ruta);
  if (fijo === Infinity) return conPolitica ? { costo: Infinity, politica: null } : Infinity;
  const { n, alpha, beta, ub, lb, ha, f, sig, sufA } = P;
  sufA[n] = 0;
  for (let k = n - 1; k >= 0; k--) sufA[k] = sufA[k + 1] + alpha[ruta[k]];
  f[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    let z = 0;
    let theta = 0;
    let mejor = Infinity;
    let arg = n;
    for (let j = i + 1; j <= n; j++) {
      const cl = ruta[j - 1];
      const W = n - j + 1;
      const base = (ub[cl] * W + lb[cl] * (W - 1)) * z;
      // Sin recogidas que mover, la Política 2 equivale a la 1 (Erdoğan: p_ij = θ)
      const p = theta + base + (z + beta[cl] > 0 ? ha[cl] * sufA[j] * (W - 1) : 0);
      if (p + f[j] < mejor) {
        mejor = p + f[j];
        arg = j;
      }
      theta += base;
      z += beta[cl];
    }
    f[i] = mejor;
    sig[i] = arg;
  }
  const costo = fijo + f[0];
  if (!conPolitica) return costo;

  const conP2 = new Array(n).fill(false);
  for (let i = 0; i < n;) {
    const j = sig[i];
    let z = 0;
    for (let k = i; k < j - 1; k++) z += beta[ruta[k]];
    if (j < n && z + beta[ruta[j - 1]] > 0) conP2[j - 1] = true;
    i = j;
  }
  return { costo, politica: politicaDe(ruta, conP2) };
}

/**
 * Largo del primer tramo con Política 1, k*_1, en el caso especial de la Sección 2.2 (N clientes
 * con ᾱ entregas y β̄ recogidas), con las fórmulas (13) y (14) y r = h_b·β̄ / (h_a·ᾱ):
 *   p* = ⌊(1 − 2r + √((2r − 1)² + 8·N·r)) / 2⌋        k*_1 = ((p* − 1)/2) / r + N / p*
 * Si p* < 2 no conviene la Política 2 (Infinity).
 *
 * Se conservan las fórmulas del TSPPD-H porque, en el caso especial del TRPPD-H3, recalcular
 * k*_1 después de cada Política 2 con los clientes que faltan queda en promedio a menos de 1 %
 * de la manipulación adicional óptima del DP exacto con N > 10, y a menudo la iguala (p. ej.
 * N = 40, γ = 1/r = 1: Política 2 en 9, 17, 24, 30, 34, 37 y 39). Una versión derivada con los
 * pesos de latencia en la relajación continua se desvió más en las instancias de e_vigo.
 */
export function primerTramo(N, gamma) {
  if (N < 2) return Infinity;
  if (gamma < 1e-12) return 1;
  const r = 1 / gamma;
  const p = Math.floor((1 - 2 * r + Math.sqrt((2 * r - 1) ** 2 + 8 * N * r)) / 2);
  if (p < 2) return Infinity;
  return Math.max(1, (gamma * (p - 1)) / 2 + N / p);
}

/**
 * Evaluación heurística en O(n), como la de Erdoğan et al. con el umbral 2 (recogidas a bordo):
 * al salir del depósito y después de cada Política 2 se calcula k*_1 con los promedios de los
 * clientes que faltan, y se aplica la Política 2 en el primer cliente en que las recogidas junto
 * a la puerta (las que había más las suyas) alcanzan k*_1·β̄. El costo de esas decisiones se
 * mide con los pesos de latencia, igual que en evaluarExacto.
 */
export function evaluarHeuristico(P, ruta, conPolitica = false) {
  const fijo = parteFija(P, ruta);
  if (fijo === Infinity) return conPolitica ? { costo: Infinity, politica: null } : Infinity;
  const { n, alpha, beta, ub, lb, ha, hb, sufA, sufB, sufHa, sufHb } = P;
  sufA[n] = sufB[n] = sufHa[n] = sufHb[n] = 0;
  for (let k = n - 1; k >= 0; k--) {
    const i = ruta[k];
    sufA[k] = sufA[k + 1] + alpha[i];
    sufB[k] = sufB[k + 1] + beta[i];
    sufHa[k] = sufHa[k + 1] + ha[i];
    sufHb[k] = sufHb[k + 1] + hb[i];
  }
  // Umbral para los clientes de las posiciones i+1..n (i = posición de la última Política 2)
  const umbral = (i) => {
    const N = n - i;
    if (sufB[i] <= 0 || sufHb[i] <= 0) return Infinity;
    return primerTramo(N, (sufHa[i] * sufA[i]) / (sufHb[i] * sufB[i])) * (sufB[i] / N);
  };

  const conP2 = conPolitica ? new Array(n).fill(false) : null;
  let costo = 0;
  let z = 0;
  let tope = umbral(0);
  for (let j = 1; j <= n; j++) {
    const cl = ruta[j - 1];
    const W = n - j + 1;
    costo += (ub[cl] * W + lb[cl] * (W - 1)) * z;
    if (j < n && z + beta[cl] > 0 && z + beta[cl] >= tope - EPS) {
      costo += ha[cl] * sufA[j] * (W - 1);
      if (conP2) conP2[j - 1] = true;
      z = 0;
      tope = umbral(j);
    } else z += beta[cl];
  }
  return conPolitica ? { costo: fijo + costo, politica: politicaDe(ruta, conP2) } : fijo + costo;
}

// --- Fase 1: TSP -----------------------------------------------------------------
// Erdoğan et al. usan Lin-Kernighan (Concorde). Aquí: vecino más cercano desde cada nodo,
// mejorado con 2-opt y Or-opt hasta un óptimo local. Sirve para c asimétrica.

const costoCiclo = (c, t) => t.reduce((s, x, k) => s + c[x][t[(k + 1) % t.length]], 0);

function vecinoMasCercano(c, inicio) {
  const m = c.length;
  const visitado = new Uint8Array(m);
  const tour = [inicio];
  visitado[inicio] = 1;
  while (tour.length < m) {
    const u = tour[tour.length - 1];
    let mejor = -1;
    for (let v = 0; v < m; v++) if (!visitado[v] && (mejor < 0 || c[u][v] < c[u][mejor])) mejor = v;
    tour.push(mejor);
    visitado[mejor] = 1;
  }
  return tour;
}

/** 2-opt y Or-opt (tramos de 1 a 3 nodos, en ambos sentidos) con primera mejora. */
function mejorarTSP(c, tour) {
  const m = tour.length;
  let t = tour.slice();
  let mejora = true;
  while (mejora) {
    mejora = false;
    // 2-opt: invertir t[i..j]. En c asimétrica se suma el cambio de sentido de los arcos internos.
    for (let i = 1; i < m - 1 && !mejora; i++) {
      let invertidos = 0;
      for (let j = i + 1; j < m; j++) {
        invertidos += c[t[j]][t[j - 1]] - c[t[j - 1]][t[j]];
        const a = t[i - 1];
        const b = t[(j + 1) % m];
        const delta = c[a][t[j]] + c[t[i]][b] - c[a][t[i]] - c[t[j]][b] + invertidos;
        if (delta < -EPS) {
          t = [...t.slice(0, i), ...t.slice(i, j + 1).reverse(), ...t.slice(j + 1)];
          mejora = true;
          break;
        }
      }
    }
    if (mejora) continue;
    // Or-opt: mover t[i..i+L−1] entre t[p] y t[p+1], con o sin invertirlo
    for (let L = 1; L <= 3 && !mejora; L++) {
      for (let i = 1; i + L - 1 < m && !mejora; i++) {
        const tramo = t.slice(i, i + L);
        const resto = [...t.slice(0, i), ...t.slice(i + L)];
        const base = costoCiclo(c, resto);
        const actual = costoCiclo(c, t);
        for (let p = 0; p < resto.length && !mejora; p++) {
          if (p === i - 1) continue;
          const sig = resto[(p + 1) % resto.length];
          for (const orden of [tramo, [...tramo].reverse()]) {
            let interno = 0;
            for (let k = 0; k + 1 < L; k++) interno += c[orden[k]][orden[k + 1]];
            const nuevo = base - c[resto[p]][sig] + c[resto[p]][orden[0]] + interno + c[orden[L - 1]][sig];
            if (nuevo < actual - EPS) {
              t = [...resto.slice(0, p + 1), ...orden, ...resto.slice(p + 1)];
              mejora = true;
              break;
            }
          }
        }
      }
    }
  }
  return t;
}

/** Ciclo TSP por V (depósito incluido), rotado para empezar en 0. */
export function tsp(c) {
  let mejor = null;
  let costo = Infinity;
  for (let inicio = 0; inicio < c.length; inicio++) {
    const t = mejorarTSP(c, vecinoMasCercano(c, inicio));
    const k = costoCiclo(c, t);
    if (k < costo - EPS) {
      costo = k;
      const cero = t.indexOf(0);
      mejor = [...t.slice(cero), ...t.slice(0, cero)];
    }
  }
  return { tour: mejor, costo };
}

// --- Fase 2: reubicación del depósito (Mosheiov) ------------------------------------

/**
 * Heurística de dos fases: el ciclo TSP sin el depósito es una secuencia circular de clientes;
 * reubicar el depósito equivale a empezar la ruta en otro cliente. Para cada sentido (el del TSP
 * y el inverso) se evalúan las n rotaciones factibles con el Algoritmo 2.1 adaptado y se guarda
 * la mejor.
 */
export function dosFases(P) {
  const { tour, costo: costoTSP } = tsp(P.c);
  const circulo = tour.slice(1);
  const direcciones = [circulo, [...circulo].reverse()].map((sec, d) => {
    let mejor = { ruta: null, costo: Infinity, rotacion: null };
    let factibles = 0;
    for (let r = 0; r < sec.length; r++) {
      const ruta = Int32Array.from([...sec.slice(r), ...sec.slice(0, r)]);
      const costo = evaluarExacto(P, ruta);
      if (costo === Infinity) continue;
      factibles++;
      if (costo < mejor.costo - EPS) mejor = { ruta, costo, rotacion: r };
    }
    return { direccion: d === 0 ? 'tsp' : 'inversa', ...mejor, factibles };
  });
  return { tsp: { tour, costo: costoTSP }, direcciones };
}

// --- Vecindarios y búsqueda --------------------------------------------------------

/** Generador de números en [0, 1) con semilla (mulberry32), para repetir las corridas. */
export function crearAzar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function semillaDe(texto) {
  let h = 2166136261;
  for (const ch of texto) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Relocate: el cliente de la posición i pasa a la posición p. */
function relocate(ruta, i, p, destino) {
  const x = ruta[i];
  let k = 0;
  for (let m = 0; m < ruta.length; m++) {
    if (m === i) continue;
    if (k === p) destino[k++] = x;
    destino[k++] = ruta[m];
  }
  if (k === p) destino[k] = x;
  return destino;
}

/** 2-opt: invierte las posiciones i..j (i < j); quita los arcos que entran a i y salen de j. */
function dosOpt(ruta, i, j, destino) {
  for (let m = 0; m < ruta.length; m++) destino[m] = m < i || m > j ? ruta[m] : ruta[i + j - m];
  return destino;
}

/**
 * Contexto de una corrida: la evaluación de los vecinos (exacta o heurística) y el conteo de
 * evaluaciones. Con la heurística, el mejor vecino se vuelve a evaluar con el DP exacto
 * (Sección 4, tercer aspecto común), así que los costos que se comparan son siempre exactos.
 */
function crearBusqueda(P, evaluacion, azar) {
  const cuenta = { exactas: 0, heuristicas: 0 };
  const exacto = (r) => {
    cuenta.exactas++;
    return evaluarExacto(P, r);
  };
  const vecino = evaluacion === 'exacta' ? exacto : (r) => {
    cuenta.heuristicas++;
    return evaluarHeuristico(P, r);
  };
  return { P, n: P.n, evaluacion, azar, cuenta, exacto, vecino, buffer: new Int32Array(P.n) };
}

/**
 * Recorre relocate y 2-opt. visitar(tipo, i, j, valor, ruta) recibe cada vecino factible;
 * la ruta es un buffer que se reutiliza.
 */
function explorar(B, ruta, visitar) {
  const { n, buffer } = B;
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < n; p++) {
      if (p === i) continue;
      const valor = B.vecino(relocate(ruta, i, p, buffer));
      if (valor < Infinity) visitar('relocate', i, p, valor, buffer);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const valor = B.vecino(dosOpt(ruta, i, j, buffer));
      if (valor < Infinity) visitar('2opt', i, j, valor, buffer);
    }
  }
}

/** Búsqueda local con mejor mejora en relocate ∪ 2-opt ("Perform Best Move" del Algoritmo 4.2). */
function busquedaLocal(B, ruta, costo) {
  for (;;) {
    let mejor = null;
    let valorMejor = Infinity;
    explorar(B, ruta, (_t, _i, _j, valor, r) => {
      if (valor < valorMejor - EPS) {
        valorMejor = valor;
        mejor = Int32Array.from(r);
      }
    });
    if (!mejor) return { ruta, costo };
    const exacto = B.evaluacion === 'exacta' ? valorMejor : B.exacto(mejor);
    if (exacto >= costo - EPS) return { ruta, costo };
    ruta = mejor;
    costo = exacto;
  }
}

/**
 * Algoritmo 4.1 (TS). En cada iteración se aplica el mejor relocate o 2-opt no tabú, aunque
 * empeore; un movimiento tabú se acepta si mejora la mejor solución (aspiración). La lista tabú
 * guarda el cliente reubicado (relocate) o el par de posiciones (2-opt) durante 0,5·n iteraciones.
 */
function tabu(B, ruta, costo, iteraciones) {
  const tenencia = Math.max(1, Math.floor(0.5 * B.n));
  const lista = [];
  const esTabu = new Set();
  let actual = ruta;
  let mejor = { ruta, costo };
  for (let it = 0; it < iteraciones; it++) {
    let elegido = null;
    let valorElegido = Infinity;
    explorar(B, actual, (tipo, i, j, valor, r) => {
      const clave = tipo === 'relocate' ? `r${actual[i]}` : `o${i},${j}`;
      if (esTabu.has(clave) && !(valor < mejor.costo - EPS)) return;
      if (valor < valorElegido - EPS) {
        valorElegido = valor;
        elegido = { clave, ruta: Int32Array.from(r) };
      }
    });
    if (!elegido) break;
    actual = elegido.ruta;
    const costoActual = B.evaluacion === 'exacta' ? valorElegido : B.exacto(actual);
    lista.push(elegido.clave);
    esTabu.add(elegido.clave);
    if (lista.length > tenencia) esTabu.delete(lista.shift());
    if (costoActual < mejor.costo - EPS) mejor = { ruta: actual, costo: costoActual };
  }
  return mejor;
}

/** N_rand movimientos al azar (Algoritmo 4.2): relocate si i = j, 2-opt si no. Solo factibles. */
function perturbar(B, ruta, veces) {
  const { n, azar, P } = B;
  const entero = (k) => Math.floor(azar() * k);
  let actual = ruta;
  for (let r = 0; r < veces; r++) {
    for (let intento = 0; intento < 100; intento++) {
      const i = entero(n);
      const j = entero(n);
      let candidata;
      if (i === j) {
        let p = entero(n - 1);
        if (p >= i) p++;
        candidata = relocate(actual, i, p, new Int32Array(n));
      } else candidata = dosOpt(actual, Math.min(i, j), Math.max(i, j), new Int32Array(n));
      if (factible(P, candidata)) {
        actual = candidata;
        break;
      }
    }
  }
  return actual;
}

/** Algoritmo 4.2 (ILS): perturbación de la mejor ruta y búsqueda local, N_iter veces. */
function ils(B, inicial, { iteraciones, aleatorios }) {
  let mejor = { ruta: inicial, costo: B.exacto(inicial) };
  const traza = [];
  for (let it = 0; it < iteraciones; it++) {
    const ruta = perturbar(B, mejor.ruta, aleatorios);
    const res = busquedaLocal(B, ruta, B.exacto(ruta));
    if (res.costo < mejor.costo - EPS) mejor = res;
    traza.push(mejor.costo);
  }
  return { ...mejor, traza };
}

/** Algoritmo 4.3 (ITS): como ILS, con TS de N*_iter iteraciones en vez de la búsqueda local. */
function its(B, inicial, { iteraciones, aleatorios }) {
  const internas = Math.floor(Math.sqrt(iteraciones));
  let mejor = { ruta: inicial, costo: B.exacto(inicial) };
  const traza = [];
  for (let it = 0; it < internas; it++) {
    const ruta = perturbar(B, mejor.ruta, aleatorios);
    const res = tabu(B, ruta, B.exacto(ruta), internas);
    if (res.costo < mejor.costo - EPS) mejor = res;
    traza.push(mejor.costo);
  }
  return { ...mejor, traza };
}

// --- Algoritmos -------------------------------------------------------------------

export const ALGORITMOS = {
  dos_fases: { nombre: '2 fases', metodo: null, evaluacion: 'exacta' },
  ils_heuristico: { nombre: 'ILS heurístico', metodo: 'ils', evaluacion: 'heuristica' },
  ils_exacto: { nombre: 'ILS exacto', metodo: 'ils', evaluacion: 'exacta' },
  its_heuristico: { nombre: 'ITS heurístico', metodo: 'its', evaluacion: 'heuristica' },
  its_exacto: { nombre: 'ITS exacto', metodo: 'its', evaluacion: 'exacta' },
};

/**
 * Corre un algoritmo sobre una instancia. Como en Erdoğan et al. (versión 2dir), la
 * metaheurística parte una vez de cada solución inicial (sentido del TSP e inverso), con N_iter
 * iteraciones en cada una, y se informa la mejor. El tiempo incluye la heurística de dos fases.
 */
export function resolver(instancia, clave, { iteraciones = 200, aleatorios = null, semilla = 1 } = {}) {
  const alg = ALGORITMOS[clave];
  if (!alg) throw new Error(`Algoritmo desconocido: ${clave}`);
  const inicio = performance.now();
  const P = preparar(instancia);
  const nRand = aleatorios ?? Math.max(1, Math.round(0.1 * P.n));
  const inicial = dosFases(P);
  const segundosInicial = (performance.now() - inicio) / 1000;
  const B = crearBusqueda(P, alg.evaluacion, crearAzar(semilla));

  const corridas = inicial.direcciones.filter((d) => d.ruta).map((d) => {
    if (!alg.metodo) return { direccion: d.direccion, inicial: d.costo, ruta: d.ruta, costo: d.costo, traza: [] };
    const res = (alg.metodo === 'ils' ? ils : its)(B, d.ruta, { iteraciones, aleatorios: nRand });
    return { direccion: d.direccion, inicial: d.costo, ...res };
  });
  if (!corridas.length) throw new Error('Ninguna rotación del ciclo TSP respeta la capacidad Q');
  const mejor = corridas.reduce((a, b) => (b.costo < a.costo - EPS ? b : a));
  const { costo, politica } = evaluarExacto(P, mejor.ruta, true);
  const segundos = (performance.now() - inicio) / 1000;

  return {
    clave,
    ruta: [0, ...mejor.ruta, 0],
    politica,
    objetivo: costo,
    segundos,
    segundosInicial,
    parametros: {
      evaluacion: alg.evaluacion,
      metodo: alg.metodo,
      direcciones: 2,
      iteraciones: alg.metodo === 'its' ? Math.floor(Math.sqrt(iteraciones)) : alg.metodo ? iteraciones : null,
      iteraciones_tabu: alg.metodo === 'its' ? Math.floor(Math.sqrt(iteraciones)) : null,
      tenencia_tabu: alg.metodo === 'its' ? Math.max(1, Math.floor(0.5 * P.n)) : null,
      movimientos_aleatorios: alg.metodo ? nRand : null,
      semilla: alg.metodo ? semilla : null,
    },
    tsp: { tour: inicial.tsp.tour, costo: inicial.tsp.costo },
    corridas: corridas.map((c) => ({
      direccion: c.direccion, inicial: c.inicial, final: c.costo, ruta: [0, ...c.ruta, 0], traza: c.traza,
    })),
    evaluaciones: { ...B.cuenta },
  };
}
