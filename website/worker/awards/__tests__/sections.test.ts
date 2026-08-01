import { describe, expect, it } from "vitest";
import { loadHtml, walkSections, walkTable, itemsIn } from "../sections";

describe("walkSections", () => {
  const html = `
    <html><body>
      <h2>Best Picture</h2>
      <ul>
        <li class="winner">Anora</li>
        <li>Conclave</li>
        <li>The Brutalist</li>
      </ul>
      <h2>Best Director</h2>
      <ul>
        <li class="winner">Sean Baker</li>
        <li>Brady Corbet</li>
      </ul>
      <h2>Best Film Editing</h2>
      <ul>
        <li class="winner">Anora</li>
        <li>Conclave</li>
      </ul>
    </body></html>`;

  it("extrae categorías e ítems con estado por clase", () => {
    const sections = walkSections(loadHtml(html), "h2, h3", "li");
    expect(sections.map(section => section.category)).toEqual([
      "Best Picture",
      "Best Director",
      "Best Film Editing",
    ]);
    const picture = sections[0];
    expect(picture.items).toHaveLength(3);
    expect(picture.items[0]).toMatchObject({ text: "Anora", status: "winner" });
    expect(picture.items[1]).toMatchObject({ text: "Conclave", status: null });
  });

  it("detecta estado por marcadores de texto", () => {
    const textHtml = `
      <body>
        <h3>Mejor película</h3>
        <ul>
          <li>Ganadora: El 47</li>
          <li>Nominada: La infiltrada</li>
          <li>El abrazo de la serpiente</li>
        </ul>
      </body>`;
    const sections = walkSections(loadHtml(textHtml), "h3", "li");
    expect(sections[0].items[0].status).toBe("winner");
    expect(sections[0].items[1].status).toBe("nominee");
    expect(sections[0].items[2].status).toBe(null);
  });

  it("respeta los límites de sección con encabezados anidados", () => {
    const nested = `
      <body>
        <h2>Winners</h2>
        <h3>Best Picture</h3>
        <ul><li class="winner">Anora</li></ul>
        <h3>Best Director</h3>
        <ul><li class="winner">Sean Baker</li></ul>
        <h2>Nominees</h2>
        <h3>Best Picture</h3>
        <ul><li>Conclave</li></ul>
      </body>`;
    const sections = walkSections(loadHtml(nested), "h2, h3", "li");
    // Los wrappers "Winners"/"Nominees" no absorben las subcategorías.
    expect(sections.map(section => section.category)).toEqual([
      "Best Picture",
      "Best Director",
      "Best Picture",
    ]);
    expect(sections[0].items[0].status).toBe("winner");
    expect(sections[2].items[0].status).toBe(null);
  });
});

describe("walkTable", () => {
  const html = `
    <html><body>
      <table>
        <tr class="category"><th colspan="2">最優秀作品賞</th></tr>
        <tr><td class="winner">バーフライ</td></tr>
        <tr><td>正体</td></tr>
        <tr class="category"><th colspan="2">最優秀監督賞</th></tr>
        <tr><td class="winner">黒沢清</td></tr>
      </table>
    </body></html>`;

  it("agrupa filas por categoría (th)", () => {
    const sections = walkTable(loadHtml(html), "table");
    expect(sections.map(section => section.category)).toEqual(["最優秀作品賞", "最優秀監督賞"]);
    expect(sections[0].items[0]).toMatchObject({ text: "バーフライ", status: "winner" });
    expect(sections[0].items[1]).toMatchObject({ text: "正体", status: null });
    expect(sections[1].items).toHaveLength(1);
  });

  it("descarta tablas vacías", () => {
    const empty = `<body><table><tr><td> </td></tr></table></body>`;
    expect(walkTable(loadHtml(empty), "table")).toEqual([]);
  });
});

describe("itemsIn", () => {
  it("itera ítems de contenedores", () => {
    const html = `
      <body>
        <div class="palmares">
          <p class="winner">Ganadora del premio</p>
          <p>Segunda línea</p>
        </div>
      </body>`;
    const items = itemsIn(loadHtml(html), ".palmares", "p");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ text: "Ganadora del premio", status: "winner" });
  });
});
