export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandFrame {
  landmarks: Landmark[];
  secondaryLandmarks: Landmark[] | null;
  confidence: number;
  timestamp: number;
}

// Order matches SealType enum and ONNX model output (MLPipeline/01_collect_landmarks.py SEALS list)
// Index 0=Ne(rat) 1=Ushi(ox) 2=Tora(tiger) 3=U(hare) 4=Tatsu(dragon) 5=Mi(serpent)
//       6=Uma(horse) 7=Hitsuji(ram) 8=Saru(monkey) 9=Tori(bird) 10=Inu(dog) 11=I(boar)
export const SEAL_LABELS = [
  "rat",     // 0  Ne
  "ox",      // 1  Ushi
  "tiger",   // 2  Tora
  "hare",    // 3  U
  "dragon",  // 4  Tatsu
  "serpent", // 5  Mi
  "horse",   // 6  Uma
  "ram",     // 7  Hitsuji
  "monkey",  // 8  Saru
  "bird",    // 9  Tori
  "dog",     // 10 Inu
  "boar",    // 11 I
] as const;

export type SealType = typeof SEAL_LABELS[number] | "none";
