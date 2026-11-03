export interface BackdropLayer {
  id: number;
  url: string;
  initialOpacity: 0 | 1;
}

export function appendBackdropLayer(layers: BackdropLayer[], next: BackdropLayer) {
  const current = layers[layers.length - 1];
  if (!next.url || current?.url === next.url) return layers;
  return [...layers, next];
}

export function settleBackdropLayers(layers: BackdropLayer[], id: number) {
  const latest = layers[layers.length - 1];
  return latest?.id === id ? [{ ...latest, initialOpacity: 1 as const }] : layers;
}
