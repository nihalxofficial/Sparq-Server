import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { ApiError } from "../../utils/apiError";
import * as fileService from "./file.service";
import { uploadFileSchema } from "./file.validator";
import { fileSignature } from "./file.access";
import {
  describeSizeLimit,
  isAllowedFileType,
  isInlineFileType,
  MAX_FILE_BYTES,
} from "./file.types";

/**
 * Stores one application document and answers with a link to it.
 *
 * The link carries the filename, because the browser needs the extension to
 * decide whether to show a PDF in its own reader or hand a Word file to the
 * download folder — and because a reviewer hovering a link should see
 * "licence.jpg", not a row of hex.
 */
export const uploadFile = catchAsync(async (req, res, next) => {
  const parsed = uploadFileSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, parsed.error.issues[0].message));
  }

  const { name, mime, data } = parsed.data;

  if (!isAllowedFileType(mime)) {
    return next(
      new ApiError(415, "That file type cannot be attached. Use a photo, a PDF or a Word document.")
    );
  }

  // Base64 inflates by a third, so the cap is checked on the real bytes rather
  // than on the length of the string that arrived.
  const buffer = Buffer.from(data, "base64");

  if (buffer.length === 0) {
    return next(new ApiError(400, "That file arrived empty. Try choosing it again."));
  }

  if (buffer.length > MAX_FILE_BYTES) {
    return next(new ApiError(413, `That file is larger than ${describeSizeLimit()}.`));
  }

  const stored = await fileService.storeFile({
    name: name || "document",
    mime,
    data: buffer,
    uploadedBy: parsed.data.uploadedBy ?? req.user?.id ?? "",
  });

  const origin = `${req.protocol}://${req.get("host")}`;
  const signature = fileSignature(stored.id);
  const url = `${origin}/api/files/${stored.id}/${encodeURIComponent(stored.name)}${
    signature ? `?sig=${signature}` : ""
  }`;

  return apiResponse(
    res,
    201,
    { id: stored.id, name: stored.name, mime, size: buffer.length, url },
    "File stored"
  );
});

/**
 * Serves one stored document.
 *
 * The route is behind `requireFileAccess`, so only a request carrying the
 * signed link the upload handed out, or a store-team token, reaches here. The
 * bytes are still cached privately, because the URL that names them is the
 * capability that opens them.
 */
export const getFile = catchAsync(async (req, res, next) => {
  // Express types a route parameter as string or string[]; the id is always one
  // segment, so anything else is a link that was never ours.
  const id = typeof req.params.id === "string" ? req.params.id : "";

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return next(new ApiError(404, "That file is not here."));
  }

  const file = await fileService.findStoredFile(id);
  if (!file) {
    return next(new ApiError(404, "That file is not here."));
  }

  const inline = isInlineFileType(file.mime);

  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Length", String(file.data.length));
  // The bytes never change under an id, and only a caller holding the signed
  // link or a staff token reaches this line, so the copy stays private.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  // Never let the browser second-guess the declared type: a document is a
  // document, whatever is inside it.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`
  );

  // `end`, not `send`: Express rewrites the charset on some content types and
  // would turn a PDF into text that no reader opens.
  return res.end(file.data);
});
