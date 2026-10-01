#!/usr/bin/env node
/**
 * Verifica que el build de SpatialPosters que va dentro del instalador sea
 * realmente el de este repo.
 *
 * Por que existe: el server de posters se compila en el CI y no se commitea
 * (~140 MB), asi que un error de ruteo puede compilar una version vieja o
 * incompleta sin que nada falle. Pasaron dos releases asi: el CI pineaba el
 * repo upstream a un commit fijo, los cambios de badges se hacian en el clon
 * local, y el instalador salia con "Binge-Worthy" en ingles y las etiquetas en
 * su tamano original. El build era verde, el release se publicaba, y el
 * problema sehia ver en la pantalla de la tele.
 *
 * Este script mira dentro de `.next/` (el build de Next.js) y exige que
 * aparezcan cadenas que solo existen si el codigo de este repo llego. Si
 * falta alguna, falla el build con un mensaje que dice que revisar.
 *
 * Se ejecuta en el CI despues de `stage-spatialposters.ps1`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const STAGE = "src-tauri/resources/spatialposters/.next";

/**
 * Cadenas que tienen que estar en el bundle. Cada una con el motivo por el que
 * se exige, para que el fallo diga que revisar y no solo "falta X".
 */
const REQUIRED = [
  {
    needle: "Para maratonear",
    why: 'la traduccion de es.json de "badge.bingeWorthy" (debe decir "Binge-Worthy" si el build es viejo)',
  },
  {
    needle: "Es cine",
    why: 'la traduccion de es.json de "badge.absoluteCinema"',
  },
  {
    needle: "Cada ",
    why: "el badge de dia de emision (airing-schedule.ts)",
  },
  {
    needle: "sci-fi",
    why: "la normalizacion de generos compuestos (genre-label.ts)",
  },
];

/** Minimo de archivos .js que tiene que tener el bundle. Un build truncado se ve aca. */
const MIN_JS_FILES = 200;

function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}

let jsFiles = 0;
const haystack = [];

try {
  statSync(STAGE);
} catch {
  console.error(
    `\n  X  No existe ${STAGE}.\n` +
      "     El staging no corrio, o fallo antes de generar el build. " +
      "Revisar el paso 'Build SpatialPosters'.\n",
  );
  process.exit(1);
}

walk(STAGE, (file) => {
  if (!file.endsWith(".js")) return;
  jsFiles += 1;
  try {
    haystack.push(readFileSync(file, "utf8"));
  } catch {
    // Un archivo ilegible no es motivo para tirar abajo el build: lo que
    // importa es si las cadenas esperadas aparecen en algun lado.
  }
});

const full = haystack.join("\n");
const missing = REQUIRED.filter(({ needle }) => !full.includes(needle));

if (jsFiles < MIN_JS_FILES) {
  console.error(
    `\n  X  El build de SpatialPosters parece incompleto: ${jsFiles} archivos .js, ` +
      `se esperaban al menos ${MIN_JS_FILES}.\n` +
      "     Suele ser un stage que se corto a mitad, o un .gitignore que se llevo medio proyecto.\n",
  );
  process.exit(1);
}

if (missing.length) {
  console.error("\n  X  El server de posters que se va a publicar NO contiene los cambios de este repo:\n");
  for (const { needle, why } of missing) {
    console.error(`     - "${needle}"  ->  ${why}`);
  }
  console.error(
    "\n     Opciones, en orden de probabilidad:\n" +
      "       1. El stage se compilo de otra fuente. El default es vendor/spatialposters;\n" +
      "          si se paso SPATIALPOSTERS_SOURCE, esta apuntando a otro lado.\n" +
      "       2. El codigo esta en vendor/ pero no llego al stage. Verificar que\n" +
      "          vendor/spatialposters/src/lib/ tiene los cambios y que el build se regenero.\n" +
      "       3. Quedo un build viejo en src-tauri/resources/ y el staleness check\n" +
      "          del script lo dio por al dia. Borrar esa carpeta y reintentar.\n",
  );
  process.exit(1);
}

console.log(`    OK  server de posters verificado (${jsFiles} archivos .js, ${REQUIRED.length} cadenas presentes)`);
