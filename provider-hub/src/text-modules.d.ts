declare module "*.txt" {
  /** Importado como text module workerd/wrangler: el contenido textual del archivo. */
  const content: string;
  export default content;
}
