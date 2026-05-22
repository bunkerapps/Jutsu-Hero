import Phaser from "phaser";
import type { MediaPipeDetector } from "./hand-detection/MediaPipeDetector";
import { BootScene }        from "./scenes/BootScene";
import { MenuScene }        from "./scenes/MenuScene";
import { LevelSelectScene } from "./scenes/LevelSelectScene";
import { GameplayScene }    from "./scenes/GameplayScene";
import { BattleScene }         from "./scenes/BattleScene";
import { ResultsScene }        from "./scenes/ResultsScene";
import { OnlineLobbyScene }    from "./scenes/OnlineLobbyScene";
import { NetworkBattleScene }  from "./scenes/NetworkBattleScene";
import { TutorialScene }       from "./scenes/TutorialScene";

export function createGame(detector: MediaPipeDetector | null): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: "#000000",
    transparent: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, MenuScene, LevelSelectScene, GameplayScene, BattleScene, ResultsScene,
            OnlineLobbyScene, NetworkBattleScene, TutorialScene],
  };

  const game = new Phaser.Game(config);
  game.registry.set("detector", detector);

  return game;
}
