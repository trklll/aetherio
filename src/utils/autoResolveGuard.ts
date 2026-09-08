// Guardia de "auto-resolve" estilo NuvioTV.
//
// Cuando la pagina de episode entra en modo resolucion automatica de fuente
// (reanudar / autoplay / primera fuente / reutilizar enlace) muestra un loader
// de pantalla completa en vez del picker. Mientras ese loader esta activo, una
// pulsacion de atras (ESC, boton de la app, gesto de raton o boton del
// navegador) no debe salir de la pagina: debe cancelar el autoplay y revelar
// el picker manual.
//
// Contrato sin acoplamiento DOM: la pagina registra su callback de
// cancelacion y el shell (AppShell.goBack) o el guard de popstate lo consumen
// con `consumeAutoResolveBackPress()`.

type CancelFn = () => void;

const stack: CancelFn[] = [];

export function registerAutoResolve(cancel: CancelFn): () => void {
  stack.push(cancel);
  return () => {
    const index = stack.indexOf(cancel);
    if (index >= 0) stack.splice(index, 1);
  };
}

/**
 * Si hay un auto-resolve activo, lo cancela (muestra el picker manual) y
 * devuelve true para que el llamador NO navegue. Si no hay ninguno,
 * devuelve false y el llamador sigue su flujo normal de atras.
 */
export function consumeAutoResolveBackPress(): boolean {
  const cancel = stack[stack.length - 1];
  if (!cancel) return false;
  stack.pop();
  cancel();
  return true;
}
