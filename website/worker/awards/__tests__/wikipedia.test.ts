import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { wikipediaPageUrl, wikipediaParser, walkWikipedia } from "../parsers/wikipedia";
import { loadHtml } from "../sections";

const WIKI_OSCAR_97 = `
  <h2>Winners and nominees</h2>
  <h3>Best Picture</h3>
  <table><tbody>
    <tr><th scope="row">Film</th></tr>
    <tr><td><b>Anora</b></td></tr>
    <tr><td>Conclave</td></tr>
  </tbody></table>
  <h3>Best Director</h3>
  <ul>
    <li><b>Sean Baker</b> — Anora</li>
    <li>Jacques Audiard — Emilia Pérez</li>
  </ul>
  <h2>References</h2>
  <div class="reflist"><p>Notas al pie que no deben parsearse.</p></div>
`;

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("wikipediaPageUrl", () => {
  it("genera la URL ordinal por edición", () => {
    expect(wikipediaPageUrl("oscar", 96, 2024)).toBe("https://en.wikipedia.org/wiki/96th_Academy_Awards");
    expect(wikipediaPageUrl("golden_globes", 81, 2024)).toBe("https://en.wikipedia.org/wiki/81st_Golden_Globe_Awards");
    expect(wikipediaPageUrl("bafta", 77, 2024)).toBe("https://en.wikipedia.org/wiki/77th_British_Academy_Film_Awards");
  });

  it("usa el año para los festivales sin ordinal", () => {
    expect(wikipediaPageUrl("cannes", 77, 2024)).toBe("https://en.wikipedia.org/wiki/2024_Cannes_Film_Festival");
  });

  it("devuelve null cuando no hay artículo por edición", () => {
    expect(wikipediaPageUrl("mar_del_plata", 39, 2024)).toBeNull();
  });
});

describe("walkWikipedia", () => {
  it("extrae categorías y ítems sin caer en secciones de notas", () => {
    const sections = walkWikipedia(loadHtml(WIKI_OSCAR_97));
    expect(sections.map(section => section.category)).toEqual(["Best Picture", "Best Director"]);
    expect(sections[0].items).toEqual([
      { text: "Anora", status: "winner" },
      { text: "Conclave", status: "nominee" },
    ]);
    expect(sections[1].items).toEqual([
      { text: "Sean Baker — Anora", status: "winner" },
      { text: "Jacques Audiard — Emilia Pérez", status: "nominee" },
    ]);
  });

  it("parsea el layout real de Oscar 63 (wrapper mw-heading + columnas td)", () => {
    const sections = walkWikipedia(loadHtml(fixture("oscar-63-awards.html")));
    expect(sections.map(section => section.category)).toEqual([
      "Best Picture",
      "Best Directing",
      "Best Actor in a Leading Role",
      "Best Actress in a Leading Role",
    ]);
    const [picture, directing] = sections;
    expect(picture.items[0]).toMatchObject({ status: "winner" });
    expect(picture.items[0].text).toContain("Dances With Wolves");
    expect(picture.items[0].text).toContain("Jim Wilson and Kevin Costner, producers");
    expect(picture.items.slice(1).map(item => item.status)).toEqual(["nominee", "nominee", "nominee", "nominee"]);
    expect(picture.items.slice(1).map(item => item.text)).toEqual([
      "Awakenings – Walter Parkes and Lawrence Lasker, producers",
      "Ghost – Lisa Weinstein, producer",
      "The Godfather Part III – Francis Ford Coppola, producer",
      "Goodfellas – Irwin Winkler, producer",
    ]);
    expect(directing.items[0]).toMatchObject({ text: "Kevin Costner – Dances With Wolves", status: "winner" });
    expect(directing.items.map(item => item.text)).toEqual([
      "Kevin Costner – Dances With Wolves",
      "Francis Ford Coppola – The Godfather Part III",
      "Martin Scorsese – Goodfellas",
      "Stephen Frears – The Grifters",
      "Barbet Schroeder – Reversal of Fortune",
    ]);
  });

  it("parsea el layout real de BAFTA 44 (Goodfellas como Mejor Película)", () => {
    const sections = walkWikipedia(loadHtml(fixture("bafta-44-awards.html")));
    expect(sections.map(section => section.category)).toEqual([
      "Best Film",
      "Best Direction",
      "Best Actor in a Leading Role",
      "Best Actress in a Leading Role",
    ]);
    expect(sections[0].items[0]).toMatchObject({
      text: "Goodfellas – Irwin Winkler and Martin Scorsese",
      status: "winner",
    });
    expect(sections[1].items[0]).toMatchObject({ text: "Martin Scorsese – Goodfellas", status: "winner" });
    expect(sections[2].items[0]).toMatchObject({ text: "Philippe Noiret – Cinema Paradiso as Alfredo", status: "winner" });
  });

  it("parsea filas th de categoría con columnas (Globos de Oro) y omite tablas de estadísticas", () => {
    const html = `
      <div class="mw-heading mw-heading3"><h3 id="Film">Film</h3><span class="mw-editsection">[edit]</span></div>
      <table><tbody>
        <tr><th colspan="2">Best Motion Picture</th></tr>
        <tr><th>Drama</th><th>Musical or Comedy</th></tr>
        <tr>
          <td><ul><li><b>Dances with Wolves</b><ul><li>Avalon</li><li>Goodfellas</li></ul></li></ul></td>
          <td><ul><li><b>Green Card</b><ul><li>Ghost</li><li>Home Alone</li></ul></li></ul></td>
        </tr>
        <tr><th colspan="2">Best Director</th></tr>
        <tr><th>Drama</th><th>Musical or Comedy</th></tr>
        <tr>
          <td><ul><li><b>Kevin Costner – Dances with Wolves</b><ul><li>Francis Ford Coppola – The Godfather Part III</li></ul></li></ul></td>
          <td><ul><li><b>Bernardo Bertolucci – The Sheltering Sky</b><ul><li>Whit Stillman – Metropolitan</li></ul></li></ul></td>
        </tr>
      </tbody></table>
      <table><tbody>
        <tr><th>Nominations</th><th>Title</th></tr>
        <tr><td>7</td><td>The Godfather Part III</td></tr>
      </tbody></table>
      <table><tbody>
        <tr><th>Wins</th><th>Title</th></tr>
        <tr><td>3</td><td>Dances with Wolves</td></tr>
      </tbody></table>`;
    const sections = walkWikipedia(loadHtml(html));
    expect(sections.map(section => section.category)).toEqual([
      "Best Motion Picture – Drama",
      "Best Motion Picture – Musical or Comedy",
      "Best Director – Drama",
      "Best Director – Musical or Comedy",
    ]);
    expect(sections[0].items).toEqual([
      { text: "Dances with Wolves", status: "winner" },
      { text: "Avalon", status: "nominee" },
      { text: "Goodfellas", status: "nominee" },
    ]);
    expect(sections[3].items[0]).toMatchObject({ text: "Bernardo Bertolucci – The Sheltering Sky", status: "winner" });
  });

  it("parsea el layout antiguo con filas th (categoría) + td (ítem)", () => {
    const html = `
      <h3>Best Picture</h3>
      <table><tbody>
        <tr><th scope="row">Best Picture</th><td><b>Anora</b></td></tr>
        <tr><th scope="row">Best Picture</th><td>Conclave</td></tr>
      </tbody></table>`;
    const sections = walkWikipedia(loadHtml(html));
    expect(sections).toHaveLength(1);
    expect(sections[0].category).toBe("Best Picture");
    expect(sections[0].items).toEqual([
      { text: "Anora", status: "winner" },
      { text: "Conclave", status: "nominee" },
    ]);
  });

  it("omite secciones de estadísticas y homenajes no premiables", () => {
    const html = `
      <h2>Winners and nominees</h2>
      <h3>Multiple nominations and awards</h3>
      <table><tbody>
        <tr><th>Nominations</th><th>Film</th></tr>
        <tr><td>10</td><td>Anora</td></tr>
      </tbody></table>`;
    expect(walkWikipedia(loadHtml(html))).toEqual([]);
  });

  it("omite Presenters y Performers de la página completa (63rd Academy Awards)", () => {
    const html = `
      <h2>Winners and nominees</h2>
      <h3>Best Picture</h3>
      <table><tbody>
        <tr><th scope="row">Film</th></tr>
        <tr><td><b>Dances with Wolves</b></td></tr>
      </tbody></table>
      <h2>Presenters and performers</h2>
      <h3>Presenters</h3>
      <table><tbody>
        <tr><th>Presenter</th><th>Role</th></tr>
        <tr><td>Billy Crystal</td><td>Host</td></tr>
      </tbody></table>
      <h3>Performers</h3>
      <ul><li>Madonna – "Sooner or Later"</li></ul>
      <h2>Ceremony information</h2>
      <h3>Ratings and reception</h3>
      <p>An average of 42.7 million viewers watched the ceremony.</p>`;
    const sections = walkWikipedia(loadHtml(html));
    expect(sections.map(section => section.category)).toEqual(["Best Picture"]);
    expect(sections).toHaveLength(1);
  });

  it("extrae las subcategorías del bloque Other de los Globos de Oro", () => {
    const html = `
      <h2>Winners and nominees</h2>
      <h3>Film</h3>
      <table><tbody>
        <tr><th colspan="2">Best Motion Picture</th></tr>
        <tr><th>Drama</th><th>Musical or Comedy</th></tr>
        <tr>
          <td><ul><li><b>Goodfellas</b></li></ul></td>
          <td><ul><li><b>Green Card</b></li></ul></td>
        </tr>
        <tr><th colspan="2">Other</th></tr>
        <tr><th>Best Director</th><th>Best Screenplay</th></tr>
        <tr>
          <td><ul><li><b>Kevin Costner – Dances with Wolves</b></li></ul></td>
          <td><ul><li><b>Nicholas Pileggi and Martin Scorsese – Goodfellas</b></li></ul></td>
        </tr>
      </tbody></table>`;
    const sections = walkWikipedia(loadHtml(html));
    expect(sections.map(section => section.category)).toEqual([
      "Best Motion Picture – Drama",
      "Best Motion Picture – Musical or Comedy",
      "Best Director",
      "Best Screenplay",
    ]);
    expect(sections[2].items[0]).toMatchObject({ text: "Kevin Costner – Dances with Wolves", status: "winner" });
    expect(sections[3].items[0]).toMatchObject({ text: "Nicholas Pileggi and Martin Scorsese – Goodfellas", status: "winner" });
  });
});

describe("wikipediaParser", () => {
  const meta = {
    ceremony: "oscar" as const,
    edition: 97,
    awardYear: 2025,
    url: "https://en.wikipedia.org/wiki/97th_Academy_Awards",
    coverage: "complete" as const,
  };

  it("convierte la página en registros etiquetados como fuente secundaria", () => {
    const parsed = wikipediaParser("oscar").parseEdition(WIKI_OSCAR_97, meta);
    expect(parsed.records).toHaveLength(4);
    expect(parsed.records[0]).toMatchObject({
      categoryOriginal: "Best Picture",
      status: "winner",
      workTitle: "Anora",
      sourceUrl: meta.url,
      sourceTier: "secondary",
    });
    expect(parsed.records[1]).toMatchObject({ status: "nominee", workTitle: "Conclave" });
    expect(parsed.records[2]).toMatchObject({
      categoryOriginal: "Best Director",
      status: "winner",
      recipients: ["Sean Baker"],
      workTitle: "Anora",
    });
    expect(parsed.records[3]).toMatchObject({ status: "nominee", recipients: ["Jacques Audiard"] });
  });

  it("convierte el fixture real de Oscar 63 en registros", () => {
    const parsed = wikipediaParser("oscar").parseEdition(fixture("oscar-63-awards.html"), meta);
    expect(parsed.records).toHaveLength(20);
    expect(parsed.records[0]).toMatchObject({ categoryOriginal: "Best Picture", status: "winner" });
    expect(parsed.records[0].workTitle).toContain("Dances With Wolves");
    expect(parsed.records[5]).toMatchObject({ categoryOriginal: "Best Directing", status: "winner" });
    expect(parsed.records[5]).toMatchObject({ recipients: ["Kevin Costner"], workTitle: "Dances With Wolves" });
    expect(parsed.records[10]).toMatchObject({ categoryOriginal: "Best Actor in a Leading Role", status: "winner" });
    expect(parsed.records[19]).toMatchObject({ categoryOriginal: "Best Actress in a Leading Role", status: "nominee" });
  });

  it("quita notas al pie de los títulos", () => {
    const html = `
      <h2>Winners</h2>
      <h3>Best Picture</h3>
      <ul>
        <li><b>Anora</b><sup id="cite_ref-1" class="reference">[1]</sup></li>
      </ul>`;
    const parsed = wikipediaParser("oscar").parseEdition(html, meta);
    expect(parsed.records[0].workTitle).toBe("Anora");
  });

  it("limpia la identidad de obra: Goodfellas queda igual en todas las categorías", () => {
    const html = `
      <h2>Winners and nominees</h2>
      <h3>Best Picture</h3>
      <ul>
        <li><b><i>Dances with Wolves</i> – Jim Wilson and Kevin Costner, producers</b></li>
        <li><i>Goodfellas</i> – Irwin Winkler, producer</li>
      </ul>
      <h3>Best Writing (Screenplay Based on Material from Another Medium)</h3>
      <ul>
        <li><b><i>Goodfellas</i> – Nicholas Pileggi and Martin Scorsese from <i>Wiseguy</i> by Nicholas Pileggi</b></li>
      </ul>
      <h3>Best Film Editing</h3>
      <ul>
        <li><b><i>Goodfellas</i> – Thelma Schoonmaker</b></li>
      </ul>
      <h3>Best Actor in a Supporting Role</h3>
      <ul>
        <li><b>Joe Pesci – <i>Goodfellas</i> as James Conway</b></li>
      </ul>`;
    const parsed = wikipediaParser("oscar").parseEdition(html, meta);
    const byCategory = (category: string) => parsed.records.filter(record => record.categoryOriginal === category);
    expect(byCategory("Best Picture")[0]).toMatchObject({ status: "winner", workTitle: "Dances with Wolves", recipients: [] });
    const goodfellas = parsed.records.filter(record => record.workTitle === "Goodfellas");
    expect(goodfellas.map(record => record.categoryOriginal)).toEqual([
      "Best Picture",
      "Best Writing (Screenplay Based on Material from Another Medium)",
      "Best Film Editing",
      "Best Actor in a Supporting Role",
    ]);
    expect(goodfellas.every(record => record.workTitle === "Goodfellas")).toBe(true);
    expect(byCategory("Best Writing (Screenplay Based on Material from Another Medium)")[0].recipients).toEqual([
      "Nicholas Pileggi",
      "Martin Scorsese",
    ]);
    expect(byCategory("Best Film Editing")[0].recipients).toEqual(["Thelma Schoonmaker"]);
    expect(byCategory("Best Actor in a Supporting Role")[0].recipients).toEqual(["Joe Pesci"]);
  });

  it("asigna workYear por defecto al año anterior a la ceremonia", () => {
    const parsed = wikipediaParser("oscar").parseEdition(WIKI_OSCAR_97, meta);
    expect(parsed.records.every(record => record.workYear === 2024)).toBe(true);
  });
});
