import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, "refs_", "seanime", "seanime-denshi", "assets", "shaders");
const destinationDir = join(root, "src-tauri", "bin", "mpv", "shaders");

const shaderNames = [
  "Anime4K_Clamp_Highlights.glsl",
  "Anime4K_Restore_CNN_M.glsl",
  "Anime4K_Restore_CNN_S.glsl",
  "Anime4K_Restore_CNN_Soft_M.glsl",
  "Anime4K_Restore_CNN_Soft_S.glsl",
  "Anime4K_Restore_CNN_Soft_VL.glsl",
  "Anime4K_Restore_CNN_VL.glsl",
  "Anime4K_Upscale_CNN_x2_M.glsl",
  "Anime4K_Upscale_CNN_x2_S.glsl",
  "Anime4K_Upscale_CNN_x2_UL.glsl",
  "Anime4K_Upscale_CNN_x2_VL.glsl",
  "Anime4K_Upscale_Denoise_CNN_x2_M.glsl",
  "Anime4K_Upscale_Denoise_CNN_x2_VL.glsl",
  "Anime4K_AutoDownscalePre_x2.glsl",
  "Anime4K_AutoDownscalePre_x4.glsl",
];

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

await mkdir(destinationDir, { recursive: true });

for (const name of shaderNames) {
  const source = join(sourceDir, name);
  const destination = join(destinationDir, name);
  if (await exists(source)) {
    await copyFile(source, destination);
    continue;
  }
  if (!(await exists(destination))) {
    throw new Error(
      `Falta ${name}. Restaura el checkout de referencia de Seanime o el shader empaquetado.`,
    );
  }
}

const fsrShader = join(destinationDir, "FSR.glsl");
if (!(await exists(fsrShader))) {
  throw new Error("Falta FSR.glsl en el runtime MPV integrado.");
}

console.log(`Mejoras de vídeo: ${shaderNames.length} shaders Anime4K y FSR listos.`);
