import { useMemo } from "react";
import { ArrowLeft, Plus, Settings2, Shield, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { basketballCompetitionLogo, resolveInsignia } from "../../data/sports/insignia.ts";
import { footballCompetitionNoTextLogo } from "../../data/footballCompetitionNoTextAssets.ts";
import { useSportsPreferences } from "../../data/sports/preferences.ts";
import { exitSportsMode } from "../../utils/sportsMode";
import HomeBoldIcon from "../../components/ui/HomeBoldIcon";
import BigPictureRail, { type RailItem } from "../BigPicture/BigPictureRail";
import { buildSportsCompetitions } from "../BigPicture/sportsCompetitions.ts";

const SPORTS_ITEMS: readonly RailItem[] = [
  { key: "aetherio", route: "/big-picture", label: "Volver a Aetherio", Icon: ArrowLeft },
  { key: "home", route: "/big-picture/sports", label: "Inicio", Icon: HomeBoldIcon },
  { key: "teams", route: "/big-picture/sports/teams", label: "Mis equipos", Icon: Shield },
  { key: "personalize", route: "/big-picture/sports#personalizar", label: "Personalizar", Icon: Settings2 },
];

export default function SportsRail() {
  const navigate = useNavigate();
  const preferences = useSportsPreferences();
  const followedCompetitions = useMemo(() => buildSportsCompetitions(preferences).map(({ entity }) => {
    const insignia = resolveInsignia({ entityId: entity.id, name: entity.name, size: 32 });
    const logoImage = entity.sport === "baloncesto"
      ? basketballCompetitionLogo(entity.name) ?? insignia.src
      : footballCompetitionNoTextLogo(entity.id) ?? insignia.src;
    return {
      key: `competition-${entity.id}`,
      route: `/big-picture/sports#competicion=${encodeURIComponent(entity.id)}`,
      label: entity.name,
      Icon: Trophy,
      logoImage: logoImage ?? undefined,
    };
  }), [preferences]);
  const sectionItems: readonly RailItem[] = followedCompetitions.length > 0
    ? followedCompetitions
    : [{
        key: "add-competition",
        route: "/big-picture/sports#competiciones",
        label: "Añadir competición",
        Icon: Plus,
      }];

  return <BigPictureRail items={SPORTS_ITEMS} showPlatforms={false} label="Navegación de Deportes"
    sectionTitle="Competiciones" sectionItems={sectionItems}
    profileRoute="/big-picture/sports/settings"
    onNavigate={route => route === "/big-picture" ? exitSportsMode(navigate) : navigate(route)} />;
}
