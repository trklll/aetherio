import { ArrowLeft } from "lucide-react";
import FloatingActionButton from "./FloatingActionButton";

interface BackButtonProps {
  onClick: () => void;
  title?: string;
}

export default function BackButton({ onClick, title = "Volver" }: BackButtonProps) {
  return (
    <FloatingActionButton onClick={onClick} title={title} icon={<ArrowLeft size={20} />} />
  );
}
