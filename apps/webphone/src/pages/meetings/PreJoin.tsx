// Before joining: camera preview, mic/camera on or off, device choice and (guests) a display name.
// Plain getUserMedia: LiveKit is only loaded once the person joins (Room.tsx is lazy).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../components/Icon";
import { Field } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";

export interface JoinChoices {
  name: string;
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

const hasMedia = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

export function PreJoin({ askName, initialName = "", busy, onJoin }: { askName: boolean; initialName?: string; busy: boolean; onJoin: (c: JoinChoices) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState<string>("");
  const [cam, setCam] = useState<string>("");
  const [previewFailed, setPreviewFailed] = useState(!hasMedia());
  const videoRef = useRef<HTMLVideoElement>(null);

  // Camera preview (and permission, so devices get their labels).
  useEffect(() => {
    if (!video || !hasMedia()) return;
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: cam ? { deviceId: { exact: cam } } : true, audio: false })
      .then(async (s) => {
        if (!alive) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        setPreviewFailed(false);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => undefined);
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMics(devices.filter((d) => d.kind === "audioinput"));
        setCams(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => alive && setPreviewFailed(true));
    return () => {
      alive = false;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [video, cam]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (askName && !name.trim()) return setNameError(t("meet.pre.nameRequired"));
    setNameError(null);
    onJoin({ name: name.trim(), audio, video, ...(mic ? { audioDeviceId: mic } : {}), ...(cam ? { videoDeviceId: cam } : {}) });
  };

  const label = (d: MediaDeviceInfo, i: number) => d.label || t("meet.device.unnamed", { n: i + 1 });

  return (
    <form className="prejoin" onSubmit={submit} noValidate>
      <div className="prejoin__preview">
        {video && !previewFailed ? <video ref={videoRef} className="prejoin__video" aria-label={t("meet.pre.preview")} muted playsInline autoPlay /> : null}
        {!video || previewFailed ? (
          <div className="prejoin__placeholder">
            <Icon name={video ? "video" : "videoOff"} size={40} />
            <span>{video ? t("meet.pre.noPreview") : t("meet.pre.cameraOff")}</span>
          </div>
        ) : null}
        <div className="prejoin__toggles">
          <button type="button" className={`meet-btn${audio ? "" : " is-off"}`} aria-pressed={!audio} aria-label={audio ? t("meet.mic.on") : t("meet.mic.off")} onClick={() => setAudio((a) => !a)}>
            <Icon name={audio ? "mic" : "micOff"} />
          </button>
          <button type="button" className={`meet-btn${video ? "" : " is-off"}`} aria-pressed={!video} aria-label={video ? t("meet.cam.on") : t("meet.cam.off")} onClick={() => setVideo((v) => !v)}>
            <Icon name={video ? "video" : "videoOff"} />
          </button>
        </div>
      </div>
      <div className="prejoin__side">
        <h2 className="card__title">{t("meet.pre.title")}</h2>
        {askName ? (
          <Field id="pre-name" label={t("meet.pre.name")} hint={t("meet.pre.nameHint")} error={nameError}>
            <input id="pre-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        ) : null}
        {mics.length > 0 ? (
          <Field id="pre-mic" label={t("meet.device.mic")}>
            <select id="pre-mic" className="input" value={mic} onChange={(e) => setMic(e.target.value)}>
              <option value="">{t("meet.device.default")}</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {label(d, i)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {cams.length > 0 ? (
          <Field id="pre-cam" label={t("meet.device.camera")}>
            <select id="pre-cam" className="input" value={cam} onChange={(e) => setCam(e.target.value)}>
              <option value="">{t("meet.device.default")}</option>
              {cams.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {label(d, i)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {previewFailed ? <p className="muted small">{t("meet.pre.permission")}</p> : null}
        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
          {busy ? t("meet.pre.joining") : t("meet.pre.join")}
        </button>
      </div>
    </form>
  );
}
