// Comprueba que la simulación de la página (public/js/modelo.js) reproduce los
// instantes, el objetivo y las cargas que reporta cada solución de Outputs.
//
// Uso: npm run verificar
import { readFile } from 'node:fs/promises';
import { listarSalidas, resolverSalida } from '../lib/salidas.js';
import { normalizar, simular } from '../public/js/modelo.js';

let errores = 0;
const salidas = await listarSalidas();
for (const { archivo } of salidas) {
  try {
    const sim = simular(normalizar(JSON.parse(await readFile(resolverSalida(archivo), 'utf8')), archivo));
    const { ok, comparados, diferencias, cargasDistintas } = sim.verificacion;
    const problemas = [...diferencias.map((d) => `${d.etiqueta}: ${d.simulado} vs ${d.reportado}`), ...sim.avisos];
    if (!ok || sim.avisos.length) errores++;
    const nota = cargasDistintas.length ? `  (${cargasDistintas.length} flujos de carga distintos a los reportados)` : '';
    console.log(`${ok && !sim.avisos.length ? 'OK   ' : 'ERROR'} ${archivo}  Σ D_i = ${sim.objetivo.toFixed(2)}  ${comparados} valores comparados${nota}`);
    for (const p of problemas) console.log(`        ${p}`);
  } catch (error) {
    errores++;
    console.log(`ERROR ${archivo}: ${error.message}`);
  }
}
console.log(`\n${salidas.length} soluciones, ${errores} con diferencias`);
process.exitCode = errores ? 1 : 0;
