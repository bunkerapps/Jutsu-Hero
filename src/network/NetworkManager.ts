import { io, Socket } from "socket.io-client";

export type PlayerRole = "p1" | "p2" | "p3" | "p4";

export interface MatchStartData {
  startDelay: number;
  // 4-player BR
  beatmaps: Record<string, string>;
  playerCount: number;
  // legacy 1v1 fields (kept for backward compat)
  p1BeatmapId: string;
  p2BeatmapId: string;
}

export interface CastData {
  jutsuId: string;
  damage: number;
  fromRole?: string;
}

export interface ProgressData {
  progress: number;
  combo: number;
  hp: number;
  role?: string;
}

export interface RoundOverData {
  winner: PlayerRole;
  p1Wins: number;
  p2Wins: number;
}

class NetworkManager {
  private socket: Socket | null = null;

  role: PlayerRole | null = null;
  roomCode: string | null = null;
  connected = false;
  playerCount = 2;

  // ── Callbacks set by scenes ──────────────────────────────────────────────
  onConnected:            (() => void) | null = null;
  onConnectError:         ((err: Error) => void) | null = null;
  onRoomCreated:          ((code: string) => void) | null = null;
  onRoomJoined:           ((role: PlayerRole, playerCount: number) => void) | null = null;
  onRoomError:            ((msg: string) => void) | null = null;
  onOpponentConnected:    ((role: string, playerCount: number) => void) | null = null;
  onOpponentJutsuSelected:((beatmapId: string, role: string) => void) | null = null;
  onOpponentReady:        (() => void) | null = null;
  onSelectionStart:       (() => void) | null = null;
  onMatchStart:           ((data: MatchStartData) => void) | null = null;
  onOpponentCast:         ((data: CastData) => void) | null = null;
  onOpponentProgress:     ((data: ProgressData) => void) | null = null;
  onRoundOver:            ((data: RoundOverData) => void) | null = null;
  onMatchOver:            ((winner: PlayerRole) => void) | null = null;
  onOpponentRematch:      (() => void) | null = null;
  onOpponentDisconnected: (() => void) | null = null;
  onOpponentFrame:        ((data: ArrayBuffer) => void) | null = null;
  onOpponentEliminated:   ((role: string) => void) | null = null;

  // ── Connection ───────────────────────────────────────────────────────────

  connect(url: string): void {
    if (this.socket?.connected) return;

    this.socket = io(url, {
      transports: ["polling", "websocket"],
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
      timeout: 8000,
    });

    this.socket.on("connect", () => {
      this.connected = true;
      this.onConnected?.();
    });

    this.socket.on("connect_error", (err: Error) => {
      this.connected = false;
      this.onConnectError?.(err);
    });

    this.socket.on("disconnect", () => {
      this.connected = false;
      this.role = null;
      this.roomCode = null;
    });

    this.socket.on("room:created", ({ code }: { code: string }) => {
      this.roomCode = code;
      this.role = "p1";
      this.onRoomCreated?.(code);
    });

    this.socket.on("room:joined", ({ role, code, playerCount }: { role: PlayerRole; code: string; playerCount: number }) => {
      this.role = role;
      this.roomCode = code;
      this.playerCount = playerCount;
      this.onRoomJoined?.(role, playerCount);
    });

    this.socket.on("room:error", ({ message }: { message: string }) => {
      this.onRoomError?.(message);
    });

    this.socket.on("opponent:connected", ({ role, playerCount }: { role: string; playerCount: number }) => {
      this.playerCount = playerCount;
      this.onOpponentConnected?.(role, playerCount);
    });

    this.socket.on("room:selectionStart", () => {
      this.onSelectionStart?.();
    });

    this.socket.on("opponent:jutsuSelected", ({ beatmapId, role }: { beatmapId: string; role: string }) => {
      this.onOpponentJutsuSelected?.(beatmapId, role);
    });

    this.socket.on("opponent:ready", () => {
      this.onOpponentReady?.();
    });

    this.socket.on("match:start", (data: MatchStartData) => {
      this.playerCount = data.playerCount ?? 2;
      this.onMatchStart?.(data);
    });

    this.socket.on("opponent:cast", (data: CastData) => {
      this.onOpponentCast?.(data);
    });

    this.socket.on("opponent:progress", (data: ProgressData) => {
      this.onOpponentProgress?.(data);
    });

    this.socket.on("round:over", (data: RoundOverData) => {
      this.onRoundOver?.(data);
    });

    this.socket.on("match:over", ({ winner }: { winner: PlayerRole }) => {
      this.onMatchOver?.(winner);
    });

    this.socket.on("opponent:rematch", () => {
      this.onOpponentRematch?.();
    });

    this.socket.on("opponent:disconnected", () => {
      this.onOpponentDisconnected?.();
    });

    this.socket.on("opponent:frame", (data: ArrayBuffer) => {
      this.onOpponentFrame?.(data);
    });

    this.socket.on("opponent:eliminated", ({ role }: { role: string }) => {
      this.onOpponentEliminated?.(role);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
    this.role = null;
    this.roomCode = null;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  createRoom(): void {
    this.socket?.emit("room:create");
  }

  joinRoom(code: string): void {
    this.socket?.emit("room:join", { code });
  }

  selectJutsu(beatmapId: string): void {
    this.socket?.emit("jutsu:select", { beatmapId });
  }

  setReady(): void {
    this.socket?.emit("player:ready");
  }

  castJutsu(jutsuId: string, damage: number): void {
    this.socket?.emit("jutsu:cast", { jutsuId, damage });
  }

  sendProgress(progress: number, combo: number, hp: number): void {
    this.socket?.emit("progress:update", { progress, combo, hp });
  }

  sendCameraFrame(data: ArrayBuffer): void {
    this.socket?.emit("camera:frame", data);
  }

  sendEliminated(): void {
    this.socket?.emit("player:eliminated");
  }

  reportRoundOver(winner: PlayerRole, p1Wins: number, p2Wins: number): void {
    this.socket?.emit("round:over", { winner, p1Wins, p2Wins });
  }

  reportMatchOver(winner: PlayerRole): void {
    this.socket?.emit("match:over", { winner });
  }

  requestRematch(): void {
    this.socket?.emit("rematch:request");
  }

  acceptRematch(): void {
    this.socket?.emit("rematch:accept");
  }

  clearCallbacks(): void {
    this.onConnected            = null;
    this.onConnectError         = null;
    this.onRoomCreated          = null;
    this.onRoomJoined           = null;
    this.onRoomError            = null;
    this.onOpponentConnected    = null;
    this.onOpponentJutsuSelected= null;
    this.onOpponentReady        = null;
    this.onSelectionStart       = null;
    this.onMatchStart           = null;
    this.onOpponentCast         = null;
    this.onOpponentProgress     = null;
    this.onRoundOver            = null;
    this.onMatchOver            = null;
    this.onOpponentRematch      = null;
    this.onOpponentDisconnected = null;
    this.onOpponentFrame        = null;
    this.onOpponentEliminated   = null;
  }
}

export const network = new NetworkManager();
