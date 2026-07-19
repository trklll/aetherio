import { NavLink } from "react-router-dom";
import { Home, Search, BookMarked, Puzzle, Settings } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import clsx from "clsx";

const NAV = [
  { to: "/home",     icon: Home,        label: "Home" },
  { to: "/search",   icon: Search,      label: "Buscar" },
  { to: "/library",  icon: BookMarked,  label: "Biblioteca" },
  { to: "/addons",   icon: Puzzle,      label: "Add-ons" },
  { to: "/settings", icon: Settings,    label: "Ajustes" },
];

export default function Sidebar() {
  const collapsed = useUIStore(s => s.sidebarCollapsed);
  const toggle    = useUIStore(s => s.toggleSidebar);

  return (
    <aside
      className={clsx(
        "flex flex-col h-full glass border-r border-glass-border gsap-transition z-50 shrink-0",
        collapsed ? "w-[72px]" : "w-[220px]"
      )}
    >
      {/* Logo / nombre */}
      <div
        className="flex items-center gap-3 px-4 py-6 cursor-pointer select-none"
        onClick={toggle}
        data-tauri-drag-region
      >
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0 shadow-glow">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        {!collapsed && (
          <span className="font-semibold text-text-primary text-base tracking-wide gsap-fade-in">
            Aetherio
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 px-2 flex-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-3 rounded-card gsap-transition focus-ring",
                isActive
                  ? "bg-accent/20 text-accent shadow-glow"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary"
              )
            }
          >
            <Icon size={20} className="shrink-0" />
            {!collapsed && (
              <span className="text-sm font-medium gsap-fade-in">{label}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
