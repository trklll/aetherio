import { createElement as h, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useHorizontalVirtualWindow } from "../../src/hooks/useHorizontalVirtualWindow";
import { installSpatialNavigation } from "../../src/navigation/spatialNav";
import { useRowPositionMemory } from "../../src/hooks/useRowPositionMemory";

const CARD_WIDTH = 137;
const GAP = 31;

function VirtualRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  const count = name === "collection" || name === "other" ? 100 : 1;
  const rail = useHorizontalVirtualWindow({ itemCount: count, itemWidth: CARD_WIDTH, gap: GAP });
  return h("section", { "data-row-key": name, "data-row-count": count, style: { marginBottom: 12 } },
    h("h2", null, name),
    h("div", { ref: rail.scrollRef, "data-row-scroller": true, style: { display: "flex", overflow: "auto", padding: "8px 0" } },
      rail.beforeWidth > 0 && h("div", { style: { flex: `0 0 ${rail.beforeWidth}px` } }),
      ...Array.from({ length: rail.end - rail.start }, (_, offset) => {
        const index = rail.start + offset;
        return h("div", { key: index, "data-item-index": index, "data-row-card": true,
          style: { flex: "0 0 auto", marginRight: index === count - 1 ? 0 : GAP } },
        h("button", { onClick: onOpen, "data-row-card": true,
          style: { width: CARD_WIDTH, height: 90 } }, `${name} ${index}`));
      }),
      rail.afterWidth > 0 && h("div", { style: { flex: `0 0 ${rail.afterWidth}px` } }),
    ),
  );
}

function Probe({ scale }: { scale: number }) {
  const [detail, setDetail] = useState(false);
  const [otherReady, setOtherReady] = useState(true);
  const [rows, setRows] = useState(["first", "middle", "collection", "other", "last"]);
  const shell = useRef<HTMLDivElement>(null);
  useRowPositionMemory(shell, detail ? "/probe/detail" : "/probe/rows");
  return h("div", null,
    h("button", { onClick: () => setRows(["last", "collection", "first"]) }, "Reorder and remove rows"),
    h("div", { ref: shell, "data-aetherio-scroll-shell": true, style: { height: 700, overflow: "auto" } },
      detail ? h("main", null, h("button", { onClick: () => {
        setOtherReady(false);
        setDetail(false);
        // Model a catalog that resolves after the main viewport has restored.
        window.setTimeout(() => setOtherReady(true), 250);
      } }, "Back to rows"))
        : h("div", { style: { transform: `scale(${scale})`, transformOrigin: "top left", width: `${100 / scale}%` } },
          ...rows.filter(name => name !== "other" || otherReady).map(name => h(VirtualRow, { key: name, name, onOpen: () => setDetail(true) })),
          h("div", { style: { height: 1200 } }),
        ),
      ),
  );
}

export function mountSpatialRowsProbe(scale: number) {
  document.documentElement.classList.add("aetherio-big-picture");
  installSpatialNavigation();
  createRoot(document.getElementById("root")!).render(h(Probe, { scale }));
}
