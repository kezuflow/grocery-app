type SafeSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
};

export type BoundedBodyErrorCode =
  | "INVALID_CONTENT_LENGTH"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "BODY_TOO_LARGE"
  | "BODY_READ_FAILED"
  | "MALFORMED_JSON"
  | "BODY_VALIDATION_FAILED";

export type BoundedBodyError = {
  status: 400 | 413 | 415;
  code: BoundedBodyErrorCode;
  message: string;
};

export type BoundedBodyResult<T> = { ok: true; value: T } | { ok: false; error: BoundedBodyError };

export type BoundedTextOptions = {
  maxBytes: number;
  contentTypes: ReadonlyArray<string>;
};

export type BoundedJsonOptions = {
  maxBytes: number;
  contentTypes?: ReadonlyArray<string>;
};

function rejected(
  status: BoundedBodyError["status"],
  code: BoundedBodyErrorCode,
  message: string,
): BoundedBodyResult<never> {
  return { ok: false, error: { status, code, message } };
}

function normalizedContentType(request: Request): string | null {
  const value = request.headers.get("content-type");
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

export async function readBoundedText(
  request: Request,
  options: BoundedTextOptions,
): Promise<BoundedBodyResult<string>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const allowedTypes = options.contentTypes.map((value) => value.toLowerCase());
  const contentType = normalizedContentType(request);
  if (!contentType || !allowedTypes.includes(contentType)) {
    return rejected(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported request content type");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      return rejected(400, "INVALID_CONTENT_LENGTH", "Invalid Content-Length header");
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) {
      return rejected(400, "INVALID_CONTENT_LENGTH", "Invalid Content-Length header");
    }
    if (length > options.maxBytes) {
      return rejected(413, "BODY_TOO_LARGE", "Request body exceeds the allowed size");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, value: "" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        return rejected(413, "BODY_TOO_LARGE", "Request body exceeds the allowed size");
      }
      chunks.push(result.value);
    }
  } catch {
    return rejected(400, "BODY_READ_FAILED", "Request body could not be read");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return rejected(400, "BODY_READ_FAILED", "Request body is not valid UTF-8");
  }
}

export async function readBoundedJson<T>(
  request: Request,
  schema: SafeSchema<T>,
  options: BoundedJsonOptions,
): Promise<BoundedBodyResult<T>> {
  const text = await readBoundedText(request, {
    maxBytes: options.maxBytes,
    contentTypes: options.contentTypes ?? ["application/json"],
  });
  if (!text.ok) return text;

  let value: unknown;
  try {
    value = JSON.parse(text.value);
  } catch {
    return rejected(400, "MALFORMED_JSON", "Request body must contain valid JSON");
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return rejected(400, "BODY_VALIDATION_FAILED", "Request body failed validation");
  }
  return { ok: true, value: parsed.data };
}
