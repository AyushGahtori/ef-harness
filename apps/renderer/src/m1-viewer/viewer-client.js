(function () {
  const text = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? "" : String(value);
  };

  let port = null;
  let nextId = 1;
  const pending = new Map();
  const codec = { pending: new Uint8Array(0) };
  let lastSeq = 0;
  let syncing = false;
  const binary = new Map();
  const streamWaiters = new Map();

  function concat(left, right) {
    const out = new Uint8Array(left.length + right.length);
    out.set(left, 0);
    out.set(right, left.length);
    return out;
  }

  function pushFrame(chunk) {
    codec.pending = codec.pending.length === 0 ? chunk.slice() : concat(codec.pending, chunk);
    const frames = [];
    const view = () => new DataView(codec.pending.buffer, codec.pending.byteOffset, codec.pending.byteLength);
    while (codec.pending.length >= 5) {
      const declared = view().getUint32(0, false);
      if (declared > 1048576) throw new Error("frame too large");
      const channel = view().getUint8(4);
      if (channel === 0) {
        const total = 5 + declared;
        if (codec.pending.length < total) break;
        frames.push({ channel: 0, streamId: null, payload: codec.pending.slice(5, total) });
        codec.pending = codec.pending.slice(total);
        continue;
      }
      if (channel === 1) {
        const total = 9 + declared;
        if (codec.pending.length < total) break;
        const streamId = view().getUint32(5, false);
        frames.push({ channel: 1, streamId, payload: codec.pending.slice(9, total) });
        codec.pending = codec.pending.slice(total);
        continue;
      }
      throw new Error("bad channel");
    }
    return frames;
  }

  function sendBytes(bytes) {
    if (!port) return;
    let binary = "";
    for (let index = 0; index < bytes.byteLength; index += 1) binary += String.fromCharCode(bytes[index]);
    port.postMessage(`bytes:${btoa(binary)}`);
  }

  function rpc(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const body = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      const out = new Uint8Array(5 + body.byteLength);
      const header = new DataView(out.buffer);
      header.setUint32(0, body.byteLength, false);
      out[4] = 0;
      out.set(body, 5);
      sendBytes(out);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("timeout " + method));
        }
      }, 8000);
    });
  }

  function render(view) {
    if (!view) return;
    text("connection-badge", "Connected");
    text("sandbox-badge", view.sandbox && view.sandbox.label ? view.sandbox.label : "Sandbox tier —");
    if (!view.live) {
      text("task-brief", "No active task");
      text("state-badge", "—");
      text("state-path", "");
      text("ref-line", "");
      return;
    }
    text("task-brief", view.brief || "");
    text("state-badge", view.state || "—");
    text("state-path", Array.isArray(view.visited) ? view.visited.join(" → ") : "");
    const commit = view.commit ? " · " + view.commit : "";
    text("ref-line", (view.ref || "") + commit);
    const checks = document.getElementById("checks");
    if (checks) {
      checks.textContent = "";
      for (const check of view.checks || []) {
        const li = document.createElement("li");
        li.className = check.status === "pass" ? "check-pass" : "check-" + check.status;
        li.textContent = check.id + " · " + check.status;
        checks.appendChild(li);
      }
    }
    const receipt = view.receipt;
    const receiptEl = document.getElementById("receipt");
    if (receiptEl) {
      receiptEl.className = receipt ? "receipt-pass" : "";
      receiptEl.textContent = receipt
        ? receipt.receiptId + " · " + receipt.ref + " · " + receipt.commit + " · " + receipt.trailer
        : "";
    }
  }

  function renderHunks(hunks) {
    const host = document.getElementById("diff-view");
    if (!host) return;
    host.textContent = "";
    for (const hunk of hunks || []) {
      for (const line of hunk.lines || []) {
        const row = document.createElement("div");
        const kind = line.kind === "add" || line.kind === "del" || line.kind === "meta" || line.kind === "note" ? line.kind : "ctx";
        row.className = "diff-" + kind;
        row.textContent = line.text == null ? "" : String(line.text);
        host.appendChild(row);
      }
    }
  }

  function applyEvents(events) {
    for (const event of events || []) {
      if (typeof event.seq !== "number") continue;
      if (event.seq <= lastSeq) continue;
      if (event.seq !== lastSeq + 1) {
        text("sync-status", "gap");
        void resync();
        return;
      }
      lastSeq = event.seq;
      text("last-seq", String(lastSeq));
      text("sync-status", "contiguous");
      render(event.payload);
      if (event.payload && event.payload.diffFile) void loadDiff(event.payload.taskId, event.payload.diffFile);
    }
  }

  async function readStream(info) {
    if (binary.has(info.streamId) && binary.get(info.streamId).done) return binary.get(info.streamId).bytes;
    const result = new Promise((resolve, reject) => {
      streamWaiters.set(info.streamId, { resolve, reject });
    });
    await rpc("stream.credit", { streamId: info.streamId, chunks: 256 });
    return result;
  }

  async function loadDiff(task, file) {
    const summary = await rpc("diff.get", { task, file });
    if (!summary || !summary.file) return;
    const body = await rpc("diff.get", { task, file, hunks: [0] });
    if (body && body.streamId) {
      const bytes = await readStream(body);
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      renderHunks(parsed.hunks || []);
      return;
    }
    renderHunks((body && body.hunks) || []);
  }

  async function resync() {
    if (syncing) return;
    syncing = true;
    try {
      const snap = await rpc("snapshot.get", { project: "m1", views: ["m1"] });
      const section = snap && snap.sections ? snap.sections.m1 : null;
      lastSeq = snap && typeof snap.as_of_seq === "number" ? snap.as_of_seq : 0;
      text("last-seq", String(lastSeq));
      text("sync-status", "contiguous");
      render(section);
      if (section && section.live && section.diffFile) await loadDiff(section.taskId, section.diffFile);
      const sub = await rpc("events.subscribe", {
        project: "m1",
        topics: ["m1"],
        since_seq: lastSeq,
        stream_epoch: snap ? snap.stream_epoch : 1,
      });
      if (sub && sub.status === "resync_required") {
        syncing = false;
        await resync();
      }
    } catch (error) {
      text("sync-status", error && error.message ? error.message : "sync failed");
    } finally {
      syncing = false;
    }
  }

  function onJson(payload) {
    const message = JSON.parse(new TextDecoder().decode(payload));
    if (message.id != null && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || "rpc error"));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "events.batch") applyEvents(message.params && message.params.events);
    if (message.method === "stream.end") {
      const params = message.params || {};
      const bucket = binary.get(params.streamId) || { parts: [], done: false, bytes: new Uint8Array(0) };
      const size = bucket.parts.reduce((sum, part) => sum + part.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of bucket.parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      bucket.bytes = bytes;
      bucket.done = true;
      binary.set(params.streamId, bucket);
      const waiter = streamWaiters.get(params.streamId);
      if (waiter) {
        streamWaiters.delete(params.streamId);
        void sha256Hex(bytes).then(
          (digest) => {
            if (params.sha256 && digest !== params.sha256) waiter.reject(new Error("stream hash mismatch"));
            else waiter.resolve(bytes);
          },
          () => waiter.resolve(bytes),
        );
      }
    }
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function frameBytes(value) {
    if (!value) return null;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const payload = value.payload;
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (payload && ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    return null;
  }

  function onBytes(buffer) {
    const frames = pushFrame(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    for (const frame of frames) {
      if (frame.channel === 1) {
        const bucket = binary.get(frame.streamId) || { parts: [], done: false, bytes: new Uint8Array(0) };
        bucket.parts.push(frame.payload);
        binary.set(frame.streamId, bucket);
        continue;
      }
      onJson(frame.payload);
    }
  }

  function attach(next) {
    port = next;
    port.onmessage = (event) => {
      const data = event.data;
      const raw = frameBytes(data);
      if (raw && (!data || typeof data !== "object" || !data.type)) {
        onBytes(raw);
        return;
      }
      if (!data || typeof data !== "object") return;
      if (data.type === "status" && data.status === "reconnecting") {
        text("connection-badge", "Reconnecting");
        const banner = document.getElementById("banner");
        if (banner) {
          banner.hidden = false;
          banner.textContent = "Reconnecting to build engine...";
        }
        return;
      }
      if (data.type === "status" && data.status === "connected") {
        const banner = document.getElementById("banner");
        if (banner) banner.hidden = true;
        text("connection-badge", "Connected");
        setTimeout(() => {
          void resync();
        }, 0);
        return;
      }
      if (data.type === "bytes" && data.encoding === "base64" && typeof data.payload === "string") {
        const binary = atob(data.payload);
        const decoded = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
        onBytes(decoded);
        return;
      }
      if (data.type === "bytes" && data.payload instanceof Uint8Array) onBytes(data.payload);
    };
    port.start();
  }

  document.getElementById("stop").addEventListener("click", () => {
    rpc("build.stop", { op_id: "stop-" + Date.now(), project: "m1" }).catch(() => undefined);
  });

  window.addEventListener("message", (event) => {
    if (event.data !== "ef-port") return;
    const transferred = event.ports && event.ports[0];
    if (!transferred || port) return;
    attach(transferred);
  });
})();
