import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UPLOAD_POLICY,
  LocalObjectStorageProvider,
  UploadRejectedError,
  assertUploadAllowed,
  safeObjectSegments,
} from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

describe("LocalObjectStorageProvider", () => {
  const dirs: string[] = [];
  const providers: LocalObjectStorageProvider[] = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("keeps two environments' buckets isolated and enforces X-08 size and type rules", async () => {
    const root = await makeTemp("s3-");
    dirs.push(root);
    const provider = new LocalObjectStorageProvider({
      home: root,
      idleGraceMs: 0,
      policy: {
        ...DEFAULT_UPLOAD_POLICY,
        maxBytes: 16,
        allowedContentTypes: ["image/png", "text/plain"],
      },
    });
    providers.push(provider);
    const [first, second] = await Promise.all([
      provider.create(envRequest(root, "alpha")),
      provider.create(envRequest(root, "beta")),
    ]);
    expect(first.bucket).toBe("env-alpha");
    expect(second.bucket).toBe("env-beta");
    expect(first.endpoint).toBe(second.endpoint);
    expect(first.storagePath.startsWith(root)).toBe(true);
    const png = Buffer.from("png-bytes");
    const uploaded = await fetch(`${first.endpoint}/${first.bucket}/photos/cat.png`, {
      method: "PUT",
      headers: { "content-type": "image/png", "x-ef-access-key": first.accessKey },
      body: png,
    });
    expect(uploaded.status).toBe(200);
    const foreign = await fetch(`${first.endpoint}/${first.bucket}/photos/cat.png`, {
      headers: { "x-ef-access-key": second.accessKey },
    });
    expect(foreign.status).toBe(403);
    const otherBucket = await fetch(`${second.endpoint}/${second.bucket}/photos/cat.png`, {
      headers: { "x-ef-access-key": second.accessKey },
    });
    expect(otherBucket.status).toBe(404);
    const own = await fetch(`${first.endpoint}/${first.bucket}/photos/cat.png`, {
      headers: { "x-ef-access-key": first.accessKey },
    });
    expect(await own.text()).toBe("png-bytes");
    const tooBig = await fetch(`${first.endpoint}/${first.bucket}/photos/big.png`, {
      method: "PUT",
      headers: { "content-type": "image/png", "x-ef-access-key": first.accessKey },
      body: Buffer.alloc(17, 1),
    });
    expect(tooBig.status).toBe(413);
    const badType = await fetch(`${first.endpoint}/${first.bucket}/photos/evil.html`, {
      method: "PUT",
      headers: { "content-type": "text/html", "x-ef-access-key": first.accessKey },
      body: Buffer.from("nope"),
    });
    expect(badType.status).toBe(415);
    expect(() => safeObjectSegments("photos/../secret.txt")).toThrow(UploadRejectedError);
    expect(() => assertUploadAllowed(provider.policy, "text/html", 4)).toThrow(UploadRejectedError);
    await provider.destroy("alpha");
    const afterDestroy = await fetch(`${second.endpoint}/${second.bucket}/keep.txt`, {
      method: "PUT",
      headers: { "content-type": "text/plain", "x-ef-access-key": second.accessKey },
      body: Buffer.from("kept"),
    });
    expect(afterDestroy.status).toBe(200);
    const kept = await fetch(`${second.endpoint}/${second.bucket}/keep.txt`, {
      headers: { "x-ef-access-key": second.accessKey },
    });
    expect(await kept.text()).toBe("kept");
  });

  it("refuses to store uploads inside a public web root", async () => {
    const root = await makeTemp("s3-public-");
    dirs.push(root);
    const provider = new LocalObjectStorageProvider({
      home: root,
      idleGraceMs: 0,
      policy: { ...DEFAULT_UPLOAD_POLICY, publicWebRoots: [root] },
    });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "alpha"))).rejects.toBeInstanceOf(UploadRejectedError);
  });
});
