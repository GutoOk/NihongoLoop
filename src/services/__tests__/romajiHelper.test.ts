import { describe, expect, it } from "vitest";
import { simpleKanaToRomaji } from "../romajiHelper";

describe("simpleKanaToRomaji", () => {
  it("converte kana básico corretamente", () => {
    expect(simpleKanaToRomaji("きく")).toBe("kiku");
    expect(simpleKanaToRomaji("なに")).toBe("nani");
  });

  it("converte dígrafos corretamente", () => {
    expect(simpleKanaToRomaji("しゃしん")).toBe("shashin");
    expect(simpleKanaToRomaji("ちゃ")).toBe("cha");
    expect(simpleKanaToRomaji("ちょ")).toBe("cho");
  });

  it("converte pequeno tsu corretamente", () => {
    expect(simpleKanaToRomaji("ちょっと")).toBe("chotto");
    expect(simpleKanaToRomaji("がっこう")).toBe("gakkou");
  });
});
