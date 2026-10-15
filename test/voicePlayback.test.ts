import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as childProcess from "node:child_process";
import * as voiceApi from "@discordjs/voice";
import { afterAll, afterEach, expect, mock, spyOn, test, type Mock } from "bun:test";
import { VoicePlayback } from "../src/voicePlayback";

type ChildKill = Mock<() => boolean>;
type Unsubscribe = Mock<() => void>;
type DestroyConnection = Mock<() => void>;
type PlayerPlay = Mock<(_resource: unknown) => void>;
type PlayerStop = Mock<() => boolean>;

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  exitCode: number | null;
  kill: ChildKill;
};

type FakeConnection = EventEmitter & {
  id: string;
  state: { status: string };
  subscribe: Mock<() => FakeSubscription>;
  destroy: DestroyConnection;
};

type FakeSubscription = {
  connection: FakeConnection;
  unsubscribe: Unsubscribe;
};

const spawnMock = spyOn(childProcess, "spawn");
const joinVoiceChannelMock = spyOn(voiceApi, "joinVoiceChannel");
const createAudioPlayerMock = spyOn(voiceApi, "createAudioPlayer");
const createAudioResourceMock = spyOn(voiceApi, "createAudioResource").mockImplementation(
  ((stream: unknown, options: unknown) => ({ stream, options }) as never)
);
const entersStateMock = spyOn(voiceApi, "entersState");

const voiceStatuses = {
  Ready: voiceApi.VoiceConnectionStatus.Ready,
  Destroyed: voiceApi.VoiceConnectionStatus.Destroyed
} as const;
const audioStatuses = {
  Playing: voiceApi.AudioPlayerStatus.Playing,
  Idle: voiceApi.AudioPlayerStatus.Idle
} as const;

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = mock(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function createConnection(): FakeConnection {
  const connection = new EventEmitter() as FakeConnection;
  connection.id = `connection-${joinVoiceChannelMock.mock.calls.length + 1}`;
  connection.state = { status: voiceStatuses.Ready };
  const subscription: FakeSubscription = {
    connection,
    unsubscribe: mock(() => {})
  };
  connection.subscribe = mock(() => subscription);
  connection.destroy = mock(() => {
    connection.state = { status: voiceStatuses.Destroyed };
  });
  return connection;
}

function createPlayer() {
  const player = new EventEmitter() as EventEmitter & {
    state: { status: string };
    play: PlayerPlay;
    stop: PlayerStop;
  };
  player.state = { status: audioStatuses.Idle };
  player.play = mock((_resource: unknown) => {
    player.state = { status: audioStatuses.Playing };
  });
  player.stop = mock(() => {
    player.state = { status: audioStatuses.Idle };
    return true;
  });
  return player;
}

function createChannel() {
  return {
    id: "voice-channel",
    guild: {
      id: "guild-id",
      voiceAdapterCreator: () => ({ destroy() {}, sendPayload() { return true; } })
    }
  } as never;
}

let activePlayback: VoicePlayback | undefined;

function resetMocks(): void {
  spawnMock.mockClear();
  joinVoiceChannelMock.mockClear();
  createAudioPlayerMock.mockClear();
  createAudioResourceMock.mockClear();
  entersStateMock.mockClear();
  activePlayback = undefined;
}

afterEach(() => {
  activePlayback?.destroy();
  resetMocks();
});

afterAll(() => {
  mock.restore();
});


test("drains normal ffmpeg exit instead of destroying buffered stdout", async () => {
  const child = createChild();
  const connection = createConnection();
  const player = createPlayer();
  spawnMock.mockReturnValue(child as never);
  joinVoiceChannelMock.mockReturnValue(connection as never);
  createAudioPlayerMock.mockReturnValue(player as never);
  entersStateMock.mockImplementation((async (...args: unknown[]) => args[0]) as never);

  activePlayback = new VoicePlayback(createChannel(), () => {});
  await activePlayback.connect();
  await activePlayback.play("https://preview.example.test/song.mp3");
  child.emit("exit", 0, null);

  expect(child.stdout.destroyed).toBe(false);
  activePlayback.stop();
  expect(child.stdout.destroyed).toBe(true);
});

test("stops a pending connection and prevents a later ready state from resurrecting it", async () => {
  const connection = createConnection();
  const player = createPlayer();
  const ready = Promise.withResolvers<unknown>();
  spawnMock.mockImplementation(() => createChild() as never);
  joinVoiceChannelMock.mockReturnValue(connection as never);
  createAudioPlayerMock.mockReturnValue(player as never);
  entersStateMock.mockImplementation((async (...args: unknown[]) => {
    const target = args[0];
    const status = args[1];
    if (status === voiceStatuses.Ready) return ready.promise;
    return target;
  }) as never);

  const errors: Error[] = [];
  activePlayback = new VoicePlayback(createChannel(), error => errors.push(error));
  const connecting = activePlayback.connect();
  activePlayback.stop();
  ready.reject(new Error("connection was destroyed"));

  await expect(connecting).rejects.toThrow();
  expect(connection.destroy).toHaveBeenCalledTimes(1);
  expect(errors).toHaveLength(0);
});

test("cancels pending playback and destroys ffmpeg pipes without reporting cancellation", async () => {
  const child = createChild();
  const connection = createConnection();
  const player = createPlayer();
  const playing = Promise.withResolvers<unknown>();
  spawnMock.mockReturnValue(child as never);
  joinVoiceChannelMock.mockReturnValue(connection as never);
  createAudioPlayerMock.mockReturnValue(player as never);
  entersStateMock.mockImplementation((async (...args: unknown[]) => {
    const target = args[0];
    const status = args[1];
    if (status === audioStatuses.Playing) return playing.promise;
    return target;
  }) as never);

  const errors: Error[] = [];
  activePlayback = new VoicePlayback(createChannel(), error => errors.push(error));
  await activePlayback.connect();
  const playback = activePlayback.play("https://preview.example.test/song.mp3");
  await Promise.resolve();
  activePlayback.stop();
  playing.resolve(player);

  await expect(playback).rejects.toThrow("cancelled");
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(errors).toHaveLength(0);
});

test("reports one ffmpeg failure and removes process listeners", async () => {
  const child = createChild();
  const connection = createConnection();
  const player = createPlayer();
  spawnMock.mockReturnValue(child as never);
  joinVoiceChannelMock.mockReturnValue(connection as never);
  createAudioPlayerMock.mockReturnValue(player as never);
  entersStateMock.mockImplementation((async (...args: unknown[]) => {
    const target = args[0];
    const status = args[1];
    if (status === audioStatuses.Playing) return Promise.withResolvers<unknown>().promise;
    return target;
  }) as never);

  const errors: Error[] = [];
  activePlayback = new VoicePlayback(createChannel(), error => errors.push(error));
  await activePlayback.connect();
  const playback = activePlayback.play("https://preview.example.test/song.mp3");
  child.stderr.emit("data", "unable to open https://secret.example.test/token");
  child.emit("error", new Error("spawn failed"));

  await expect(playback).rejects.toThrow("ffmpeg process failed");
  child.emit("exit", 1, null);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).not.toContain("secret.example.test");
  expect(child.listenerCount("error")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
});
