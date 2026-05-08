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

  return (
    <span className={className ?? "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white text-black"}>
      {currentProfile?.avatarDataUrl ? (
        <img src={currentProfile.avatarDataUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-black font-black text-sm">{getProfileInitial(currentProfile)}</span>
      )}
    </span>
  );
}
