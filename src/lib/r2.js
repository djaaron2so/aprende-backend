// src/lib/r2.js
import fs from "fs";
import { pipeline } from "stream/promises";
import {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
    R2_REGION = "auto",
    R2_SIGNED_URL_TTL_SECONDS = "600",
} = process.env;

function must(v, name) {
    if (!v) throw new Error(`Missing env ${name}`);
    return v;
}

function clampInt(n, { min, max, fallback }) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    const xi = Math.floor(x);
    if (xi < min) return min;
    if (xi > max) return max;
    return xi;
}

// TTL seguro para Signed URLs:
// - mínimo 1s
// - máximo 7 días (604800)
function signedUrlTTLSeconds() {
    return clampInt(R2_SIGNED_URL_TTL_SECONDS, {
        min: 1,
        max: 604800,
        fallback: 600,
    });
}

// ✅ Reusa el cliente (singleton)
let _client = null;

export function r2Client() {
    if (_client) return _client;

    const accountId = must(R2_ACCOUNT_ID, "R2_ACCOUNT_ID");

    _client = new S3Client({
        region: R2_REGION,
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true, // ✅ importante para R2
        credentials: {
            accessKeyId: must(R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
            secretAccessKey: must(R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
        },
    });

    return _client;
}

export function r2Bucket() {
    return must(R2_BUCKET, "R2_BUCKET");
}

function logAwsErr(prefix, e, extra = {}) {
    console.error(prefix, {
        ...extra,
        name: e?.name,
        message: e?.message,
        code: e?.Code || e?.code,
        httpStatusCode: e?.$metadata?.httpStatusCode,
        requestId: e?.$metadata?.requestId,
    });
}

function isNotFoundErr(e) {
    const status = e?.$metadata?.httpStatusCode;
    const code = e?.Code || e?.code;
    const name = e?.name;

    return (
        status === 404 ||
        name === "NotFound" ||
        name === "NoSuchKey" ||
        code === "NotFound" ||
        code === "NoSuchKey"
    );
}

export async function r2PutFile({ key, filePath, contentType }) {
    const client = r2Client();
    const Bucket = r2Bucket();

    // ✅ crea stream dentro del try para evitar “stream ya usado”
    try {
        const Body = fs.createReadStream(filePath);

        await client.send(
            new PutObjectCommand({
                Bucket,
                Key: key,
                Body,
                ContentType: contentType || "application/octet-stream",
                CacheControl: "public, max-age=31536000, immutable",
            })
        );

        return { ok: true, key };
    } catch (e) {
        logAwsErr("R2 PutObject failed", e, { key, Bucket });
        throw e;
    }
}

export async function r2Exists(key) {
    const client = r2Client();
    const Bucket = r2Bucket();

    try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
    } catch (e) {
        if (isNotFoundErr(e)) return false;

        logAwsErr("R2 HeadObject failed", e, { key, Bucket });
        throw e;
    }
}

export async function r2DownloadToFile({ key, outPath }) {
    const client = r2Client();
    const Bucket = r2Bucket();

    let resp;
    try {
        resp = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    } catch (e) {
        logAwsErr("R2 GetObject failed", e, { key, Bucket });
        throw e;
    }

    if (!resp?.Body) throw new Error("R2 GetObject returned empty body");

    await pipeline(resp.Body, fs.createWriteStream(outPath));
    return { ok: true, outPath };
}

export async function r2SignedGetUrl(key, ttlSeconds = undefined) {
    const client = r2Client();
    const Bucket = r2Bucket();

    // ✅ asegura número SIEMPRE (evita X-Amz-Expires inválido)
    const ttl =
        ttlSeconds === undefined
            ? signedUrlTTLSeconds()
            : clampInt(ttlSeconds, { min: 1, max: 604800, fallback: 600 });

    const cmd = new GetObjectCommand({ Bucket, Key: key });
    return await getSignedUrl(client, cmd, { expiresIn: ttl });
}
