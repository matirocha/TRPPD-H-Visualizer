// Normalización de las salidas de Outputs y simulación de la ruta.
//
// La simulación reproduce, cliente a cliente, la secuencia de operaciones de
// la Tabla 3 de la formulación:
//
//   1. retirar las recogidas junto a la puerta      u_b · z
//   2. descargar las α_i unidades del cliente       u_a · α_i      -> D_i
//   3. (P2) retirar las entregas que siguen a bordo u_a · y
//   4. cargar recogidas retiradas y nuevas          ℓ_b · (z + β_i)
//   5. (P2) recargar las entregas                   ℓ_a · y        -> F_i
//
// Además de los instantes T, D y F, guarda el orden físico de la carga
// (patrón F, w, y, z, R de la Figura 1) para dibujar el camión.

export const PARAMETROS = ['ua', 'la', 'ub', 'lb'];

export const PARAMETRO_INFO = {
  ua: { nombre: 'Descargar a', detalle: 'tiempo de descargar una unidad de entrega' },
  la: { nombre: 'Cargar a', detalle: 'tiempo de cargar una unidad de entrega' },
  ub: { nombre: 'Descargar b', detalle: 'tiempo de descargar una unidad de recogida' },
  lb: { nombre: 'Cargar b', detalle: 'tiempo de cargar una unidad de recogida' },
};

export const OPERACIONES = {
  retirarPuerta: { paso: 1, param: 'ub', etiqueta: 'Retirar las recogidas junto a la puerta' },
  descargar: { paso: 2, param: 'ua', etiqueta: 'Descargar la entrega del cliente' },
  retirarEntregas: { paso: 3, param: 'ua', etiqueta: 'Retirar las entregas que siguen a bordo' },
  cargarRecogidas: { paso: 4, param: 'lb', etiqueta: 'Cargar las recogidas' },
  recargarEntregas: { paso: 5, param: 'la', etiqueta: 'Recargar las entregas' },
};

const TOL = 1e-4;

function errorDatos(mensaje) {
  const error = new Error(mensaje);
  error.name = 'ErrorDatos';
  return error;
}

function porNodo(valor, nodos, nombre) {
  if (Array.isArray(valor)) {
    if (valor.length !== nodos) throw errorDatos(`"${nombre}" debe tener ${nodos} valores`);
    return valor.map(Number);
  }
  if (valor == null || Number.isNaN(Number(valor))) throw errorDatos(`Falta el parámetro "${nombre}"`);
  return new Array(nodos).fill(Number(valor));
}

function diccionario(valor) {
  if (valor == null) return null;
  const mapa = new Map();
  if (Array.isArray(valor)) valor.forEach((v, i) => v != null && mapa.set(i, Number(v)));
  else for (const [k, v] of Object.entries(valor)) mapa.set(Number(k), Number(v));
  return mapa;
}

/**
 * Convierte el JSON trppdh3-salida/1 en una estructura con tipos fijos.
 * Acepta u_a, ℓ_a, u_b, ℓ_b escalares o por nodo, y la ruta con o sin el depósito.
 */
export function normalizar(datos, archivo = '') {
  if (!datos?.instancia) throw errorDatos('El archivo no tiene el bloque "instancia"');
  const fuente = datos.instancia;
  const s = datos.solucion ?? {};
  const n = Number(fuente.n);
  const nodos = n + 1;
  if (!Number.isInteger(n) || n < 1) throw errorDatos('"n" debe ser un entero positivo');

  const c = fuente.c?.map((fila) => fila.map(Number));
  if (!c || c.length !== nodos || c.some((fila) => fila.length !== nodos)) {
    throw errorDatos(`La matriz "c" debe ser de ${nodos}×${nodos}`);
  }
  const alpha = porNodo(fuente.alpha, nodos, 'alpha');
  const beta = porNodo(fuente.beta, nodos, 'beta');
  alpha[0] = 0;
  beta[0] = 0;

  const instancia = {
    nombre: fuente.nombre ?? archivo,
    origen: fuente.origen ?? null,
    n,
    id: fuente.id ?? null,
    h: fuente.h ?? null,
    Q: Number(fuente.Q ?? Math.max(alpha.reduce((a, b) => a + b, 0), beta.reduce((a, b) => a + b, 0))),
    alpha,
    beta,
    c,
    ua: porNodo(fuente.ua, nodos, 'ua'),
    la: porNodo(fuente.la, nodos, 'la'),
    ub: porNodo(fuente.ub, nodos, 'ub'),
    lb: porNodo(fuente.lb, nodos, 'lb'),
    coords: Array.isArray(fuente.coords) && fuente.coords.length === nodos
      ? fuente.coords.map(([x, y]) => [Number(x), Number(y)])
      : coordenadasMDS(c),
    coordsCalculadas: !(Array.isArray(fuente.coords) && fuente.coords.length === nodos),
  };
  instancia.parametrosUniformes = PARAMETROS.every((p) => instancia[p].slice(1).every((v) => v === instancia[p][1]));

  if (!Array.isArray(s.ruta) || s.ruta.length === 0) throw errorDatos('La solución no tiene "ruta"');
  const clientes = s.ruta.map(Number).filter((i) => i !== 0);
  const esperados = new Set(Array.from({ length: n }, (_, k) => k + 1));
  if (clientes.length !== n || clientes.some((i) => !esperados.delete(i))) {
    throw errorDatos('La ruta debe visitar exactamente una vez a cada cliente 1..n');
  }
  const politicas = diccionario(s.politica);
  if (!politicas || clientes.some((i) => !politicas.has(i))) {
    throw errorDatos('Falta la política s_i de algún cliente');
  }

  return {
    archivo,
    formato: datos.formato ?? null,
    generado: datos.generado ?? null,
    algoritmo: {
      clave: datos.algoritmo?.clave ?? archivo.split('/')[0],
      nombre: datos.algoritmo?.nombre ?? datos.algoritmo?.clave ?? 'Sin nombre',
      parametros: datos.algoritmo?.parametros ?? {},
    },
    instancia,
    solucion: {
      estado: s.estado ?? null,
      objetivo: s.objetivo ?? null,
      cota: s.cota ?? null,
      gap: s.gap ?? null,
      segundos: s.segundos ?? null,
      nodos: s.nodos ?? null,
      ruta: [0, ...clientes, 0],
      clientes,
      politica: new Map(clientes.map((i) => [i, politicas.get(i) >= 0.5 ? 1 : 0])),
      T: diccionario(s.T),
      D: diccionario(s.D),
      F: diccionario(s.F),
      q: diccionario(s.q),
      cargas: Array.isArray(s.cargas) ? s.cargas : null,
      viaje: s.viaje ?? null,
      manipulacionAdicional: s.manipulacion_adicional ?? null,
      regreso: s.regreso ?? null,
    },
  };
}

const unidades = (bloques) => bloques.reduce((suma, b) => suma + b.unidades, 0);

function resumenCarga(pila) {
  const carga = { w: 0, y: 0, z: 0 };
  for (const b of pila) carga[b.tipo] += b.unidades;
  carga.total = carga.w + carga.y + carga.z;
  return carga;
}

const copiar = (pila) => pila.map((b) => ({ ...b }));

/**
 * Recorre la ruta y devuelve paradas, arcos y totales.
 *
 * pila: bloques de carga desde el frente (F) hasta la puerta trasera (R), cada
 * uno {tipo: 'w' | 'y' | 'z', cliente, unidades}. Para 'y' el cliente es el
 * destino de la entrega; para 'w' y 'z', el cliente donde se recogió.
 */
export function simular(salida) {
  const I = salida.instancia;
  const S = salida.solucion;
  const { alpha, beta, c, Q } = I;
  const clientes = S.clientes;
  const avisos = [];

  // Las entregas se cargan en orden inverso a la ruta: el próximo cliente queda junto a la puerta.
  let pila = [];
  for (let k = clientes.length - 1; k >= 0; k--) {
    const j = clientes[k];
    if (alpha[j] > 0) pila.push({ tipo: 'y', cliente: j, unidades: alpha[j] });
  }
  const cargaInicial = resumenCarga(pila);
  if (cargaInicial.total > Q + TOL) avisos.push(`La carga inicial (${cargaInicial.total}) supera Q = ${Q}`);

  const paradas = [];
  const arcos = [];
  const acumulado = { viaje: 0, ua: 0, la: 0, ub: 0, lb: 0 };
  let reloj = 0;
  let previo = 0;
  let manipulacionAdicional = 0;

  for (const [indice, i] of clientes.entries()) {
    const cij = c[previo][i];
    arcos.push({
      k: indice,
      desde: previo,
      hasta: i,
      c: cij,
      inicio: reloj,
      fin: reloj + cij,
      carga: resumenCarga(pila),
      pila: copiar(pila),
      regreso: false,
    });

    const s = S.politica.get(i);
    const tasa = { ua: I.ua[i], la: I.la[i], ub: I.ub[i], lb: I.lb[i] };
    const T = reloj + cij;
    acumulado.viaje += cij;
    const llegada = { carga: resumenCarga(pila), pila: copiar(pila) };
    const ops = [];
    let t = T;
    let pilaAnterior = copiar(pila);
    // Se llama después de modificar la pila, con el estado ya resultante de la operación.
    const operar = (clave, unidadesOp, extra = {}) => {
      const info = OPERACIONES[clave];
      const duracion = tasa[info.param] * unidadesOp;
      ops.push({
        clave,
        paso: info.paso,
        param: info.param,
        etiqueta: extra.etiqueta ?? info.etiqueta,
        unidades: unidadesOp,
        tasa: tasa[info.param],
        inicio: t,
        fin: t + duracion,
        duracion,
        pilaAntes: pilaAnterior,
        pilaDespues: copiar(pila),
        ...extra,
      });
      pilaAnterior = copiar(pila);
      t += duracion;
      acumulado[info.param] += duracion;
      return ops[ops.length - 1];
    };

    // Paso 1: las recogidas junto a la puerta (bloques z del extremo trasero) bajan del camión.
    const retiradas = pila.filter((b) => b.tipo === 'z');
    const zEntrada = unidades(retiradas);
    pila = pila.filter((b) => b.tipo !== 'z');
    operar('retirarPuerta', zEntrada, { bloques: copiar(retiradas) });

    // Paso 2: la entrega del cliente queda en el extremo trasero del bloque a.
    const ultimo = pila[pila.length - 1];
    if (alpha[i] > 0 && !(ultimo?.tipo === 'y' && ultimo.cliente === i)) {
      avisos.push(`La entrega del cliente ${i} no está junto a la puerta al llegar`);
    }
    const entrega = pila.filter((b) => b.tipo === 'y' && b.cliente === i);
    pila = pila.filter((b) => !(b.tipo === 'y' && b.cliente === i));
    operar('descargar', alpha[i], { bloques: copiar(entrega) });
    const D = t;
    const espera = { total: D, ...acumulado };

    const nuevas = beta[i] > 0 ? [{ tipo: s === 1 ? 'z' : 'w', cliente: i, unidades: beta[i] }] : [];
    let pendientes = [];
    if (s === 1) {
      // Política 1: retiradas y nuevas vuelven junto a la puerta.
      pila = [...pila, ...retiradas, ...nuevas];
      operar('cargarRecogidas', zEntrada + beta[i], {
        etiqueta: 'Cargar las recogidas junto a la puerta',
        destino: 'z',
        bloques: [...copiar(retiradas), ...copiar(nuevas)],
      });
    } else {
      // Política 2: se sacan las entregas pendientes, las recogidas van al fondo y se recargan las entregas.
      pendientes = pila.filter((b) => b.tipo === 'y');
      pila = pila.filter((b) => b.tipo !== 'y');
      operar('retirarEntregas', unidades(pendientes), { bloques: copiar(pendientes) });
      const alFondo = [...retiradas.map((b) => ({ ...b, tipo: 'w' })), ...nuevas];
      pila = [...pila, ...alFondo];
      operar('cargarRecogidas', zEntrada + beta[i], {
        etiqueta: 'Cargar las recogidas al fondo',
        destino: 'w',
        bloques: copiar(alFondo),
      });
      pila = [...pila, ...pendientes];
      operar('recargarEntregas', unidades(pendientes), { bloques: copiar(pendientes) });
    }
    const F = t;
    const yPendiente = unidades(pendientes.length ? pendientes : pila.filter((b) => b.tipo === 'y'));
    const q = s === 1 ? 0 : (tasa.ua + tasa.la) * yPendiente;
    if (alpha[i] > 0) manipulacionAdicional += (tasa.ub + tasa.lb) * zEntrada;
    manipulacionAdicional += q;

    const salidaCarga = resumenCarga(pila);
    if (salidaCarga.total > Q + TOL) avisos.push(`La carga al salir de ${i} (${salidaCarga.total}) supera Q = ${Q}`);

    const tiempoParam = { ua: 0, la: 0, ub: 0, lb: 0 };
    const unidadesParam = { ua: 0, la: 0, ub: 0, lb: 0 };
    for (const op of ops) {
      tiempoParam[op.param] += op.duracion;
      unidadesParam[op.param] += op.unidades;
    }

    paradas.push({
      k: indice + 1,
      cliente: i,
      politica: s,
      alpha: alpha[i],
      beta: beta[i],
      desde: previo,
      c: cij,
      salidaPrevia: reloj,
      T,
      D,
      F,
      q,
      servicio: F - T,
      ops,
      tasa,
      tiempoParam,
      unidadesParam,
      zEntrada,
      yPendiente,
      llegada,
      salida: { carga: salidaCarga, pila: copiar(pila) },
      espera,
    });
    reloj = F;
    previo = i;
  }

  const cRegreso = c[previo][0];
  arcos.push({
    k: clientes.length,
    desde: previo,
    hasta: 0,
    c: cRegreso,
    inicio: reloj,
    fin: reloj + cRegreso,
    carga: resumenCarga(pila),
    pila: copiar(pila),
    regreso: true,
  });

  const objetivo = paradas.reduce((suma, p) => suma + p.D, 0);
  const sim = {
    archivo: salida.archivo,
    n: I.n,
    Q,
    ruta: S.ruta,
    clientes,
    paradas,
    porCliente: new Map(paradas.map((p) => [p.cliente, p])),
    arcos,
    cargaInicial,
    objetivo,
    viaje: arcos.reduce((suma, a) => suma + a.c, 0),
    manipulacionAdicional,
    obligatorias: paradas.reduce((suma, p) => suma + p.tasa.ua * p.alpha + p.tasa.lb * p.beta, 0),
    regreso: reloj + cRegreso,
    cargaMaxima: Math.max(cargaInicial.total, ...arcos.map((a) => a.carga.total)),
    politicas: { p1: paradas.filter((p) => p.politica === 1).length, p2: paradas.filter((p) => p.politica === 0).length },
    sumaAlpha: alpha.reduce((a, b) => a + b, 0),
    sumaBeta: beta.reduce((a, b) => a + b, 0),
    avisos,
  };
  sim.verificacion = verificar(sim, S);
  return sim;
}

function verificar(sim, S) {
  const diferencias = [];
  let comparados = 0;
  const comparar = (etiqueta, simulado, reportado) => {
    if (reportado == null || Number.isNaN(reportado)) return;
    comparados++;
    if (Math.abs(simulado - reportado) > TOL * Math.max(1, Math.abs(reportado))) {
      diferencias.push({ etiqueta, simulado, reportado });
    }
  };
  comparar('Σ D_i', sim.objetivo, S.objetivo);
  comparar('Regreso al depósito', sim.regreso, S.regreso);
  comparar('Viaje total', sim.viaje, S.viaje);
  comparar('Manipulación adicional', sim.manipulacionAdicional, S.manipulacionAdicional);
  for (const p of sim.paradas) {
    comparar(`T_${p.cliente}`, p.T, S.T?.get(p.cliente));
    comparar(`D_${p.cliente}`, p.D, S.D?.get(p.cliente));
    comparar(`F_${p.cliente}`, p.F, S.F?.get(p.cliente));
    comparar(`q_${p.cliente}`, p.q, S.q?.get(p.cliente));
  }

  // Sin las restricciones (20)-(23) los flujos w, y, z no son únicos: se informan aparte.
  const cargasDistintas = [];
  if (S.cargas) {
    for (const arco of sim.arcos) {
      const r = S.cargas.find((x) => x.arco?.[0] === arco.desde && x.arco?.[1] === arco.hasta);
      if (!r) continue;
      for (const tipo of ['w', 'y', 'z']) {
        if (Math.abs(arco.carga[tipo] - Number(r[tipo])) > TOL) {
          cargasDistintas.push({ arco: [arco.desde, arco.hasta], tipo, simulado: arco.carga[tipo], reportado: Number(r[tipo]) });
        }
      }
    }
  }
  return { comparados, diferencias, ok: diferencias.length === 0, cargasDistintas };
}

/** Escalamiento multidimensional clásico (2D) para instancias sin coordenadas. */
export function coordenadasMDS(c) {
  const m = c.length;
  const d2 = c.map((fila, i) => fila.map((v, j) => ((v + c[j][i]) / 2) ** 2));
  const medias = d2.map((fila) => fila.reduce((a, b) => a + b, 0) / m);
  const total = medias.reduce((a, b) => a + b, 0) / m;
  const B = d2.map((fila, i) => fila.map((v, j) => -0.5 * (v - medias[i] - medias[j] + total)));

  const multiplicar = (v) => B.map((fila) => fila.reduce((suma, b, j) => suma + b * v[j], 0));
  const normalizarV = (v) => {
    const norma = Math.hypot(...v) || 1;
    return v.map((x) => x / norma);
  };
  const vectores = [];
  for (let eje = 0; eje < 2; eje++) {
    let v = normalizarV(Array.from({ length: m }, (_, i) => Math.sin(i + 1 + eje * 7)));
    let lambda = 0;
    for (let iter = 0; iter < 300; iter++) {
      let w = multiplicar(v);
      for (const { v: u, lambda: l } of vectores) {
        const proy = u.reduce((s, x, k) => s + x * v[k], 0) * l;
        w = w.map((x, k) => x - proy * u[k]);
      }
      lambda = Math.hypot(...w);
      v = normalizarV(w);
    }
    vectores.push({ v, lambda });
  }
  return Array.from({ length: m }, (_, i) => vectores.map(({ v, lambda }) => v[i] * Math.sqrt(Math.max(lambda, 0))));
}
