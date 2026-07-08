import { test, expect } from "bun:test";
import { toAlpha2 } from "../../src/asc/territory";

test("toAlpha2 maps known 3-letter storefronts to 2-letter", () => {
  expect(toAlpha2("USA")).toBe("US");
  expect(toAlpha2("DEU")).toBe("DE");
  expect(toAlpha2("GBR")).toBe("GB");
  expect(toAlpha2("SWE")).toBe("SE");
  expect(toAlpha2("DNK")).toBe("DK");
});

test("toAlpha2 maps previously-missing storefronts (regression for transcription typos)", () => {
  expect(toAlpha2("KOR")).toBe("KR");
  expect(toAlpha2("GRC")).toBe("GR");
  expect(toAlpha2("CZE")).toBe("CZ");
  expect(toAlpha2("NZL")).toBe("NZ");
  expect(toAlpha2("HKG")).toBe("HK");
  expect(toAlpha2("SGP")).toBe("SG");
  expect(toAlpha2("TWN")).toBe("TW");
  expect(toAlpha2("ISR")).toBe("IL");
  expect(toAlpha2("ARE")).toBe("AE");
  expect(toAlpha2("TUR")).toBe("TR");
  expect(toAlpha2("IND")).toBe("IN");
  expect(toAlpha2("ZAF")).toBe("ZA");
  expect(toAlpha2("HUN")).toBe("HU");
  expect(toAlpha2("ROU")).toBe("RO");
  expect(toAlpha2("CHE")).toBe("CH");
  expect(toAlpha2("POL")).toBe("PL");
  expect(toAlpha2("JPN")).toBe("JP");
  expect(toAlpha2("BRA")).toBe("BR");
});

test("toAlpha2 passes through 2-letter codes (uppercased)", () => {
  expect(toAlpha2("US")).toBe("US");
  expect(toAlpha2("de")).toBe("DE");
});

test("toAlpha2 returns unknown codes uppercased unchanged", () => {
  expect(toAlpha2("ZZZ")).toBe("ZZZ");
});
