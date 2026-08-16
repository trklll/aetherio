import { Maximize, Minus, X } from "lucide-react";
import { isAndroidRuntime } from "../../runtime/platform";
import { closeWindow, minimizeWindow, toggleWindowFullscreen } from "../../utils/windowControls";
import FloatingActionButton from "./FloatingActionButton";

export default function WindowControls() {
  if (isAndroidRuntime()) return null;
  return (
    <>
      <FloatingActionButton
        onClick={() => void minimizeWindow()}
        title="Minimizar"
        icon={<Minus size={18} />}
      />
      <FloatingActionButton
        onClick={toggleWindowFullscreen}
        title="Pantalla completa"
        icon={<Maximize size={18} />}
        animateOnClick
      />
      <FloatingActionButton
        onClick={() => void closeWindow()}
        title="Cerrar"
        icon={<X size={18} />}
      />
    </>
  );
}