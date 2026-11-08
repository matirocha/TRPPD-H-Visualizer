// Lector mínimo de archivos .xlsx, sin dependencias: un .xlsx es un ZIP con hojas en XML.
// Lee las hojas pedidas por su nombre y devuelve, por celda, el valor guardado y si tiene fórmula.
//
// Un libro escrito con openpyxl guarda las fórmulas sin su resultado (<v> vacío) hasta que se
// abre y se guarda en Excel; en ese caso el valor de esas celdas es null y formula es true.
import { inflateRawSync } from 'node:zlib';

/** Contenido de cada archivo del ZIP por su nombre (solo métodos 0 y 8, como los de Excel y openpyxl). */
function abrirZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('no es un archivo ZIP (.xlsx) válido');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entradas = new Map();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('directorio del ZIP dañado');
    const largoNombre = buf.readUInt16LE(p + 28);
    entradas.set(buf.toString('utf8', p + 46, p + 46 + largoNombre), {
      metodo: buf.readUInt16LE(p + 10), comprimido: buf.readUInt32LE(p + 20), local: buf.readUInt32LE(p + 42),
    });
    p += 46 + largoNombre + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return (nombre) => {
    const e = entradas.get(nombre.replace(/^\//, ''));
    if (!e) return null;
    const inicio = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const datos = buf.subarray(inicio, inicio + e.comprimido);
    if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`compresión ${e.metodo} no soportada en ${nombre}`);
    return (e.metodo === 8 ? inflateRawSync(datos) : datos).toString('utf8');
  };
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTIDADES[e] ?? m));
const atributo = (atributos, nombre) => atributos.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1] ?? null;
/** Texto de un <si> o <is>: todos sus <t>, también los de texto enriquecido. */
const textoRico = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');

/** 'AB' → 28 */
export function numeroColumna(letras) {
  let n = 0;
  for (const c of letras) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}

function leerHoja(xml, compartidos) {
  // filas: Map número de fila → array por número de columna de {valor, formula}
  const filas = new Map();
  for (const [, atributos, interior = ''] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = atributo(atributos, 'r')?.match(/^([A-Z]+)(\d+)$/);
    if (!ref) continue;
    const tipo = atributo(atributos, 't');
    const formula = /<f\b/.test(interior);
    const v = interior.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let valor = null;
    if (tipo === 'inlineStr') valor = textoRico(interior.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
    else if (v != null && v !== '') {
      if (tipo === 's') valor = compartidos[Number(v)] ?? null;
      else if (tipo === 'str') valor = texto(v);
      else if (tipo === 'b') valor = v === '1';
      else if (tipo === 'e') valor = null; // #N/A, #DIV/0!…
      else valor = Number(v);
    } else if (tipo === 'str' && formula && v === '') valor = '';
    const fila = Number(ref[2]);
    if (!filas.has(fila)) filas.set(fila, []);
    filas.get(fila)[numeroColumna(ref[1])] = { valor, formula };
  }
  return filas;
}

/**
 * Lee del libro (Buffer de un .xlsx) las hojas pedidas. Devuelve {nombre: filas | null}, con
 * filas un Map fila → [columna] → {valor, formula}. nombres puede ser un array o una función que
 * recibe la lista de hojas del libro y devuelve las que hay que leer.
 */
export function leerLibro(buf, nombres) {
  const archivo = abrirZip(buf);
  const libro = archivo('xl/workbook.xml');
  if (!libro) throw new Error('el .xlsx no tiene xl/workbook.xml');
  const relaciones = archivo('xl/_rels/workbook.xml.rels') ?? '';
  const destinos = new Map([...relaciones.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map(([, a]) => [atributo(a, 'Id'), atributo(a, 'Target')]));
  const hojas = [...libro.matchAll(/<sheet\b([^>]*)\/?>/g)].map(([, a]) => {
    const destino = destinos.get(atributo(a, 'r:id')) ?? '';
    return { nombre: texto(atributo(a, 'name') ?? ''), ruta: destino.startsWith('/') ? destino.slice(1) : `xl/${destino}` };
  });
  const compartidos = [...(archivo('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoRico(m[1]));
  const pedidas = typeof nombres === 'function' ? nombres(hojas.map((h) => h.nombre)) : nombres;
  return Object.fromEntries(pedidas.map((nombre) => {
    const hoja = hojas.find((h) => h.nombre === nombre);
    const xml = hoja && archivo(hoja.ruta);
    return [nombre, xml ? leerHoja(xml, compartidos) : null];
  }));
}
