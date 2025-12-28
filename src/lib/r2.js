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

export function r2Client() {
    const accountId = must(R2_ACCOUNT_ID, "R2_ACCOUNT_ID");
    return new S3Client({
        region: R2_REGION,
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: must(R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
            secretAccessKey: must(R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
        },
    });
}

export function r2Bucket() {
    return must(R2_BUCKET, "R2_BUCKET");
}

export async function r2PutFile({ key, filePath, contentType }) {
    const client = r2Client();
    const Bucket = r2Bucket();

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
}

export async function r2Exists(key) {
    const client = r2Client();
    const Bucket = r2Bucket();

    try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
    } catch {
        return false;
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
