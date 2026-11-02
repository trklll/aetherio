/**
 * Scripts de proveedor incluidos en el paquete del worker (text modules).
 *
 * Se compilan durante el arranque (warmup) porque el runtime de Workers solo
 * permite `eval`/`new Function` en esa fase; en los handlers no hay codegen.
 * Actualizarlos implica un nuevo despliegue (`wrangler deploy`).
 */
import providerDepsSource from "./assets/provider-deps.js.txt";
import fourkhdhubSource from "./assets/4khdhub.js.txt";
import { GENERATED_PROVIDER_SCRIPTS } from "./generatedProviderScripts.ts";

export const PROVIDER_DEPS_SOURCE = providerDepsSource;
export { GENERATED_PROVIDER_SCRIPTS };

export const builtinScriptSources: ReadonlyMap<string, string> = new Map<string, string>([
  ["4khdhub", fourkhdhubSource],
  ...GENERATED_PROVIDER_SCRIPTS.map(provider => [provider.id, provider.source] as [string, string]),
]);
