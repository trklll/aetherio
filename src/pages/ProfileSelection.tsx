import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Lock, Check } from "lucide-react";
import ProfileAvatar from "../components/profile/ProfileAvatar";
import {
  getLocalProfiles,
  getActiveProfileId,
  setActiveProfile,
  verifyPin,
  getProfileInitial,
  type LocalProfile,
} from "../utils/localProfiles";
import "./ProfileSelection.css";

const PASTEL_COLORS = [
  "#f9a8d4",
  "#93c5fd",
  "#6ee7b7",
  "#fcd34d",
  "#c4b5fd",
  "#fda4af",
  "#67e8f9",
  "#a7f3d0",
];

export default function ProfileSelection() {
  const navigate = useNavigate();
  const profiles = useMemo(() => getLocalProfiles(), []);
  const [pinModal, setPinModal] = useState<{ profile: LocalProfile; pin: string; error: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const hasActive = !!getActiveProfileId();
  const bgProfile = profiles.find(p => p.id === getActiveProfileId()) || profiles[0];

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const targetUrl = hoveredId
    ? profiles.find(p => p.id === hoveredId)?.avatarDataUrl
    : bgProfile?.avatarDataUrl;

  const [bgCurrent, setBgCurrent] = useState<string | null | undefined>(bgProfile?.avatarDataUrl);
  const [bgNext, setBgNext] = useState<string | null | undefined>(null);
  const [bgTransitioning, setBgTransitioning] = useState(false);
  const bgTimer = useRef<number>(0);

  const startBgTransition = useCallback((url: string | null | undefined) => {
    if (!url || url === bgCurrent || url === bgNext) return;
    window.clearTimeout(bgTimer.current);
    setBgNext(url);
    setBgTransitioning(true);
    bgTimer.current = window.setTimeout(() => {
      setBgCurrent(url);
      setBgNext(null);
      setBgTransitioning(false);
    }, 400);
  }, [bgCurrent, bgNext]);

  useEffect(() => {
    startBgTransition(targetUrl);
    return () => window.clearTimeout(bgTimer.current);
  }, [targetUrl, startBgTransition]);

  useEffect(() => {
    if (!hasActive && profiles.length === 1) {
      setActiveProfile(profiles[0].id);
      navigate("/home", { replace: true });
    }
  }, []);

  useEffect(() => {
    if (pinModal) pinInputRef.current?.focus();
  }, [pinModal]);

  function selectProfile(profile: LocalProfile) {
    if (profile.pin) {
      setPinModal({ profile, pin: "", error: "" });
      return;
    }
    enterProfile(profile);
  }

  function enterProfile(profile: LocalProfile) {
    setActiveProfile(profile.id);
    navigate("/home", { replace: true });
  }

  async function submitPin() {
    if (!pinModal) return;
    const valid = await verifyPin(pinModal.pin, pinModal.profile.pin!);
    if (!valid) {
      setPinModal(prev => prev ? { ...prev, pin: "", error: "PIN incorrecto" } : null);
      return;
    }
    const profile = pinModal.profile;
    setPinModal(null);
    enterProfile(profile);
  }

  function addProfile() {
    setAdding(true);
    navigate("/quick-start/profile");
  }

  return (
    <div className="profile-selection-page">
      <div className="profile-selection-bg">
        {bgCurrent && (
          <img
            src={bgCurrent}
            alt=""
            className={`profile-selection-bg-img ${bgTransitioning ? "bg-img-leave" : "bg-img-current"}`}
          />
        )}
        {bgNext && (
          <img
            src={bgNext}
            alt=""
            className={`profile-selection-bg-img bg-img-enter`}
          />
        )}
        <div className="profile-selection-bg-tint" />
        <div className="profile-selection-bg-radial" />
        <div className="profile-selection-bg-vertical" />
        <div className="profile-selection-bg-bottom" />
      </div>

      <main className="profile-selection-content">
        <h1 className="profile-selection-title">
          ¿Quién está viendo ahora?
        </h1>

        <div className="profile-selection-row">
          {profiles.map((profile, index) => (
            <button
              key={profile.id}
              onClick={() => selectProfile(profile)}
              onMouseEnter={() => setHoveredId(profile.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(profile.id)}
              onBlur={() => setHoveredId(null)}
              className="profile-card"
            >
              <div
                className="profile-card-avatar"
                style={{
                  backgroundColor: PASTEL_COLORS[index % PASTEL_COLORS.length],
                }}
              >
                {profile.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="" />
                ) : (
                  <span>{getProfileInitial(profile)}</span>
                )}
              </div>
              <span className="profile-card-name">{profile.name}</span>
            </button>
          ))}

          <button
            onClick={addProfile}
            disabled={adding}
            className="profile-card profile-card-add"
          >
            <div className="profile-card-avatar">
              <Plus size={58} strokeWidth={2.5} />
            </div>
            <span className="profile-card-name">Agregar</span>
          </button>
        </div>
      </main>

      {pinModal ? (
        <div
          className="pin-modal-overlay"
          onClick={() => setPinModal(null)}
        >
          <div
            className="pin-modal"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === "Escape") setPinModal(null); }}
          >
            <div className="pin-modal-profile">
              <ProfileAvatar
                profile={pinModal.profile}
                className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white text-2xl font-black text-black"
              />
              <p className="pin-modal-name">{pinModal.profile.name}</p>
              <p className="pin-modal-hint">Introduce el PIN para acceder</p>
            </div>

            <div className="pin-input-wrapper">
              <Lock size={20} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
              <input
                ref={pinInputRef}
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinModal.pin}
                onChange={e =>
                  setPinModal(prev =>
                    prev ? { ...prev, pin: e.target.value.replace(/\D/g, ""), error: "" } : null
                  )
                }
                onKeyDown={e => { if (e.key === "Enter") void submitPin(); }}
                placeholder="PIN"
              />
            </div>

            {pinModal.error ? (
              <p className="pin-error">{pinModal.error}</p>
            ) : null}

            <div className="pin-actions">
              <button
                onClick={() => setPinModal(null)}
                className="pin-btn pin-btn-cancel"
              >
                Cancelar
              </button>
              <button
                onClick={() => void submitPin()}
                disabled={!pinModal.pin.trim()}
                className="pin-btn pin-btn-enter"
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Check size={16} />
                  Entrar
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
