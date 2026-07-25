import { useEffect, useState } from "react";
import {
  getActiveProfile,
  getProfileInitial,
  LOCAL_PROFILES_CHANGED_EVENT,
  type LocalProfile,
} from "../../utils/localProfiles";

export default function ProfileAvatar({ profile, className }: { profile?: LocalProfile | null; className?: string }) {
  const [activeProfile, setActiveProfile] = useState<LocalProfile | null>(() => profile ?? getActiveProfile());
  const currentProfile = profile === undefined ? activeProfile : profile;

  useEffect(() => {
    if (profile !== undefined) return;
    const refresh = () => setActiveProfile(getActiveProfile());
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [profile]);

  if (currentProfile?.avatarDataUrl) {
    return (
      <span className={className ?? "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full"}>
        <img src={currentProfile.avatarDataUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      className={className ?? "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full"}
      style={{
        background: "linear-gradient(180deg, rgba(154,154,154,0.96) 0%, rgba(112,112,112,0.96) 100%)",
        boxShadow: "0 8px 16px rgba(0,0,0,0.4)",
        color: "rgba(255,255,255,0.94)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <span className="font-black text-sm" style={{ color: "inherit", fontFamily: "inherit" }}>{getProfileInitial(currentProfile)}</span>
    </span>
  );
}
