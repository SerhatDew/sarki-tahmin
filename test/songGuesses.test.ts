import { expect, test } from "bun:test";
import { dataManager } from "../src/dataManager";

const donence = dataManager.songs.find(song => song.id === "baris_manco_donence")!;

test("sanatçı adı tek başına veya başka şarkıyla doğru sayılmaz", () => {
  for (const guess of ["Barış Manço", "baris manco", "Barış Manço - Gülpembe"]) {
    expect(dataManager.checkGuess(donence, guess)).toBe(false);
  }
});

test("şarkı adı, sanatçı sırası ve küçük yazım hataları kabul edilir", () => {
  for (const guess of ["DÖNENCE", "dönencee", "Barış Manço - Dönence", "Dönence - Barış Manço"]) {
    expect(dataManager.checkGuess(donence, guess)).toBe(true);
  }
});

test("ayraçlar şarkı başlığındaki kelimeleri birleştirmez", () => {
  const song = dataManager.songs.find(song => song.id === "mor_ve_otesi_bir_derdim_var")!;
  expect(dataManager.checkGuess(song, "Mor ve Ötesi:Bir Derdim Var")).toBe(true);
  expect(dataManager.checkGuess(song, "Mor ve Ötesi:Cambaz")).toBe(false);
});
