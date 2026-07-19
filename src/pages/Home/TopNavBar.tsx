import { useNavigate, useLocation } from "react-router-dom";
import { Search, ChevronLeft } from "lucide-react";
import clsx from "clsx";
import { toggleWindowFullscreen } from "../../utils/windowControls";
import { closeWindow, minimizeWindow } from "../../runtime/platform";

const NAV = [
  { label: "Inicio",     path: "/home" },
  { label: "Add-ons",   path: "/addons" },
  { label: "Biblioteca", path: "/library" },
];

interface Props { showBack?: boolean; }

export default function TopNavBar({ showBack = false }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div
      className="absolute top-0 left-0 right-0 z-50 flex flex-col"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)",
          height: 120,
        }}
      />

      <div className="relative flex items-center justify-between px-5 pt-4 pb-2">
        <div className="w-28 flex items-center">
          {showBack ? (
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-white/80 hover:text-white text-sm font-medium gsap-transition"
            >
              <ChevronLeft size={18} />
              Volver
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center shadow-glow">
                <span className="text-white font-bold text-xs">A</span>
              </div>
              <span className="text-white/70 text-sm font-semibold tracking-wide">Aetherio</span>
            </div>
          )}
        </div>

        <div
          className="flex items-center rounded-full px-1.5 py-1 gap-0.5"
          style={{
            background: "rgba(255,255,255,0.13)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {NAV.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={clsx(
                "px-4 py-1.5 rounded-full text-sm font-medium gsap-transition",
                pathname === item.path
                  ? "bg-white text-gray-900 shadow"
                  : "text-white/85 hover:text-white hover:bg-white/15"
              )}
            >
              {item.label}
            </button>
          ))}

          <button
            onClick={() => navigate("/search")}
            className="p-1.5 ml-0.5 text-white/75 hover:text-white gsap-transition rounded-full hover:bg-white/15"
          >
            <Search size={15} />
          </button>
        </div>

        <div className="w-28 flex items-center justify-end gap-2">
          <button
            onClick={minimizeWindow}
            className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-300 gsap-transition shadow"
            title="Minimizar"
          />
          <button
            onClick={toggleWindowFullscreen}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 gsap-transition shadow"
            title="Pantalla completa"
          />
          <button
            onClick={closeWindow}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 gsap-transition shadow"
            title="Cerrar"
          />
        </div>
      </div>
    </div>
  );
}
