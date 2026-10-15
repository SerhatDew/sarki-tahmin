import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type AudioPlayerError,
  type VoiceConnection,
  type VoiceConnectionState,
  type PlayerSubscription
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";

export interface SongAudio {
  play(previewUrl: string): Promise<void>;
  stop(): void;
  destroy(): void;
}

const READINESS_TIMEOUT_MS = 15_000;
const PLAYBACK_START_TIMEOUT_MS = 10_000;
const MAX_PREVIEW_SECONDS = 25;
const MAX_STDERR_DIAGNOSTICS = 2_048;

interface ConnectAttempt {
  connection: VoiceConnection;
  errorReported: boolean;
  promise: Promise<void>;
}

interface FfmpegProcess {
  child: ChildProcess;
  stdout: Readable;
  stderr: Readable;
  started: boolean;
  terminationRequested: boolean;
  errorReported: boolean;
  cleanedUp: boolean;
  stderrDiagnostics: string;
  normalExit: boolean;
  rejectStartup: (reason?: unknown) => void;
  startupFailure: Promise<never>;
  onProcessError: (error: Error) => void;
  onProcessExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStdoutError: (error: Error) => void;
  onStdoutEnd: () => void;
  onStdoutClose: () => void;
  onStderrData: (chunk: Buffer | string) => void;
  onStderrError: (error: Error) => void;

}

function contextualError(context: string, value: unknown): Error {
  const message = value instanceof Error ? value.message : String(value);
  if (message.startsWith(`${context}:`)) {
    return value instanceof Error ? value : new Error(message);
  }
  return new Error(`${context}: ${message}`);
}

function redactDiagnostics(value: string): string {
  const redacted = value
    .replace(/https?:\/\/[^\s"'`<>]+/giu, "[redacted-url]")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length <= MAX_STDERR_DIAGNOSTICS) return redacted;
  return `${redacted.slice(0, MAX_STDERR_DIAGNOSTICS)}...`;
}

function appendDiagnostics(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_STDERR_DIAGNOSTICS) return current;
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return `${current}${text}`.slice(0, MAX_STDERR_DIAGNOSTICS);
}

function diagnosticsSuffix(diagnostics: string): string {
  const redacted = redactDiagnostics(diagnostics);
  return redacted ? ` (ffmpeg: ${redacted})` : "";
}

export class VoicePlayback implements SongAudio {
  private readonly player: AudioPlayer;
  private readonly onError: (error: Error) => void;
  private readonly channel: VoiceChannel;
  private connection: VoiceConnection | undefined;
  private subscription: PlayerSubscription | undefined;
  private connectAttempt: ConnectAttempt | undefined;
  private currentProcess: FfmpegProcess | undefined;
  private playGeneration = 0;
  private destroyed = false;
  private playerErrorReported = false;
  private connectionErrorReported = false;
  private connectionErrorListener: ((error: Error) => void) | undefined;
  private connectionStateListener:
    | ((oldState: VoiceConnectionState, newState: VoiceConnectionState) => void)
    | undefined;
  private readonly onPlayerError = (error: AudioPlayerError): void => {
    const process = this.currentProcess;
    if (process?.terminationRequested) return;

    const actionableError = contextualError("Discord audio player failed", error);
    if (process) {
      if (!process.cleanedUp) {
        this.failProcess(process, actionableError);
        return;
      }
      if (this.playerErrorReported) return;
      this.playerErrorReported = true;
      this.reportError(actionableError);
      return;
    }

    if (!this.playerErrorReported) {
      this.playerErrorReported = true;
      this.reportError(actionableError);
    }
  };

  public constructor(channel: VoiceChannel, onError: (error: Error) => void) {
    this.channel = channel;
    this.onError = onError;
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
    });
    this.player.on("error", this.onPlayerError);
  }

  public async connect(): Promise<void> {
    if (this.destroyed) {
      throw new Error("Voice playback has been destroyed");
    }

    if (this.connection?.state.status === VoiceConnectionStatus.Ready) {
      return;
    }
    if (this.connectAttempt) return this.connectAttempt.promise;
    if (this.connection) this.detachAndDestroyConnection(this.connection);

    let connection: VoiceConnection;
    try {
      connection = joinVoiceChannel({
        channelId: this.channel.id,
        guildId: this.channel.guild.id,
        adapterCreator: this.channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        daveEncryption: true
      });
    } catch (error) {
      const actionableError = contextualError("Could not join the voice channel", error);
      this.reportError(actionableError);
      throw actionableError;
    }

    this.connection = connection;
    this.attachConnectionListeners(connection);

    try {
      const subscription = connection.subscribe(this.player);
      if (!subscription) {
        throw new Error("Discord did not create an audio player subscription");
      }
      this.subscription = subscription;
    } catch (error) {
      const actionableError = contextualError("Could not subscribe the audio player", error);
      this.detachAndDestroyConnection(connection);
      this.reportError(actionableError);
      throw actionableError;
    }

    const attempt: ConnectAttempt = {
      connection,
      errorReported: false,
      promise: Promise.resolve()
    };
    this.connectAttempt = attempt;
    attempt.promise = (async (): Promise<void> => {
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, READINESS_TIMEOUT_MS);
        if (this.destroyed || this.connectAttempt !== attempt || this.connection !== connection) {
          throw new Error("Voice connection was cancelled");
        }
      } catch (error) {
        const cancelled =
          this.destroyed || this.connectAttempt !== attempt || this.connection !== connection;
        const actionableError = cancelled
          ? contextualError("Voice connection was cancelled", error)
          : contextualError("Voice connection was not ready", error);
        if (!cancelled && !attempt.errorReported) {
          attempt.errorReported = true;
          this.reportError(actionableError);
        }
        if (this.connection === connection) {
          this.detachAndDestroyConnection(connection);
        }
        throw actionableError;
      } finally {
        if (this.connectAttempt === attempt) this.connectAttempt = undefined;
      }
    })();

    return attempt.promise;
  }

  public async play(previewUrl: string): Promise<void> {
    if (this.destroyed) {
      throw new Error("Voice playback has been destroyed");
    }

    const connection = this.connection;
    if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
      const error = new Error("Voice playback is not connected");
      this.reportError(error);
      throw error;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(previewUrl);
    } catch (error) {
      const actionableError = contextualError("Preview URL is invalid", error);
      this.reportError(actionableError);
      throw actionableError;
    }
    if (parsedUrl.protocol !== "https:") {
      const error = new Error("Preview URL must use HTTPS");
      this.reportError(error);
      throw error;
    }

    const generation = ++this.playGeneration;
    this.stopCurrentAudio();

    let process: FfmpegProcess;
    try {
      process = this.startFfmpeg(previewUrl);
    } catch (error) {
      const actionableError = contextualError("Could not start ffmpeg", error);
      this.reportError(actionableError);
      throw actionableError;
    }
    this.currentProcess = process;

    try {
      const resource = createAudioResource(process.stdout, {
        inputType: StreamType.OggOpus
      });
      if (!this.isCurrentPlayback(generation, process)) {
        throw new Error("Voice playback was cancelled");
      }

      this.player.play(resource);
      await Promise.race([
        entersState(this.player, AudioPlayerStatus.Playing, PLAYBACK_START_TIMEOUT_MS),
        process.startupFailure
      ]);

      if (!this.isCurrentPlayback(generation, process) || this.destroyed) {
        throw new Error("Voice playback was cancelled");
      }
      process.started = true;
    } catch (error) {
      const cancelled =
        this.destroyed ||
        process.terminationRequested ||
        !this.isCurrentPlayback(generation, process);
      const actionableError = cancelled
        ? contextualError("Voice playback was cancelled", error)
        : contextualError("Voice playback did not start", error);
      if (!cancelled && !process.errorReported) {
        process.errorReported = true;
        this.reportError(actionableError);
      }
      process.terminationRequested = true;
      this.cleanupProcess(process, true);
      if (this.currentProcess === process) this.currentProcess = undefined;
      throw actionableError;
    }
  }

  public stop(): void {
    if (this.destroyed) return;
    this.playGeneration += 1;
    this.stopCurrentAudio();

    const attempt = this.connectAttempt;
    if (attempt && this.connection === attempt.connection) {
      this.connectAttempt = undefined;
      this.detachAndDestroyConnection(attempt.connection);
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playGeneration += 1;
    this.stopCurrentAudio();

    const connection = this.connection;
    this.connectAttempt = undefined;
    this.connection = undefined;
    if (this.subscription) {
      try {
        this.subscription.unsubscribe();
      } catch (error) {
        this.reportError(contextualError("Could not unsubscribe the voice player", error));
      }
      this.subscription = undefined;
    }
    if (connection) {
      this.removeConnectionListeners(connection);
      try {
        connection.destroy();
      } catch (error) {
        this.reportError(contextualError("Could not destroy the voice connection", error));
      }
    }

    this.player.removeListener("error", this.onPlayerError);
    this.player.stop(true);
  }

  private startFfmpeg(previewUrl: string): FfmpegProcess {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        previewUrl,
        "-t",
        String(MAX_PREVIEW_SECONDS),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-f",
        "ogg",
        "pipe:1"
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      stdout?.destroy();
      stderr?.destroy();
      try {
        child.kill("SIGTERM");
      } catch {
        // There is no process stream to clean up further.
      }
      throw new Error("ffmpeg did not provide stdout and stderr pipes");
    }

    let rejectStartup!: (reason?: unknown) => void;
    const startupFailure = new Promise<never>((_, reject) => {
      rejectStartup = reject;
    });
    startupFailure.catch(() => undefined);

    const processRecord = {} as FfmpegProcess;
    processRecord.child = child;
    processRecord.stdout = stdout;
    processRecord.stderr = stderr;
    processRecord.started = false;
    processRecord.terminationRequested = false;
    processRecord.errorReported = false;
    processRecord.cleanedUp = false;
    processRecord.stderrDiagnostics = "";
    processRecord.normalExit = false;
    processRecord.rejectStartup = rejectStartup;
    processRecord.startupFailure = startupFailure;
    processRecord.onProcessError = (error: Error): void => {
      if (processRecord.cleanedUp || processRecord.terminationRequested) return;
      this.failProcess(processRecord, contextualError("ffmpeg process failed", error));
    };
    processRecord.onProcessExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (processRecord.cleanedUp || processRecord.terminationRequested) return;
      if (code === 0) {
        processRecord.normalExit = true;
        processRecord.child.removeListener("error", processRecord.onProcessError);
        processRecord.child.removeListener("exit", processRecord.onProcessExit);
        processRecord.stderr.removeListener("data", processRecord.onStderrData);
        processRecord.stderr.removeListener("error", processRecord.onStderrError);
        processRecord.stderr.destroy();
        if (processRecord.stdout.readableEnded || processRecord.stdout.destroyed) {
          this.cleanupProcess(processRecord, false);
        }
        return;
      }

      const status = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.failProcess(
        processRecord,
        new Error(`ffmpeg exited with ${status}${diagnosticsSuffix(processRecord.stderrDiagnostics)}`)
      );
    };
    processRecord.onStdoutError = (error: Error): void => {
      if (processRecord.cleanedUp || processRecord.terminationRequested) return;
      this.failProcess(processRecord, contextualError("ffmpeg output stream failed", error));
    };
    processRecord.onStdoutEnd = (): void => {
      if (processRecord.normalExit) this.cleanupProcess(processRecord, false);
    };
    processRecord.onStdoutClose = (): void => {
      if (processRecord.normalExit) this.cleanupProcess(processRecord, false);
    };
    processRecord.onStderrData = (chunk: Buffer | string): void => {
      processRecord.stderrDiagnostics = appendDiagnostics(processRecord.stderrDiagnostics, chunk);
    };
    processRecord.onStderrError = (error: Error): void => {
      if (processRecord.cleanedUp || processRecord.terminationRequested) return;
      this.failProcess(processRecord, contextualError("ffmpeg diagnostics stream failed", error));
    };

    child.once("error", processRecord.onProcessError);
    child.once("exit", processRecord.onProcessExit);
    stdout.on("error", processRecord.onStdoutError);
    stdout.once("end", processRecord.onStdoutEnd);
    stdout.once("close", processRecord.onStdoutClose);
    stderr.on("data", processRecord.onStderrData);
    stderr.on("error", processRecord.onStderrError);
    return processRecord;
  }

  private failProcess(processRecord: FfmpegProcess, error: Error): void {
    if (processRecord.cleanedUp || processRecord.terminationRequested) return;
    const wasStarted = processRecord.started;
    if (!processRecord.errorReported) {
      processRecord.errorReported = true;
      this.reportError(error);
    }
    if (!wasStarted) processRecord.rejectStartup(error);
    if (this.currentProcess === processRecord) {
      processRecord.terminationRequested = true;
      this.player.stop(true);
      this.currentProcess = undefined;
    }
    this.cleanupProcess(processRecord, true);
  }

  private stopCurrentAudio(): void {
    const processRecord = this.currentProcess;
    if (processRecord) processRecord.terminationRequested = true;
    this.player.stop(true);
    if (processRecord) {
      this.cleanupProcess(processRecord, true);
      this.currentProcess = undefined;
    }
  }

  private cleanupProcess(processRecord: FfmpegProcess, terminateOutput: boolean): void {
    if (processRecord.cleanedUp) return;
    processRecord.cleanedUp = true;
    if (terminateOutput) {
      processRecord.terminationRequested = true;
      if (!processRecord.child.killed && processRecord.child.exitCode === null) {
        try {
          processRecord.child.kill("SIGTERM");
        } catch {
          // The process may have exited between the state check and kill.
        }
      }
      processRecord.stdout.destroy();
    }
    processRecord.stderr.destroy();

    processRecord.child.removeListener("error", processRecord.onProcessError);
    processRecord.child.removeListener("exit", processRecord.onProcessExit);
    processRecord.stdout.removeListener("error", processRecord.onStdoutError);
    processRecord.stdout.removeListener("end", processRecord.onStdoutEnd);
    processRecord.stdout.removeListener("close", processRecord.onStdoutClose);
    processRecord.stderr.removeListener("data", processRecord.onStderrData);
    processRecord.stderr.removeListener("error", processRecord.onStderrError);
  }

  private isCurrentPlayback(id: number, processRecord: FfmpegProcess): boolean {
    return !this.destroyed && this.playGeneration === id && this.currentProcess === processRecord;
  }

  private attachConnectionListeners(connection: VoiceConnection): void {
    const onError = (error: Error): void => {
      if (this.destroyed || this.connection !== connection) return;
      const actionableError = contextualError("Discord voice connection failed", error);
      this.reportConnectionError(connection, actionableError);
      this.stopCurrentAudio();
      this.detachAndDestroyConnection(connection);
    };
    const onStateChange = (
      _oldState: VoiceConnectionState,
      newState: VoiceConnectionState
    ): void => {
      if (this.connection !== connection) return;
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        const reason = "reason" in newState ? ` (${String(newState.reason)})` : "";
        const error = new Error(`Discord voice connection disconnected${reason}`);
        this.reportConnectionError(connection, error);
        this.stopCurrentAudio();
        this.detachAndDestroyConnection(connection);
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.stopCurrentAudio();
        this.detachAndDestroyConnection(connection);
      }
    };

    this.connectionErrorReported = false;
    this.connectionErrorListener = onError;
    this.connectionStateListener = onStateChange;
    connection.on("error", onError);
    connection.on("stateChange", onStateChange);
  }

  private reportConnectionError(connection: VoiceConnection, error: Error): void {
    const attempt = this.connectAttempt;
    if (attempt?.connection === connection) attempt.errorReported = true;
    if (this.connectionErrorReported) return;
    this.connectionErrorReported = true;
    this.reportError(error);
  }

  private removeConnectionListeners(connection: VoiceConnection): void {
    if (this.connectionErrorListener) {
      connection.removeListener("error", this.connectionErrorListener);
    }
    if (this.connectionStateListener) {
      connection.removeListener("stateChange", this.connectionStateListener);
    }
    this.connectionErrorListener = undefined;
    this.connectionStateListener = undefined;
  }


  private detachAndDestroyConnection(connection: VoiceConnection): void {
    if (this.connection === connection) this.connection = undefined;
    if (this.connectAttempt?.connection === connection) this.connectAttempt = undefined;
    if (this.subscription?.connection === connection) {
      try {
        this.subscription.unsubscribe();
      } catch {
        // The connection is already being destroyed.
      }
      this.subscription = undefined;
    }
    this.removeConnectionListeners(connection);
    try {
      connection.destroy();
    } catch (error) {
      this.reportError(contextualError("Could not destroy the voice connection", error));
    }
  }

  private reportError(error: Error): void {
    try {
      this.onError(error);
    } catch {
      // Error reporting must not become an unhandled event-emitter rejection.
    }
  }
}
