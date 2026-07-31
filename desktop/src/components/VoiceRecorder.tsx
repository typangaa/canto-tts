// src/components/VoiceRecorder.tsx — Cross-Platform Voice Recorder with Web Audio PCM Fallback

import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Play, Pause, RotateCcw, Check, BookOpen, RefreshCw, ShieldAlert, HelpCircle } from "lucide-react";
import { audioBufferToWav, recordingBlobToWavFile } from "../utils/audioExporter";

interface VoiceRecorderProps {
  onRecordingComplete: (file: File, url: string) => void;
  onCancel?: () => void;
}

const GUIDED_PASSAGES = [
  {
    title: "日常生活 (Daily Life)",
    text: "「今日天氣真係好好，我哋一齊去公園行下，睇下花同樹，然後再去食個下午茶。」",
  },
  {
    title: "新聞播報 (News Broadcast)",
    text: "「各位觀眾你哋好，歡迎收睇今日嘅新聞報導，以下係最新消息。」",
  },
  {
    title: "故事講述 (Storytelling)",
    text: "「好耐好耐以前，有一個細路仔住喺山腳下面，佢每日都會行上山頂睇日出。」",
  },
];

function getSupportedMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
    "audio/mp4",
    "audio/aac",
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
  }
  return undefined;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onRecordingComplete }) => {
  const [passageIndex, setPassageIndex] = useState<number>(0);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<"granted" | "prompt" | "denied" | "unknown">("unknown");
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showPermModal, setShowPermModal] = useState<boolean>(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const prevRecordedUrlRef = useRef<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlayPreview = () => {
    if (!previewAudioRef.current || !recordedUrl) return;
    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current
        .play()
        .then(() => setIsPlayingPreview(true))
        .catch((err) => {
          console.error("Preview audio playback failed:", err);
          setIsPlayingPreview(false);
        });
    }
  };

  // Web Audio PCM Fallback Refs
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isPcmFallbackRef = useRef<boolean>(false);

  // Check initial permission status if browser API supports it
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((res) => {
          setPermissionStatus(res.state as "granted" | "prompt" | "denied");
          res.onchange = () => {
            setPermissionStatus(res.state as "granted" | "prompt" | "denied");
          };
        })
        .catch(() => {
          setPermissionStatus("unknown");
        });
    }

    return () => {
      if (prevRecordedUrlRef.current) {
        URL.revokeObjectURL(prevRecordedUrlRef.current);
      }
      stopRecordingCleanup();
    };
  }, []);

  const stopRecordingCleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const requestMicrophoneStream = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  };

  const handleStartRecordingClick = () => {
    if (permissionStatus === "granted") {
      startRecording();
    } else {
      setShowPermModal(true);
    }
  };

  const handleConfirmGrantPermission = () => {
    setShowPermModal(false);
    startRecording();
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setRecordedBlob(null);
    if (prevRecordedUrlRef.current) {
      URL.revokeObjectURL(prevRecordedUrlRef.current);
      prevRecordedUrlRef.current = null;
    }
    setRecordedUrl(null);
    setDuration(0);
    setAudioLevel(0);
    chunksRef.current = [];
    pcmChunksRef.current = [];
    isPcmFallbackRef.current = false;

    try {
      const stream = await requestMicrophoneStream();
      mediaStreamRef.current = stream;
      setPermissionStatus("granted");

      // Audio Context for processing
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = audioCtx;

      // Probe MediaRecorder support with safe fallback to Web Audio PCM
      let recorderStarted = false;
      const preferredMime = getSupportedMimeType();

      if (typeof MediaRecorder !== "undefined") {
        try {
          const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const pcmData = new Float32Array(analyser.fftSize);
          const updateLevel = () => {
            analyser.getFloatTimeDomainData(pcmData);
            let sumSquares = 0;
            for (let i = 0; i < pcmData.length; i++) {
              sumSquares += pcmData[i] * pcmData[i];
            }
            const rms = Math.sqrt(sumSquares / pcmData.length);
            setAudioLevel(Math.min(1, rms * 5));
            animFrameRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              chunksRef.current.push(e.data);
            }
          };

          recorder.onstop = async () => {
            const finalType = recorder.mimeType || preferredMime || "audio/webm";
            const rawBlob = new Blob(chunksRef.current, { type: finalType });
            try {
              const wavFile = await recordingBlobToWavFile(rawBlob, "recording.wav");
              setRecordedBlob(wavFile);
              const url = URL.createObjectURL(wavFile);
              prevRecordedUrlRef.current = url;
              setRecordedUrl(url);
            } catch {
              setRecordedBlob(rawBlob);
              const url = URL.createObjectURL(rawBlob);
              prevRecordedUrlRef.current = url;
              setRecordedUrl(url);
            }
          };

          recorder.start(100);
          recorderStarted = true;
        } catch (mrErr) {
          console.warn("MediaRecorder start failed, falling back to Web Audio PCM recorder:", mrErr);
          mediaRecorderRef.current = null;
          recorderStarted = false;
        }
      }

      if (!recorderStarted) {
        // Path B: Web Audio PCM Recorder Fallback for unsupported MediaRecorder
        isPcmFallbackRef.current = true;

        const source = audioCtx.createMediaStreamSource(stream);
        const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptNodeRef.current = scriptNode;

        scriptNode.onaudioprocess = (e) => {
          const inputBuffer = e.inputBuffer.getChannelData(0);
          pcmChunksRef.current.push(new Float32Array(inputBuffer));

          let sumSquares = 0;
          for (let i = 0; i < inputBuffer.length; i++) {
            sumSquares += inputBuffer[i] * inputBuffer[i];
          }
          const rms = Math.sqrt(sumSquares / inputBuffer.length);
          setAudioLevel(Math.min(1, rms * 5));
        };

        source.connect(scriptNode);
        scriptNode.connect(audioCtx.destination);
      }

      setIsRecording(true);

      // Duration Timer
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setDuration(elapsed);
        if (elapsed >= 15) {
          stopRecording();
        }
      }, 200);
    } catch (err: unknown) {
      stopRecordingCleanup();
      setIsRecording(false);

      const errName = err instanceof Error ? err.name : "";
      const msg = err instanceof Error ? err.message : String(err);

      if (errName === "NotAllowedError" || errName === "PermissionDeniedError" || msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
        setPermissionStatus("denied");
        setErrorMessage("無法取得麥克風存取權限。系統或瀏覽器已拒絕麥克風存取。");
      } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        setErrorMessage("未檢測到麥克風裝置。請確認麥克風已連接至電腦。");
      } else if (errName === "NotReadableError" || errName === "TrackStartError") {
        setErrorMessage("麥克風正被其他應用程式佔用（如 Zoom / Teams），請關閉後重試。");
      } else {
        setErrorMessage(`麥克風啟動失敗: ${msg}`);
      }
    }
  };

  const stopRecording = () => {
    if (isPcmFallbackRef.current && pcmChunksRef.current.length > 0 && audioCtxRef.current) {
      // Encode PCM chunks directly into WAV Blob
      const totalSamples = pcmChunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
      if (totalSamples > 0) {
        const mergedPCM = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of pcmChunksRef.current) {
          mergedPCM.set(chunk, offset);
          offset += chunk.length;
        }

        const sampleRate = audioCtxRef.current.sampleRate;
        const audioBuffer = audioCtxRef.current.createBuffer(1, totalSamples, sampleRate);
        audioBuffer.copyToChannel(mergedPCM, 0);

        const wavBlob = audioBufferToWav(audioBuffer);
        setRecordedBlob(wavBlob);
        const url = URL.createObjectURL(wavBlob);
        prevRecordedUrlRef.current = url;
        setRecordedUrl(url);
      }
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    stopRecordingCleanup();
    setIsRecording(false);
  };

  const handleUseRecording = async () => {
    if (!recordedBlob || isConverting) return;
    setIsConverting(true);
    setErrorMessage(null);
    try {
      const wavFile = await recordingBlobToWavFile(recordedBlob, "recording.wav");
      const wavUrl = URL.createObjectURL(wavFile);
      onRecordingComplete(wavFile, wavUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`錄音檔轉換失敗: ${msg}`);
    } finally {
      setIsConverting(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Passage Card */}
      <div style={{
        padding: "10px 14px",
        borderRadius: 6,
        background: "rgba(0, 242, 254, 0.05)",
        border: "1px solid rgba(0, 242, 254, 0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 600, color: "#00f2fe" }}>
            <BookOpen size={14} /> 請朗讀以下段落 ({GUIDED_PASSAGES[passageIndex].title})：
          </div>
          <button
            type="button"
            onClick={() => setPassageIndex((prev) => (prev + 1) % GUIDED_PASSAGES.length)}
            disabled={isRecording}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "0.75rem",
              cursor: isRecording ? "not-allowed" : "pointer",
              textDecoration: "underline",
            }}
          >
            換一段文字
          </button>
        </div>
        <p style={{ fontSize: "0.9rem", lineHeight: 1.5, color: "#fff", margin: 0, fontWeight: 500 }}>
          {GUIDED_PASSAGES[passageIndex].text}
        </p>
      </div>

      {/* Recording Area */}
      {!recordedBlob ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0" }}>
          {/* Level Meter & Timer */}
          {isRecording && (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#00f2fe", fontFamily: "monospace" }}>
                ⏱️ {formatTime(duration)} / 00:15
              </div>
              <div style={{
                width: "80%",
                height: 8,
                borderRadius: 4,
                background: "rgba(255, 255, 255, 0.1)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.round(audioLevel * 100)}%`,
                  background: "linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)",
                  transition: "width 0.05s ease",
                }} />
              </div>
              <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                {duration < 3 ? "請最少朗讀 3 秒..." : "可點擊下方按鈕停止錄音"}
              </span>
            </div>
          )}

          {!isRecording ? (
            <button
              type="button"
              onClick={handleStartRecordingClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                borderRadius: 24,
                background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                color: "#000",
                fontWeight: 700,
                fontSize: "0.9rem",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 0 14px rgba(0, 242, 254, 0.4)",
              }}
            >
              <Mic size={18} /> 開始錄音 (Start Recording)
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              disabled={duration < 3}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                borderRadius: 24,
                background: duration < 3 ? "rgba(255, 255, 255, 0.2)" : "#ff4d4f",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.9rem",
                border: "none",
                cursor: duration < 3 ? "not-allowed" : "pointer",
                boxShadow: duration >= 3 ? "0 0 14px rgba(255, 77, 79, 0.4)" : "none",
              }}
            >
              <Square size={16} /> 停止錄音 (Stop Recording)
            </button>
          )}
        </div>
      ) : (
        /* Recorded Preview & Actions */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(0, 242, 254, 0.08)",
            border: "1px solid rgba(0, 242, 254, 0.25)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
              <button
                type="button"
                onClick={togglePlayPreview}
                title={isPlayingPreview ? "暫停試聽" : "播放試聽"}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: isPlayingPreview ? "#ff4d4f" : "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                  border: "none",
                  color: isPlayingPreview ? "#fff" : "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: isPlayingPreview ? "0 0 12px rgba(255, 77, 79, 0.4)" : "0 0 12px rgba(0, 242, 254, 0.4)",
                }}
              >
                {isPlayingPreview ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
              </button>

              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>
                  錄音試聽 ({duration} 秒)
                </span>
                <span style={{ fontSize: "0.75rem", color: isPlayingPreview ? "#00f2fe" : "rgba(255, 255, 255, 0.6)" }}>
                  {isPlayingPreview ? "▶ 正在播放..." : "點擊左側按鈕試聽錄音"}
                </span>
              </div>
            </div>

            <audio
              ref={previewAudioRef}
              src={recordedUrl || undefined}
              onEnded={() => setIsPlayingPreview(false)}
              onPause={() => setIsPlayingPreview(false)}
              onPlay={() => setIsPlayingPreview(true)}
              style={{ display: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={startRecording}
              disabled={isConverting}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={15} /> 重新錄音
            </button>

            <button
              type="button"
              onClick={handleUseRecording}
              disabled={isConverting}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 6,
                background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                color: "#000",
                fontSize: "0.85rem",
                fontWeight: 700,
                border: "none",
                cursor: isConverting ? "not-allowed" : "pointer",
                opacity: isConverting ? 0.7 : 1,
              }}
            >
              {isConverting ? <RefreshCw size={15} className="spin-icon" /> : <Check size={15} />}
              使用此錄音
            </button>
          </div>
        </div>
      )}

      {/* Permission Denied & Error Diagnostics Box */}
      {(errorMessage || permissionStatus === "denied") && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: "0.8rem",
          color: "#ff4d4f",
          background: "rgba(255, 77, 79, 0.08)",
          padding: "10px 12px",
          borderRadius: 6,
          border: "1px solid rgba(255, 77, 79, 0.25)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: "0.85rem" }}>
            <ShieldAlert size={16} />
            <span>{errorMessage || "無法存取麥克風，請檢查權限設定。"}</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button
              type="button"
              onClick={startRecording}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                background: "rgba(255, 77, 79, 0.2)",
                border: "1px solid rgba(255, 77, 79, 0.4)",
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              重新要求權限 (Retry)
            </button>

            <button
              type="button"
              onClick={() => setShowHelp((prev) => !prev)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.7)",
                fontSize: "0.75rem",
                cursor: "pointer",
                textDecoration: "underline",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <HelpCircle size={13} /> 如何允許權限？
            </button>
          </div>

          {showHelp && (
            <div style={{
              marginTop: 6,
              paddingTop: 8,
              borderTop: "1px solid rgba(255, 77, 79, 0.2)",
              color: "rgba(255, 255, 255, 0.85)",
              lineHeight: 1.5,
              fontSize: "0.75rem",
            }}>
              <strong>系統麥克風權限開啓步驟：</strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                <li><strong>macOS:</strong> 系統設定 → 隱私權與安全性 → 麥克風 → 勾選 CantoTTS</li>
                <li><strong>Windows:</strong> 設定 → 隱私權與安全性 → 麥克風 → 開啟「允許應用程式存取麥克風」</li>
                <li><strong>Linux:</strong> 確認 PulseAudio / PipeWire 音訊設定中麥克風未被靜音</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Microphone Permission Request Modal */}
      {showPermModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            width: 420,
            maxWidth: "90vw",
            background: "#161b22",
            border: "1px solid rgba(0, 242, 254, 0.3)",
            borderRadius: 12,
            padding: "24px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
          }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(0, 242, 254, 0.15)",
              border: "1px solid rgba(0, 242, 254, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}>
              <Mic size={26} color="#00f2fe" />
            </div>

            <h3 style={{ margin: "0 0 8px 0", fontSize: "1.1rem", fontWeight: 700, color: "#fff" }}>
              授權使用麥克風
            </h3>

            <p style={{ margin: "0 0 16px 0", fontSize: "0.85rem", color: "rgba(255, 255, 255, 0.8)", lineHeight: 1.5 }}>
              CantoTTS 需要存取你嘅麥克風以錄製廣東話參考音訊並進行聲音克隆。
            </p>

            <div style={{
              fontSize: "0.75rem",
              color: "#00f2fe",
              background: "rgba(0, 242, 254, 0.08)",
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 20,
              width: "100%",
              boxSizing: "border-box",
            }}>
              🔒 你的錄音僅於本機記憶體處理，絕不上傳網絡。
            </div>

            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button
                type="button"
                onClick={() => setShowPermModal(false)}
                style={{
                  flex: 1,
                  padding: "9px 14px",
                  borderRadius: 6,
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                取消
              </button>

              <button
                type="button"
                onClick={handleConfirmGrantPermission}
                style={{
                  flex: 1,
                  padding: "9px 14px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                🎤 允許使用麥克風
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
