import { type ChangeEvent, type FormEvent, useState } from "react";
import { Lock, UserRound } from "lucide-react";
import ProfileAvatar from "../components/profile/ProfileAvatar";
import aetherioLogo from "../assets/aetheriologo.png";
import {
  createLocalProfile,
  getLocalProfiles,
  readImageFileAsDataUrl,
  type LocalProfile,
} from "../utils/localProfiles";

export default function ProfileOnboarding() {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>();
  const [error, setError] = useState("");

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setAvatarDataUrl(await readImageFileAsDataUrl(file));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la imagen.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Escribe un nombre para crear la cuenta.");
      return;
    }
    const isFirstProfile = getLocalProfiles().length === 0;
    await createLocalProfile(
      { name, pin, avatarDataUrl },
      { makeActive: true, adoptCurrentData: isFirstProfile }
    );
    window.location.reload();
  }

  const previewProfile: LocalProfile = {
    id: "preview",
    name: name || "Aetherio",
    pin: pin || undefined,
    avatarDataUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1f1f1f] px-6 py-10 text-white">
      <form onSubmit={submit} className="liquid-glass-dark w-full max-w-md rounded-lg p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-4">
          <img src={aetherioLogo} alt="Aetherio" className="h-16 w-16 rounded-2xl object-contain" />
          <div>
            <h1 className="text-2xl font-black text-white">Crear cuenta local</h1>
            <p className="mt-1 text-sm text-white/56">Tus series, ajustes y add-ons se guardaran en este equipo.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-white/86">Nombre</span>
            <div className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/10 px-4 py-3">
              <UserRound size={16} className="shrink-0 text-white/50" />
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                autoFocus
                maxLength={32}
                placeholder="Tu nombre"
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/34"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-white/86">PIN opcional</span>
            <div className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/10 px-4 py-3">
              <Lock size={16} className="shrink-0 text-white/50" />
              <input
                value={pin}
                onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                placeholder="Sin PIN"
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/34"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-white/86">
              <ProfileAvatar profile={previewProfile} className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white text-black text-xs" />
              Foto de perfil
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={chooseImage}
              className="block w-full cursor-pointer rounded-lg border border-white/12 bg-white/10 px-4 py-3 text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-bold file:text-black"
            />
          </label>
        </div>

        {error ? <p className="mt-4 text-sm font-semibold text-red-300">{error}</p> : null}

        <button type="submit" className="mt-6 w-full rounded-full bg-white px-5 py-3 text-sm font-black text-black gsap-transition hover:bg-white/86">
          Entrar
        </button>
      </form>
    </main>
  );
}
