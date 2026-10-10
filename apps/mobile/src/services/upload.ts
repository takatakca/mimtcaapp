// Uploads a local file (photo or greeting) straight to private storage with a signed URL from the API.
// No storage key is ever on the device: the URL is single-use, for one path, and expires.
import type { MediaPurpose } from "@mimt/shared";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { uploadProblem } from "../lib/media";

export async function uploadMedia(purpose: MediaPurpose, uri: string, contentType: string): Promise<string> {
  const file = await (await fetch(uri)).blob();
  const problem = uploadProblem(purpose, contentType, file.size);
  if (problem) throw new ApiClientError(400, "invalid_media", problem, "file rejected before upload");
  const slot = await api.createUpload({ purpose, contentType, sizeBytes: file.size });
  let res: Response;
  try {
    res = await fetch(slot.uploadUrl, { method: slot.uploadMethod, headers: slot.uploadHeaders, body: file });
  } catch (e) {
    throw new ApiClientError(null, "network", "error.network", e instanceof Error ? e.message : "upload failed");
  }
  if (!res.ok) throw new ApiClientError(res.status, "upload_failed", res.status === 413 ? "error.mediaTooLarge" : "error.server", `upload HTTP ${res.status}`);
  return slot.mediaId;
}
