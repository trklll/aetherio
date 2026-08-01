import { describe, expect, it } from "vitest";
import { PARSERS, parserFor } from "../parsers";
import { parseEditionOrThrow, type ParserMeta } from "../parser";
import type { AwardCeremony, ParsedEdition, ParsedRecord } from "../types";

function metaFor(ceremony: AwardCeremony, edition = 96, awardYear = 2024): ParserMeta {
  return { ceremony, edition, awardYear, url: `https://example.test/${ceremony}/${edition}`, coverage: "complete" };
}

function find(records: ParsedRecord[], predicate: (record: ParsedRecord) => boolean): ParsedRecord {
  const found = records.find(predicate);
  if (!found) throw new Error("Registro no encontrado");
  return found;
}

describe("PARSERS", () => {
  it("registra las 10 ceremonias con la última edición disponible", () => {
    expect(Object.keys(PARSERS).sort()).toEqual([
      "bafta",
      "cannes",
      "crunchyroll",
      "emmy",
      "golden_globes",
      "goya",
      "japan_academy",
      "mar_del_plata",
      "oscar",
      "venice",
    ]);
    for (const parser of Object.values(PARSERS)) {
      const editions = parser.archiveEditions();
      expect(editions.length).toBeGreaterThan(0);
      expect(editions[0].edition).toBe(1);
      expect(editions[0].coverage).toBe("complete");
    }
  });

  it("parserFor resuelve por nombre", () => {
    expect(parserFor("oscar")).toBe(PARSERS.oscar);
  });
});

describe("oscar", () => {
  it("parsea ganadoras, nominadas y categorías personales", () => {
    const html = `
      <h2>Best Picture</h2>
      <ul>
        <li class="winner">Anora</li>
        <li>Conclave</li>
        <li>The Brutalist</li>
      </ul>
      <h3>Best Director</h3>
      <ul>
        <li class="winner">Sean Baker — Anora</li>
        <li>Brady Corbet — The Brutalist</li>
      </ul>
      <h3>Best Original Song</h3>
      <ul>
        <li class="winner">El Mal — Emilia Pérez</li>
      </ul>`;
    const parsed = parseEditionOrThrow(PARSERS.oscar, html, metaFor("oscar"));
    expect(parsed.records).toHaveLength(6);
    const picture = find(parsed.records, record => record.categoryOriginal === "Best Picture" && record.workTitle === "Anora");
    expect(picture.status).toBe("winner");
    expect(picture.subject).toBe("work");
    expect(picture.categoryEs).toBe("Mejor Película");
    const director = find(parsed.records, record => record.categoryOriginal === "Best Director" && record.workTitle === "Anora");
    expect(director.recipients).toEqual(["Sean Baker"]);
    expect(director.subject).toBe("person");
    const song = find(parsed.records, record => record.categoryOriginal === "Best Original Song");
    expect(song.subject).toBe("song");
    expect(song.status).toBe("winner");
  });
});

describe("bafta", () => {
  it("parsea el archivo de film", () => {
    const html = `
      <h2>Best Film</h2>
      <ul>
        <li class="winner">Conclave</li>
        <li>Anora</li>
      </ul>
      <h3>Best Leading Actor</h3>
      <ul>
        <li class="winner">Adrien Brody — The Brutalist</li>
        <li>Timothée Chalamet — A Complete Unknown</li>
      </ul>`;
    const parsed = parseEditionOrThrow(PARSERS.bafta, html, metaFor("bafta", 78, 2025));
    expect(parsed.records).toHaveLength(4);
    const bestFilm = find(parsed.records, record => record.workTitle === "Conclave");
    expect(bestFilm.status).toBe("winner");
    expect(bestFilm.categoryEs).toBe("Mejor Película");
    const actor = find(parsed.records, record => record.categoryOriginal === "Best Leading Actor" && record.workTitle === "The Brutalist");
    expect(actor.recipients).toEqual(["Adrien Brody"]);
  });
});

describe("golden_globes", () => {
  it("parsea winners-nominees", () => {
    const html = `
      <h2>Best Motion Picture – Drama</h2>
      <ul>
        <li class="winner">The Brutalist</li>
        <li>Conclave</li>
      </ul>
      <h3>Best Actor in a Motion Picture – Drama</h3>
      <ul>
        <li class="winner">Adrien Brody — The Brutalist</li>
        <li>Timothée Chalamet — A Complete Unknown</li>
      </ul>`;
    const parsed = parseEditionOrThrow(PARSERS.golden_globes, html, metaFor("golden_globes", 82, 2025));
    const drama = find(parsed.records, record => record.workTitle === "The Brutalist");
    expect(drama.status).toBe("winner");
    expect(drama.categoryEs).toBe("Mejor Película Dramática");
  });
});

describe("emmy", () => {
  it("parsea tablas de nominees-winners", () => {
    const html = `
      <table>
        <tr class="category"><th colspan="2">Outstanding Drama Series</th></tr>
        <tr><td class="winner">Succession</td></tr>
        <tr><td>Severance</td></tr>
        <tr class="category"><th colspan="2">Outstanding Lead Actress in a Drama Series</th></tr>
        <tr><td class="winner">Sarah Snook — Succession</td></tr>
      </table>`;
    const parsed = parseEditionOrThrow(PARSERS.emmy, html, metaFor("emmy", 75, 2023));
    expect(parsed.records).toHaveLength(3);
    const series = find(parsed.records, record => record.workTitle === "Succession");
    expect(series.status).toBe("winner");
    expect(series.categoryEs).toBe("Mejor Serie Dramática");
    const actress = find(parsed.records, record => record.categoryOriginal === "Outstanding Lead Actress in a Drama Series");
    expect(actress.recipients).toEqual(["Sarah Snook"]);
    expect(actress.workTitle).toBe("Succession");
  });
});

describe("goya", () => {
  it("parsea nominaciones por categoría en español", () => {
    const html = `
      <h3>Mejor película</h3>
      <ul>
        <li class="winner">El 47</li>
        <li>La infiltrada</li>
      </ul>
      <h3>Mejor actor protagonista</h3>
      <ul>
        <li class="winner">Eduard Fernández — Marco</li>
      </ul>`;
    const parsed = parseEditionOrThrow(PARSERS.goya, html, metaFor("goya", 39, 2025));
    const bestFilm = find(parsed.records, record => record.workTitle === "El 47");
    expect(bestFilm.status).toBe("winner");
    expect(bestFilm.categoryEs).toBe("Mejor Película");
    const actor = find(parsed.records, record => record.categoryOriginal === "Mejor actor protagonista");
    expect(actor.recipients).toEqual(["Eduard Fernández"]);
  });
});

describe("japan_academy", () => {
  it("parsea tablas con marcadores 受賞/優秀", () => {
    const html = `
      <table>
        <tr class="category"><th colspan="2">最優秀作品賞</th></tr>
        <tr><td>受賞 バーフライ</td></tr>
        <tr><td>優秀 正体</td></tr>
        <tr class="category"><th colspan="2">最優秀監督賞</th></tr>
        <tr><td>受賞 黒沢清</td></tr>
      </table>`;
    const parsed = parseEditionOrThrow(PARSERS.japan_academy, html, metaFor("japan_academy", 48, 2025));
    expect(parsed.records).toHaveLength(3);
    const winner = find(parsed.records, record => record.workTitle === "バーフライ");
    expect(winner.status).toBe("winner");
    expect(winner.categoryEs).toBe("Mejor Película");
    const nominee = find(parsed.records, record => record.workTitle === "正体");
    expect(nominee.status).toBe("nominee");
    const director = find(parsed.records, record => record.categoryOriginal === "最優秀監督賞");
    expect(director.workTitle).toBe("黒沢清");
    expect(director.status).toBe("winner");
  });
});

describe("crunchyroll", () => {
  it("combina ganadores con el artículo de nominados sin duplicar", () => {
    const winnersHtml = `
      <h2>Anime of the Year</h2>
      <ul>
        <li class="winner">Frieren: Beyond Journey's End</li>
        <li>Dandadan</li>
      </ul>
      <h3>Best Film</h3>
      <ul><li class="winner">Look Back</li></ul>`;
    const nomineesHtml = `
      <h3>Anime of the Year</h3>
      <ul>
        <li>Frieren: Beyond Journey's End</li>
        <li>Dandadan</li>
        <li>Solo Leveling</li>
      </ul>
      <h3>Best Film</h3>
      <ul><li>Look Back</li></ul>`;
    const parsed = parseEditionOrThrow(PARSERS.crunchyroll, winnersHtml, metaFor("crunchyroll", 9, 2025), {
      url: "https://example.test/crunchyroll/nominees",
      html: nomineesHtml,
    });
    const winner = find(parsed.records, record => record.categoryOriginal === "Anime of the Year" && record.workTitle === "Frieren: Beyond Journey's End");
    expect(winner.status).toBe("winner");
    const soloLeveling = find(parsed.records, record => record.workTitle === "Solo Leveling");
    expect(soloLeveling.status).toBe("nominee");
    const animeOfYear = parsed.records.filter(record => record.categoryOriginal === "Anime of the Year");
    // winner + Dandadan + Solo Leveling (la nominación de Frieren duplica a la ganadora).
    expect(animeOfYear).toHaveLength(3);
  });
});

describe("festivales (palmarés + selecciones)", () => {
  it.each([
    ["cannes", "Golden Lion"],
    ["venice", "Golden Lion"],
  ] as const)("%s: palmarés por defecto ganadora y selección oficial aparte", (ceremony, _label) => {
    const html = `
      <h3>${ceremony === "cannes" ? "Palme d'Or" : "Golden Lion for Best Film"}</h3>
      <ul><li class="winner">The Room Next Door</li></ul>
      <h3>Volpi Cup for Best Actress</h3>
      <ul><li class="winner">Nicole Kidman — Babygirl</li></ul>`;
    const selectionsHtml = `
      <h4>Venezia 81</h4>
      <ul>
        <li>Joker: Folie à Deux</li>
        <li>Queer</li>
      </ul>`;
    const parsed = parseEditionOrThrow(PARSERS[ceremony], html, metaFor(ceremony, 81, 2024), {
      url: "https://example.test/selections",
      html: selectionsHtml,
    });
    const gold = find(parsed.records, record => record.workTitle === "The Room Next Door");
    expect(gold.status).toBe("winner");
    const selection = find(parsed.records, record => record.workTitle === "Joker: Folie à Deux");
    expect(selection.status).toBe("official_selection");
    expect(selection.section).toBe("Venezia 81");
    const actress = find(parsed.records, record => record.workTitle === "Babygirl");
    expect(actress.recipients).toEqual(["Nicole Kidman"]);
  });

  it("mar_del_plata: palmarés + selección oficial", () => {
    const html = `
      <h2>Astor de Oro</h2>
      <ul><li class="winner">El abrazo de la serpiente</li></ul>
      <h3>Mejor Dirección</h3>
      <ul><li class="winner">Ciro Guerra — El abrazo de la serpiente</li></ul>`;
    const selectionsHtml = `
      <h4>Selección Oficial Competencia</h4>
      <ul><li>La otra película</li></ul>`;
    const parsed = parseEditionOrThrow(PARSERS.mar_del_plata, html, metaFor("mar_del_plata", 30, 2015), {
      url: "https://example.test/mdpl/seleccion",
      html: selectionsHtml,
    });
    const gold = find(parsed.records, record => record.workTitle === "El abrazo de la serpiente");
    expect(gold.status).toBe("winner");
    expect(gold.categoryEs).toBe("Astor de Oro a la Mejor Película");
    const selection = find(parsed.records, record => record.workTitle === "La otra película");
    expect(selection.status).toBe("official_selection");
  });
});

describe("cobertura de archivos", () => {
  it("marca ediciones parciales donde el archivo no existe", () => {
    const cannesEditions = PARSERS.cannes.archiveEditions();
    expect(cannesEditions.find(item => item.awardYear === 2020)?.coverage).toBe("partial");
    const veniceEditions = PARSERS.venice.archiveEditions();
    expect(veniceEditions.find(item => item.edition === 7)?.coverage).toBe("partial");
    const marDelPlataEditions = PARSERS.mar_del_plata.archiveEditions();
    expect(marDelPlataEditions.find(item => item.edition === 37)?.coverage).toBe("partial");
  });

  it("recentEditions devuelve las dos más recientes de cada ceremonia", () => {
    for (const parser of Object.values(PARSERS)) {
      const recent = parser.recentEditions();
      expect(recent).toHaveLength(2);
      const editions = parser.archiveEditions();
      expect(recent.map(item => item.edition)).toEqual([
        editions[editions.length - 1].edition,
        editions[editions.length - 2].edition,
      ]);
    }
  });

  it("parseEditionOrThrow valida la ceremonia", () => {
    const meta = metaFor("oscar");
    const mismatched = { ...meta, ceremony: "bafta" as AwardCeremony };
    expect(() => parseEditionOrThrow(PARSERS.oscar, "<h2>X</h2><ul><li>Y</li></ul>", mismatched)).toThrow();
  });
});

export type { ParsedEdition };
