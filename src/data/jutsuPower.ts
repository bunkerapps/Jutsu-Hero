export interface JutsuPowerDef {
  power: number;
  rank: string;
  element: string | null;
  elementColor: number;
  rankColor: number;
}

export const JUTSU_POWER: Record<string, JutsuPowerDef> = {
  entrenamiento_12_sellos: {
    power: 1,
    rank: "E",
    element: null,
    elementColor: 0xaaaaaa,
    rankColor: 0x888888,
  },
  kage_bunshin: {
    power: 1,
    rank: "C",
    element: null,
    elementColor: 0xaaaaff,
    rankColor: 0x4488ff,
  },
  rasengan: {
    power: 1,
    rank: "C",
    element: "wind",
    elementColor: 0x88ffdd,
    rankColor: 0x00ccaa,
  },
  chidori: {
    power: 1,
    rank: "C",
    element: "lightning",
    elementColor: 0xdddd00,
    rankColor: 0xffcc00,
  },
  katon_goukakyuu: {
    power: 2,
    rank: "B",
    element: "fire",
    elementColor: 0xff6600,
    rankColor: 0xff8844,
  },
  katon_housenka: {
    power: 2,
    rank: "B",
    element: "fire",
    elementColor: 0xff6600,
    rankColor: 0xff8844,
  },
  katon_ryuuka: {
    power: 3,
    rank: "A",
    element: "fire",
    elementColor: 0xff4400,
    rankColor: 0xff6600,
  },
};

export function getJutsuPower(jutsuId: string): JutsuPowerDef {
  return JUTSU_POWER[jutsuId] ?? { power: 1, rank: "D", element: null, elementColor: 0xffffff, rankColor: 0xaaaaaa };
}

export function powerStars(power: number): string {
  return "★".repeat(power) + "☆".repeat(Math.max(0, 3 - power));
}
