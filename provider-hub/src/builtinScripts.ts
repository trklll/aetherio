/**
 * Scripts de proveedor incluidos en el paquete del worker (text modules).
 *
 * Se compilan durante el arranque (warmup) porque el runtime de Workers solo
 * permite `eval`/`new Function` en esa fase; en los handlers no hay codegen.
 * Actualizarlos implica un nuevo despliegue (`wrangler deploy`).
 */
import providerDepsSource from "./assets/provider-deps.js.txt";
import fourkhdhubSource from "./assets/4khdhub.js.txt";
import { GENERATED_PROVIDER_SCRIPTS as KV_PROVIDER_SCRIPTS } from "./generatedProviderScripts.ts";
import { SEANIME_PROVIDER_SCRIPTS } from "./seanime/generatedCatalog.ts";

export const PROVIDER_DEPS_SOURCE = providerDepsSource;
// Bundling is not registration: KV remains the sole authority over availability.
export const GENERATED_PROVIDER_SCRIPTS = [
  ...KV_PROVIDER_SCRIPTS.map(provider => ({ ...SEANIME_PROVIDER_SCRIPTS.find(entry => entry.id === provider.id), ...provider })),
  ...SEANIME_PROVIDER_SCRIPTS.filter(provider => !KV_PROVIDER_SCRIPTS.some(entry => entry.id === provider.id)),
];

export const builtinScriptSources: ReadonlyMap<string, string> = new Map<string, string>([
  ["4khdhub", fourkhdhubSource],
  ...GENERATED_PROVIDER_SCRIPTS.map(provider => [provider.id, provider.source] as [string, string]),
]);
