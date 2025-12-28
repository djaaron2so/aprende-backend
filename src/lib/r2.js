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

// ✅ Reusa el cliente (singleton)
let _client = null;

export function r2Client() {
    if (_client) return _client;

    const accountId = must(R2_ACCOUNT_ID, "R2_ACCOUNT_ID");
    _client = new S3Client({
        region: R2_REGION, // "auto" recomendado por R2
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        // ✅ CRÍTICO para R2: usa path-style
        forcePathStyle: true,
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

export async function r2PutFile({ key, filePath, contentType }) {
    const client = r2Client();
    const Bucket = r2Bucket();

    const Body = fs.createReadStream(filePath);

    try {
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
        // ✅ Esto te da la causa real en Render Logs
        console.error("R2 PutObject failed", {
            key,
            name: e?.name,
            message: e?.message,
            code: e?.Code || e?.code,
            httpStatusCode: e?.$metadata?.httpStatusCode,
            requestId: e?.$metadata?.requestId,
        });
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
        // Mejor: solo "false" si es NotFound; si es AccessDenied, conviene saberlo
        const status = e?.$metadata?.httpStatusCode;
        if (status === 404) return false;

        console.error("R2 HeadObject failed", {
            key,
            name: e?.name,
            message: e?.message,
            code: e?.Code || e?.code,
            httpStatusCode: status,
            requestId: e?.$metadata?.requestId,
        });
        throw e;
    }
}

export async function r2DownloadToFile({ key, outPath }) {
    const client = r2Client();
    const Bucket = r2Bucket();

    const resp = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    if (!resp?.Body) throw new Error("R2 GetObject returned empty body");

    await pipeline(resp.Body, fs.createWriteStream(outPath));
    return { ok: true, outPath };
}

export async function r2SignedGetUrl(
    key,
    ttlSeconds = Number(R2_SIGNED_URL_TTL_SECONDS || 600)
) {
    const client = r2Client();
    const Bucket = r2Bucket();

    const cmd = new GetObjectCommand({ Bucket, Key: key });
    return await getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}
