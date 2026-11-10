import ocean from "../../assets/channels/ocean.jpg";
import forest from "../../assets/channels/forest.jpg";
import cinema from "../../assets/channels/cinema.jpg";
import stadium from "../../assets/channels/stadium.jpg";

// A deliberately fixed, synthetic schedule. Never used as a real EPG or stream source.
export const GUIDE_START = 11 * 60 + 30;
export const GUIDE_END = 16 * 60 + 30;
export const DEMO_NOW = 12 * 60 + 5;
export const CHANNEL_CATEGORIES = ["Todos", "Generalistas", "Cine", "Documentales", "Deportes"] as const;
export type ChannelCategory = typeof CHANNEL_CATEGORIES[number];

export interface GuideProgramme {
  id: string;
  title: string;
  start: number;
  end: number;
  genre: string;
  description: string;
  artwork: string;
}

export interface GuideChannel {
  id: string;
  name: string;
  number: string;
  category: Exclude<ChannelCategory, "Todos">;
  color: string;
  programmes: GuideProgramme[];
}

type ProgrammeSlot = [title: string, start: number, end: number, genre: string, artwork?: string, description?: string];

function schedule(channel: string, slots: ProgrammeSlot[]): GuideProgramme[] {
  return slots.map(([title, start, end, genre, artwork, description]) => ({
    id: `${channel}-${start}`, title, start, end, genre,
    artwork: artwork ?? cinema,
    description: description ?? "Una selección de actualidad, historias y entretenimiento para acompañar tu día. Programa incluido en esta guía de demostración.",
  }));
}

export const DEMO_CHANNELS: GuideChannel[] = [
  { id: "la1", name: "La 1", number: "01", category: "Generalistas", color: "#4c9fe8", programmes: schedule("la1", [
    ["La mañana", 690, 780, "Magacín"],
    ["Telediario 1", 780, 840, "Noticias", cinema, "Las noticias del día, el contexto de la actualidad y las historias de sus protagonistas. Horario e información de ejemplo."],
    ["El tiempo", 840, 855, "Actualidad", forest],
    ["La promesa", 855, 930, "Serie"],
    ["Aquí la Tierra", 930, 990, "Naturaleza", forest],
  ]) },
  { id: "la2", name: "La 2", number: "02", category: "Documentales", color: "#49b6a5", programmes: schedule("la2", [
    ["Saber vivir", 660, 710, "Bienestar", forest],
    ["Planeta azul", 710, 780, "Documental", ocean, "Un viaje bajo la superficie para descubrir la vida de los océanos. Arrecifes, mundos escondidos y las criaturas que los habitan."],
    ["Bosques del mundo", 780, 840, "Documental", forest, "Senderos entre árboles centenarios, lagos silenciosos y paisajes que cambian con cada estación. Una mirada a la vida del bosque."],
    ["Saber y ganar", 840, 885, "Concurso"],
    ["Grandes documentales", 885, 960, "Documental", forest],
    ["Rutas con historia", 960, 1020, "Viajes", forest],
  ]) },
  { id: "antena3", name: "Antena 3", number: "03", category: "Generalistas", color: "#e7a36b", programmes: schedule("antena3", [
    ["Espejo público", 690, 750, "Magacín"],
    ["Cocina abierta", 750, 795, "Cocina"],
    ["La ruleta de la suerte", 795, 840, "Concurso"],
    ["Noticias 1", 840, 885, "Noticias"],
    ["Sueños de libertad", 885, 945, "Serie"],
    ["Y ahora Sonsoles", 945, 1020, "Magacín"],
  ]) },
  { id: "cuatro", name: "Cuatro", number: "04", category: "Generalistas", color: "#e78080", programmes: schedule("cuatro", [
    ["Callejeros viajeros", 675, 735, "Viajes", forest],
    ["Viajeros Cuatro", 735, 825, "Viajes", forest],
    ["Noticias Cuatro", 825, 870, "Noticias"],
    ["Deportes Cuatro", 870, 900, "Deportes", stadium],
    ["Todo es mentira", 900, 990, "Actualidad"],
  ]) },
  { id: "lasexta", name: "laSexta", number: "05", category: "Generalistas", color: "#91bd70", programmes: schedule("lasexta", [
    ["Al rojo vivo", 690, 810, "Actualidad"],
    ["laSexta Noticias", 810, 870, "Noticias"],
    ["Jugones", 870, 900, "Deportes", stadium],
    ["Zapeando", 900, 990, "Entretenimiento"],
  ]) },
  { id: "paramount", name: "Paramount Network", number: "06", category: "Cine", color: "#d4be8c", programmes: schedule("paramount", [
    ["Una mañana de cine", 675, 750, "Cine", cinema, "Historias para dejarse llevar, personajes inolvidables y una mañana dedicada al cine. Selección ilustrativa de esta maqueta."],
    ["Historias de película", 750, 855, "Cine"],
    ["Sesión de tarde", 855, 990, "Cine"],
  ]) },
  { id: "teledeporte", name: "Teledeporte", number: "07", category: "Deportes", color: "#d8a950", programmes: schedule("teledeporte", [
    ["Conexión deportes", 690, 750, "Deportes", stadium, "La jornada deportiva, sus protagonistas y las imágenes que deja la competición. Contenido y horario de demostración."],
    ["Fútbol · Resumen de la jornada", 750, 810, "Fútbol", stadium],
    ["Tenis · Lo mejor del torneo", 810, 900, "Tenis", stadium],
    ["Polideportivo", 900, 990, "Deportes", stadium],
  ]) },
];

export function formatGuideTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function getProgrammeState(programme: Pick<GuideProgramme, "start" | "end">, now = DEMO_NOW) {
  if (programme.end <= now) return "past";
  return programme.start <= now ? "current" : "upcoming";
}

export function programmePosition(programme: Pick<GuideProgramme, "start" | "end">, start = GUIDE_START, end = GUIDE_END) {
  const from = Math.max(start, programme.start);
  const to = Math.min(end, programme.end);
  return to > from ? { left: from - start, duration: to - from } : null;
}

export function filterChannels(channels: GuideChannel[], category: ChannelCategory, query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const search = normalize(query);
  return channels.filter(channel => (category === "Todos" || channel.category === category) && normalize(channel.name).includes(search));
}
